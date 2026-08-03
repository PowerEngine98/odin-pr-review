import {
  DARK_THEME,
  inlineAvatars,
  readChecks,
  LIGHT_THEME,
  currentUser,
  deleteComment,
  editComment,
  listReviewComments,
  replyToComment,
  setDraft,
  toggleReaction,
  submitReview,
  type ChangeGraph,
  type DraftComment,
  type GraphLayout,
  type ReviewComment,
  type ReviewEvent,
} from "@odin/core";
import { loadHighlighter, type Highlighter } from "@odin/highlight";
import { renderHtml } from "@odin/webview";
import * as vscode from "vscode";

import { baseUri } from "./baseContent.js";
import { activeTheme } from "./theme.js";
import { destinationFor, diffTargetsFor } from "./navigation.js";
import type { ViewedStore } from "./viewed.js";

/** What the webview sends back when a reviewer follows something. */
interface NavigateMessage {
  type: "navigate";
  payload: {
    toPath: string;
    toLine: number;
    toSide: "base" | "head";
    symbol?: string;
  };
}

interface OpenMessage {
  type: "open";
  payload: { path: string };
}

interface ViewedMessage {
  type: "viewed";
  payload: { path: string; viewed: boolean };
}

interface SubmitMessage {
  type: "submitReview";
  payload: { event: ReviewEvent; body: string; comments: DraftComment[] };
}

interface DraftMessage {
  type: "setDraft";
  payload: { draft: boolean };
}

/** A code block in a comment, asking to be coloured. */
interface HighlightMessage {
  type: "highlight";
  payload: { id: number; lang: string; code: string };
}

/** Acting on one remark in a thread. */
interface RemarkMessage {
  type: "react" | "reply" | "editComment" | "deleteComment";
  payload: { id: number; content?: string; body?: string };
}

/** Which part of the change the reader has opened, or all of it. */
interface PartMessage {
  type: "part";
  payload: { paths: string[] | null };
}

type Message =
  | PartMessage
  | NavigateMessage
  | OpenMessage
  | ViewedMessage
  | SubmitMessage
  | DraftMessage
  | RemarkMessage
  | HighlightMessage;

export class GraphPanel {
  private static current: GraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private repo: string;
  private graph: ChangeGraph;

