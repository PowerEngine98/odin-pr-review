import {
  DARK_THEME,
  LIGHT_THEME,
  listReviewComments,
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

type Message = NavigateMessage | OpenMessage | ViewedMessage | SubmitMessage;

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
  ): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.highlight = highlight;
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
      panel, graph, layout, repo, withTests, viewed, highlight,
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

  /** Follows a reference, for the sidebar's reference rows. */
  static async follow(target: {
    toPath: string;
    toLine: number;
    toSide: "base" | "head";
  }): Promise<void> {
    if (!target.toPath) return;
    await GraphPanel.current?.reveal(target.toPath, target.toLine, target.toSide);
  }

  private withTests: GraphLayout | undefined;
  private viewed: ViewedStore | undefined;
  private comments: ReviewComment[] = [];
  /** Loaded before the first paint, so the code is never briefly grey. */
  private highlight: Highlighter | undefined;

  /** Comments already on the pull request, shown against their lines. */
  setComments(comments: ReviewComment[]): void {
    this.comments = comments;
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
    this.comments = await listReviewComments(pull.number, { cwd: this.repo });
    void this.panel.webview.postMessage({
      type: "reviewSubmitted",
      comments: this.comments,
    });
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
  ) {
    this.panel = panel;
    this.graph = graph;
    this.repo = repo;
    this.withTests = withTests;
    this.viewed = viewed;
    this.highlight = highlight;

    this.render(layout);

    this.panel.webview.onDidReceiveMessage(
      (message: Message) => void this.handle(message),
      undefined,
      this.disposables,
    );

    // The graph is themed from the editor, so it has to be redrawn when the
    // editor's theme flips between light and dark.
    vscode.window.onDidChangeActiveColorTheme(
      () => this.render(this.layout),
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
      ...(this.highlight ? { highlight: this.highlight } : {}),
      comments: this.comments,
      canReview: Boolean(this.graph.meta.pullRequest),
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