  static show(
    graph: ChangeGraph,
    layout: GraphLayout,
    repo: string,
    withTests?: GraphLayout,
    viewed?: ViewedStore,
    highlight?: Highlighter,
    alternate?: { layout: GraphLayout; withTests?: GraphLayout },
  ): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.highlight = highlight;
      GraphPanel.current.alternate = alternate;
      GraphPanel.current.update(graph, layout, repo, withTests, viewed);
      GraphPanel.current.panel.reveal(vscode.ViewColumn.One);
      return GraphPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      "odin.graph",
      "Odin: Change Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        // Losing pan, zoom and selection every time the reviewer looks at a
        // file would defeat the point of the graph.
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    GraphPanel.current = new GraphPanel(
      panel, graph, layout, repo, withTests, viewed, highlight, alternate,
    );
    return GraphPanel.current;
  }

  /** Brings the existing graph back to the front, if there is one. */
  static revealCurrent(): void {
    GraphPanel.current
      ? GraphPanel.current.panel.reveal(vscode.ViewColumn.One)
      : vscode.commands.executeCommand("odin.review");
  }

  /** Opens a file as a diff, for the sidebar's file rows. */
  static async openPath(path: string): Promise<void> {
    await GraphPanel.current?.openDiff(path);
  }

  /** Brings a file's card to the middle of the canvas, without opening it. */
  static focusPath(path: string): void {
    void GraphPanel.current?.panel.webview.postMessage({ type: "focus", path });
  }

  /** Follows a reference, for the sidebar's reference rows. */
  static async follow(target: {
    toPath: string;
    toLine: number;
    toSide: "base" | "head";
  }): Promise<void> {
    if (!target.toPath) return;
    await GraphPanel.current?.reveal(target.toPath, target.toLine, target.toSide);
  }

  /**
   * Told when the reader opens one part of the change.
   *
   * The panel has no idea the file list exists; the extension wires the two
   * together, and either can be present without the other.
   */
  static onPart: ((paths: string[] | undefined) => void) | undefined;

  private withTests: GraphLayout | undefined;
  /** The same graph in the other diff mode, for the page's own switch. */
  private alternate: { layout: GraphLayout; withTests?: GraphLayout } | undefined;
  private viewed: ViewedStore | undefined;
  private comments: ReviewComment[] = [];
  /** Loaded before the first paint, so the code is never briefly grey. */
  private highlight: Highlighter | undefined;
  /** Who the reader is, so only their own remarks offer edit and delete. */
  private viewer = "";

  /**
   * Keeps the forge's verdict on the branch up to date while the panel is open.
   *
   * Asked again every few seconds: checks finish while a review is being read,
   * and a stale "3/10 running" is worse than no number at all. The timer stops
   * with the panel, and each round is best-effort — a failed ask leaves the
   * last good answer on screen rather than blanking it.
   */
  watchChecks(branch: string, repo: string): void {
    const ask = () => {
      void readChecks(branch, { cwd: repo, timeoutMs: 8000 }).then((summary) => {
        if (!summary) return;
        void this.panel.webview.postMessage({ type: "checks", payload: summary });
      });
    };

    ask();
    const timer = setInterval(ask, 5000);
    this.disposables.push({ dispose: () => clearInterval(timer) });
  }

  /** Comments already on the pull request, shown against their lines. */
  setComments(comments: ReviewComment[]): void {
    this.comments = comments;
    // Asked for once, alongside the comments that need it.
    void currentUser({ cwd: this.repo })
      .then((login) => {
        if (!login || login === this.viewer) return;
        this.viewer = login;
        this.render(this.layout);
      })
      .catch(() => undefined);
    this.render(this.layout);
  }

  /**
   * Sends a review, once the reviewer has said so a second time.
   *
   * A review is visible to everyone on the pull request and cannot be taken
   * back, so the confirmation names the verdict and counts the remarks rather
   * than asking a bare "are you sure" — the point is to catch a wrong verdict,
   * which a generic prompt does nothing about.
   */
  private async submit(payload: {
    event: ReviewEvent;
    body: string;
    comments: DraftComment[];
  }): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;

    const verdict = {
      APPROVE: "Approve",
      COMMENT: "Comment on",
      REQUEST_CHANGES: "Request changes on",
    }[payload.event];

    const remarks =
      payload.comments.length === 1
        ? "1 line comment"
        : `${payload.comments.length} line comments`;

    const confirmed = await vscode.window.showWarningMessage(
      `${verdict} #${pull.number} with ${remarks}?`,
      { modal: true, detail: "This is posted to the pull request and cannot be undone from here." },
      "Submit review",
    );
    if (confirmed !== "Submit review") return;

    try {
      await submitReview(
        {
          number: pull.number,
          event: payload.event,
          body: payload.body,
          comments: payload.comments,
        },
        { cwd: this.repo },
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Odin: the review was not posted. ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    vscode.window.showInformationMessage(`Odin: review posted on #${pull.number}.`);
    const posted = await listReviewComments(pull.number, { cwd: this.repo });
    this.comments = await inlineAvatars(posted).catch(() => posted);
    void this.panel.webview.postMessage({
      type: "reviewSubmitted",
      comments: this.comments,
    });
  }

  /**
   * Colours a code block inside a comment.
   *
   * With the same grammars and the same theme the cards use, because a Kotlin
   * snippet in a remark should look like the Kotlin in the file above it. The
   * highlighter is loaded for the languages in the change; one named in a
   * comment that is not among them comes back plain, which is the honest
   * answer rather than a guess at the colours.
   */
  private async colour(request: {
    id: number;
    lang: string;
    code: string;
  }): Promise<void> {
    // A comment may name a language no file in the change is written in — a
    // reviewer quoting shell in a Kotlin review is ordinary — so the grammar is
    // fetched on demand rather than refused.
    const ready = this.highlight
      ? this.highlight.supports(request.lang) ||
        (await this.highlight.ensure(request.lang))
      : false;

    void this.panel.webview.postMessage({
      type: "highlighted",
      id: request.id,
      lines: ready && this.highlight
        ? this.highlight.tokenize(request.lang, request.code)
        : [],
    });
  }

  /**
   * Acting on one remark: an emoji, an answer, a rewrite, a removal.
   *
   * Every one of these changes what the team sees, so the comments are read
   * back from the forge afterwards rather than guessed at locally — the page
   * then shows what is actually there, including anything someone else wrote
   * in the meantime.
   */
  private async remark(message: RemarkMessage): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;
    const { id, content, body } = message.payload;

    // The one that cannot be taken back. The others can be edited or reacted
    // to again; a deleted remark is gone from the conversation for everyone.
    if (message.type === "deleteComment") {
      const confirmed = await vscode.window.showWarningMessage(
        "Delete this comment?",
        { modal: true, detail: "It is removed from the pull request for everyone." },
        "Delete",
      );
      if (confirmed !== "Delete") return;
    }

    try {
      if (message.type === "react" && content) {
        await toggleReaction(id, content, { cwd: this.repo });
      } else if (message.type === "reply" && body) {
        await replyToComment(pull.number, id, body, { cwd: this.repo });
      } else if (message.type === "editComment" && body) {
        await editComment(id, body, { cwd: this.repo });
      } else if (message.type === "deleteComment") {
        await deleteComment(id, { cwd: this.repo });
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Odin: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const posted = await listReviewComments(pull.number, { cwd: this.repo });
    this.comments = await inlineAvatars(posted).catch(() => posted);
    void this.panel.webview.postMessage({
      type: "comments",
      comments: this.comments,
    });
  }

  /**
   * Takes the pull request out of draft, or puts it back.
   *
   * Leaving draft is the moment the team is asked to look — reviewers are
   * notified and the pull request joins their queue — so it is confirmed the
   * same way a review is, by a prompt that names what is about to happen.
   */
  private async setDraftState(draft: boolean): Promise<void> {
    const pull = this.graph.meta.pullRequest;
    if (!pull) return;

    const confirmed = await vscode.window.showWarningMessage(
      draft
        ? `Convert #${pull.number} back to a draft?`
        : `Mark #${pull.number} ready for review?`,
      {
        modal: true,
        detail: draft
          ? "It leaves the review queue until it is marked ready again."
          : "Reviewers are notified and the pull request joins their queue.",
      },
      draft ? "Convert to draft" : "Ready for review",
    );
    if (!confirmed) return;

    try {
      await setDraft(pull.number, draft, { cwd: this.repo });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Odin: the state was not changed. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // The bar is drawn from the graph, so the graph is what has to change.
    this.graph = {
      ...this.graph,
      meta: { ...this.graph.meta, pullRequest: { ...pull, draft } },
    };
    vscode.window.showInformationMessage(
      draft
        ? `Odin: #${pull.number} is a draft again.`
        : `Odin: #${pull.number} is ready for review.`,
    );
    this.render(this.layout);
  }

  /** Reflects a change made in the sidebar. */
  static applyViewed(paths: string[], marked: boolean): void {
    void GraphPanel.current?.panel.webview.postMessage({
      type: "setViewed",
      paths,
      viewed: marked,
    });
  }

  private constructor(
    panel: vscode.WebviewPanel,
    graph: ChangeGraph,
    layout: GraphLayout,
    repo: string,
    withTests?: GraphLayout,
    viewed?: ViewedStore,
    highlight?: Highlighter,
    alternate?: { layout: GraphLayout; withTests?: GraphLayout },
  ) {
    this.panel = panel;
    this.graph = graph;
    this.repo = repo;
    this.withTests = withTests;
    this.viewed = viewed;
    this.highlight = highlight;
    // Set before the first render: without it the page has one set of card
    // sizes for two ways of reading the change, and the unified cards are
    // capped by numbers measured for split ones.
    this.alternate = alternate;

    this.render(layout);

    this.panel.webview.onDidReceiveMessage(
      (message: Message) => void this.handle(message),
      undefined,
      this.disposables,
    );

    // The graph is themed from the editor, so it has to be redrawn when the
    // editor's theme flips between light and dark.
    // A new theme means new token colours as well as new chrome, and the
    // grammars are loaded against a theme. Re-reading it is a moment's work
    // and the alternative is a page in one theme's colours and another's.
    vscode.window.onDidChangeActiveColorTheme(
      () => void this.recolour(),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private layout!: GraphLayout;

  update(
    graph: ChangeGraph,
    layout: GraphLayout,
    repo: string,
    withTests?: GraphLayout,
    viewed?: ViewedStore,
  ): void {
    this.graph = graph;
    this.repo = repo;
    this.withTests = withTests;
    this.viewed = viewed;
    this.render(layout);
  }

  /** Reloads the highlighter against the theme now in use, then redraws. */
  private async recolour(): Promise<void> {
    const languages = this.graph.nodes.map((n) => n.language ?? "plaintext");
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

    try {
      const theme = await activeTheme();
      this.highlight = await loadHighlighter(languages, {
        dark,
        ...(theme ? { theme } : {}),
      });
    } catch {
      // Keep whatever colours we had rather than losing them to a bad theme.
    }
    this.render(this.layout);
  }

  private render(layout: GraphLayout): void {
    this.layout = layout;
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

    // The pull request's title names the tab; the branch pair is in the
    // toolbar, and a tab strip has room for one of them, not both.
    const pull = this.graph.meta.pullRequest;
    this.panel.title = pull
      ? `#${pull.number} ${pull.title}`
      : `Odin: ${this.graph.meta.baseRef} → ${this.graph.meta.headRef}`;

    // Marks made in an earlier session are restored once the page is up.
    const marked = this.viewed?.all() ?? [];
    if (marked.length > 0) {
      setTimeout(() => {
        void this.panel.webview.postMessage({
          type: "setViewed",
          paths: marked,
          viewed: true,
        });
      }, 0);
    }
    this.panel.webview.html = renderHtml(this.graph, layout, {
      theme: dark ? DARK_THEME : LIGHT_THEME,
      csp: { nonce: nonce(), source: this.panel.webview.cspSource },
      ...(this.withTests ? { withTests: this.withTests } : {}),
      ...(this.alternate ? { alternate: this.alternate } : {}),
      ...(this.highlight ? { highlight: this.highlight } : {}),
      comments: this.comments,
      canReview: Boolean(this.graph.meta.pullRequest),
      ...(this.viewer ? { viewer: this.viewer } : {}),
    });
  }

  /**
   * Opens whatever an arrow points at.
   *
   * The editor is revealed beside the graph and never takes focus: following a
   * reference should show you the destination without evicting you from the
   * picture you are reading.
   */
  private async handle(message: Message): Promise<void> {
    try {
      if (message.type === "part") {
        GraphPanel.onPart?.(message.payload.paths ?? undefined);
        return;
      }
      if (message.type === "navigate") {
        await this.reveal(
          message.payload.toPath,
          message.payload.toLine,
          message.payload.toSide,
        );
        return;
      }
      if (message.type === "open") {
        await this.openDiff(message.payload.path);
        return;
      }
      if (message.type === "viewed") {
        this.viewed?.set([message.payload.path], message.payload.viewed);
        return;
      }
      if (message.type === "submitReview") {
        await this.submit(message.payload);
        return;
      }
      if (message.type === "setDraft") {
        await this.setDraftState(message.payload.draft);
        return;
      }
      if (message.type === "highlight") {
        await this.colour(message.payload);
        return;
      }
      if (
        message.type === "react" ||
        message.type === "reply" ||
        message.type === "editComment" ||
        message.type === "deleteComment"
      ) {
        await this.remark(message);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Odin: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async reveal(
    path: string,
    line: number,
    side: "base" | "head",
  ): Promise<void> {
    const destination = destinationFor(this.graph, this.repo, path, line, side);
    const uri =
      destination.kind === "base"
        ? baseUri(this.repo, destination.sha!, destination.path)
        : vscode.Uri.file(destination.path);

    const document = await vscode.workspace.openTextDocument(uri);
    const target = new vscode.Position(Math.max(0, line - 1), 0);

    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: true,
      selection: new vscode.Selection(target, target),
    });
  }

  /** Shows a file the way a reviewer expects: as a diff against the base. */
  private async openDiff(path: string): Promise<void> {
    const targets = diffTargetsFor(this.graph, this.repo, path);
    const options = {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: true,
    };

    if (!targets.base) {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(targets.head!),
      );
      await vscode.window.showTextDocument(document, options);
      return;
    }

    const base = baseUri(this.repo, targets.base.sha, targets.base.path);
    if (!targets.head) {
      // Deleted: there is no head side to compare against, so show what was
      // removed rather than an empty pane.
      const document = await vscode.workspace.openTextDocument(base);
      await vscode.window.showTextDocument(document, options);
      return;
    }

    await vscode.commands.executeCommand(
      "vscode.diff",
      base,
      vscode.Uri.file(targets.head),
      targets.title,
      options,
    );
  }

  dispose(): void {
    GraphPanel.current = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}

function nonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
