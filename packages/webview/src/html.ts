import {
  DARK_THEME,
  cardTitle,
  components,
  describeGaps,
  pairRows,
  type ReviewComment,
  type ChangeGraph,
  type DisplayRow,
  type GraphLayout,
  type PlacedEdge,
  type PlacedNode,
  type Component,
  type CheckSummary,
  type Reviewer,
  type RowPair,
  type Theme,
} from "@odin/core";

import { CLIENT_SCRIPT } from "./client.js";
import { stylesheet } from "./styles.js";

export interface RenderOptions {
  theme?: Theme;
  title?: string;
  /**
   * Positions to use when test files are shown.
   *
   * Hiding tests changes the layout, and the browser has no layout engine, so
   * both arrangements are computed here and the checkbox swaps between them.
   * Two sets of coordinates cost a few kilobytes; shipping the layout engine to
   * the client would cost far more, and risk the two disagreeing.
   */
  withTests?: GraphLayout;
  /**
   * Content policy for an editor webview, which refuses inline scripts without
   * one. Omitted for a standalone file, where the document is opened directly
   * from disk and no policy applies.
   */
  csp?: {
    /** Per-load random value; the host must generate a fresh one each time. */
    nonce: string;
    /** The host's resource origin, e.g. `webview.cspSource`. */
    source: string;
  };
  /**
   * The same graph laid out the other way round.
   *
   * A card is a different width and a different height in unified than it is in
   * split, so switching between them is a change of layout and not of
   * stylesheet. Both are computed here and the page swaps between them, the way
   * it already swaps between showing tests and hiding them.
   */
  alternate?: { layout: GraphLayout; withTests?: GraphLayout };
  /** Comments already on the pull request. */
  comments?: ReviewComment[];
  /** What the forge made of the branch, if it was asked. */
  checks?: CheckSummary;
  /** Whether the host can post a review; without it the composer is pointless. */
  canReview?: boolean;
  /** Who the reader is signed in as, for deciding what they may edit. */
  viewer?: string;
  /** Their picture, as a data uri, for the box they write in. */
  viewerFace?: string;
  /**
   * Syntax colouring, already loaded for the languages in this change.
   *
   * Structural on purpose: the renderer needs no dependency on whatever
   * produces the tokens, and a caller with none simply leaves it out and gets
   * the plain text it has always had.
   */
  highlight?: CodeHighlighter;
}

export interface CodeToken {
  text: string;
  color?: string;
  /** 1 italic, 2 bold, 4 underline. */
  fontStyle?: number;
}

export interface CodeHighlighter {
  supports(language: string): boolean;
  tokenize(language: string, code: string): CodeToken[][];
  /** Languages in the change that nothing could colour. */
  readonly missing: readonly string[];
}

/**
 * Renders a laid-out change graph as one self-contained HTML document.
 *
 * Cards and arrows are written into the markup rather than built by script, so
 * the page is meaningful before any JavaScript runs, the code inside it is
 * findable with the browser's own search, and the same markup can be handed to
 * an editor webview under a strict content policy.
 */
export function renderHtml(
  graph: ChangeGraph,
  layout: GraphLayout,
  options: RenderOptions = {},
): string {
  const theme = options.theme ?? DARK_THEME;
  const title = options.title ??
    `${graph.meta.baseRef} → ${graph.meta.headRef} · Odin`;

  const comments = options.comments ?? [];
  const full = options.withTests ?? layout;
  // Split from the arrangement that holds every file, so a part does not lose
  // members to a filter and then be named after a file that is not in it.
  const parts = components({ ...graph, nodes: full.nodes.map((n) => n.node) });
  // Column identity belongs to the arrangement, not to the file: hiding the
  // tests changes the graph, which changes the ranking. Carrying it from one
  // arrangement while taking positions from another is how cards end up
  // believing they are in a column they are not, and collide.
  const place = (l: GraphLayout) => ({
    width: l.width,
    height: l.height,
    nodes: Object.fromEntries(
      l.nodes.map((n) => [
        n.id,
        { x: n.x, y: n.y, width: n.width, height: n.height, column: n.rank },
      ]),
    ),
  });

  const viewModel = {
    width: layout.width,
    height: layout.height,
    rowGap: layout.metrics.rowGap,
    // The width of one character, for placing a mark over a symbol without
    // measuring text in the browser — the same number the layout engine used.
    charWidth: layout.metrics.charWidth,
    // Where a row's first character sits: the marker column, the base number,
    // and the padding between that and the code.
    textLeft: layout.metrics.padding + layout.metrics.gutterWidth,
    // A card's body is two panes wide, so the head side's code starts a pane in.
    // The pane width depends on the card, which the page measures for itself.
    padding: layout.metrics.padding,
    gutterWidth: layout.metrics.gutterWidth,
    // Needed to lay a part out on its own: the space the engine leaves between
    // columns, and the margin it keeps around the whole drawing.
    columnGap: layout.metrics.columnGap,
    margin: layout.metrics.margin,
    // Cards come from the arrangement that includes everything, so the markup
    // holds every file; only positions and visibility change with the toggle.
    nodes: full.nodes.map((n) => ({
      id: n.id,
      path: n.path,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      // Which column the card belongs to. Cards are centred within a column,
      // so two in the same one rarely share an x — comparing x to decide what
      // moves together leaves the odd-width cards behind, and they collide.
      column: n.rank,
      isTest: n.node.isTest === true,
      // The language a suggestion in a comment on this file should be coloured
      // with; the card knows it, and the comment only knows a path.
      language: n.node.language ?? "",
      // A file the diff never touched is in the picture only because something
      // points at it, which is what lets it follow those references' state.
      untouched: n.node.status === "phantom",
    })),
    unified: layout.unified,
    ...(options.checks ? { checks: options.checks } : {}),
    arrangements: {
      withTests: place(full),
      withoutTests: place(layout),
      ...(options.alternate
        ? {
            otherWithTests: place(options.alternate.withTests ?? options.alternate.layout),
            otherWithoutTests: place(options.alternate.layout),
          }
        : {}),
    },
    edges: full.edges.map((e) => ({
      id: e.id,
      from: e.edge.from.nodeId,
      to: e.edge.to.nodeId,
      fromPath: pathOf(layout, e.edge.from.nodeId),
      toPath: pathOf(layout, e.edge.to.nodeId),
      fromLine: e.edge.from.line,
      toLine: e.edge.to.line,
      // Which checkout each end lives in. A host that opens files needs this:
      // a removed reference points at the merge base, not the working tree.
      fromSide: e.edge.from.side,
      toSide: e.edge.to.side,
      change: e.edge.change,
      kind: e.edge.kind,
      confidence: e.edge.confidence,
      symbol: e.edge.to.symbolName ?? "",
      label: e.edge.label ?? "",
    })),
    parts: [
      ...parts.filter((p) => p.files > 1).map((p) => ({ id: p.id, nodes: p.nodeIds })),
      {
        id: "loose",
        nodes: parts.filter((p) => p.files === 1).flatMap((p) => p.nodeIds),
      },
    ],
    canReview: options.canReview === true,
    viewer: options.viewer ?? "",
    viewerFace: options.viewerFace ?? "",
    comments: comments.map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line,
      startLine: c.startLine ?? c.line,
      side: c.side,
      body: c.body,
      author: c.author,
      ...(c.avatarUrl ? { avatar: c.avatarUrl } : {}),
      createdAt: c.createdAt,
      ...(c.inReplyTo ? { inReplyTo: c.inReplyTo } : {}),
      ...(c.reactions ? { reactions: c.reactions } : {}),
      url: c.url,
      outdated: c.outdated,
      ...(c.wholeFile ? { wholeFile: true } : {}),
    })),
  };

  const nonce = options.csp ? ` nonce="${options.csp.nonce}"` : "";

  // Cards first: colouring them is what fills the palette, and the palette has
  // to be in the head before anything it names is used.
  const palette = new Palette();
  // The same cards measured the other way round, so each card can carry both
  // bodies with the right amount hidden behind each one's bar.
  const alternate = options.alternate
    ? new Map(
        (options.alternate.withTests ?? options.alternate.layout).nodes.map((n) => [n.id, n]),
      )
    : undefined;
  const cards = full.nodes
    .map((node) => card(node, full, options.highlight, palette, alternate?.get(node.id)))
    .join("\n");
  const colours = palette.stylesheet();

  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    ...(options.csp ? [contentSecurityPolicy(options.csp)] : []),
    `<title>${escapeHtml(title)}</title>`,
    `<style>${stylesheet(theme, layout.metrics)}</style>`,
    ...(colours ? [`<style>${colours}</style>`] : []),
    `</head><body>`,
    // One fixed block, so the two rows cannot drift apart and the canvas has a
    // single height to make room for.
    `<div class="chrome">`,
    prBar(graph, options.canReview === true),
    tabs(parts),
    // Along the bottom edge of the chrome, where a sticky card title comes to
    // rest: how much of what is on screen has been read, without having to
    // look for a number.
    `<div class="done-bar"><span></span></div>`,
    `</div>`,
    `<div class="viewport">`,
    `<div class="canvas" style="width:${layout.width}px;height:${layout.height}px">`,
    edgeLayer(full),
    cards,
    `</div></div>`,
    // Over the canvas rather than above it. The legend and the switches are
    // read once and then consulted; the drawing is read for as long as the
    // review lasts, and a row of chrome across the top costs it that height on
    // every screen.
    toolbar(graph, layout, options.highlight),
    // Who has said something, and where. Docked under the chrome on the side
    // the canvas is least busy, because a comment on a change is a thing to
    // come back to rather than a thing to find again.
    `<div class="reviewers">` +
    reviewerList(graph.meta.pullRequest?.reviewers ?? []) +
    `<div class="faces" hidden></div>` +
    `<div class="reviewer-panel" hidden></div></div>`,
    `<div class="marks"></div>`,
    `<div class="tooltip"></div>`,
    `<div class="thread" hidden><div class="thread-head">` +
      `<span class="thread-where"></span>` +
      `<button class="thread-close" title="Close" aria-label="Close">${CLOSE_ICON}</button>` +
      `</div><div class="thread-body"></div>` +
      `<div class="thread-reply" hidden>` +
      editor({ placeholder: "Reply…", rows: 3 }) +
      `<div class="reply-actions"><button class="reply-send primary">Reply</button></div>` +
      `</div></div>`,
    composer(),
    reviewPanel(),
    `<script${nonce}>window.__ODIN__=${jsonForScript(viewModel)};</script>`,
    `<script${nonce}>${CLIENT_SCRIPT}</script>`,
    `</body></html>`,
  ].join("\n");
}

/**
 * Locks the page down to what it actually needs: its own inline styles, the two
 * nonced scripts, and nothing else. There is no network access to grant, since
 * the document embeds everything it uses.
 */
function contentSecurityPolicy(csp: { nonce: string; source: string }): string {
  const policy = [
    `default-src 'none'`,
    `style-src ${csp.source} 'unsafe-inline'`,
    `script-src 'nonce-${csp.nonce}'`,
    `img-src ${csp.source} data:`,
    `font-src ${csp.source}`,
  ].join("; ");
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

/**
 * Languages present in the change that nothing could colour.
 *
 * Said out loud rather than left as a card that is quietly grey. Odin bundles
 * grammars for the languages it lists, not for all two hundred Shiki carries,
 * and a reviewer looking at uncoloured code deserves to know which of the two
 * reasons they are looking at.
 */
function paint(highlight: CodeHighlighter | undefined): string {
  const missing = highlight?.missing ?? [];
  if (missing.length === 0) return "";

  const names = missing.length > 3
    ? `${missing.slice(0, 3).join(", ")} and ${missing.length - 3} more`
    : missing.join(", ");
  return (
    `<span class="paint" title="Odin ships VS Code's own grammars for the ` +
    `languages it supports. These are not among them, so their code is shown ` +
    `uncoloured; adding one is a line in @odin/highlight.">` +
    `no highlighting for ${escapeHtml(names)}</span>`
  );
}

function toolbar(
  graph: ChangeGraph,
  layout: GraphLayout,
  highlight?: CodeHighlighter,
): string {
  const gaps = describeGaps(graph.meta.coverage);
  const counts = layout.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.node.status] = (acc[n.node.status] ?? 0) + 1;
    return acc;
  }, {});

  const legend = (["added", "modified", "deleted", "renamed", "phantom"] as const)
    .filter((status) => counts[status])
    .map(
      (status) =>
        `<span class="${status}"><span class="box">${STATUS_MARK[status]}</span>` +
        `${counts[status]} ${status}</span>`,
    )
    .join("");

  // What the change is, then what to do with it: read above, pressed below.
  return `<div class="toolbar">
  <span class="facts">
  <span class="legend">${legend}</span>
  ${gaps ? `<span class="gaps" title="These files have diff lines but no arrows, because nothing could read them">${escapeHtml(gaps)}</span>` : ""}
  ${paint(highlight)}
  </span>
  <span class="filters">
    <label title="Import statements and the arrows they produce"><input type="checkbox" id="filter-imports"> imports</label>
    <label><input type="checkbox" id="filter-unchanged"> unchanged</label>
    <label title="Test files reference a great deal of what they exercise, which buries the change under them"><input type="checkbox" id="filter-tests"> tests</label>
    <label title="Hides untouched files once everything referencing them has been read. Files the change touched always stay."><input type="checkbox" id="filter-viewed"> hide viewed relations</label>
  </span>
  <button id="action-fit">fit</button>
  <button id="action-keys">keys</button>
  <div class="keys-panel" hidden></div>
</div>`;
}

/**
 * One tab per part of the change that can be read without the others.
 *
 * A large pull request is usually several changes pushed together, and reading
 * it as one picture means holding all of it at once. Each tab is a call chain
 * and everything it reaches, named after the file the chain starts at. Absent
 * when the change is one connected thing, which is when the strip would only
 * take up room to say so.
 */
function tabs(parts: Component[]): string {
  // A part of one file is a review of one file: real, but not a chain, and
  // thirty of them in a strip is a worse index than the sidebar already is.
  // They are gathered into a tab of their own so nothing is unreachable.
  const chains = parts.filter((p) => p.files > 1);
  const loose = parts.filter((p) => p.files === 1);
  if (chains.length < 2 && loose.length === 0) return "";

  const total = parts.reduce((n, p) => n + p.files, 0);
  const one = (id: string, label: string, files: number, title: string) => {
    // Room for the widest thing the pill will ever hold — "12/12" — so the
    // strip does not shuffle sideways every time a file is ticked.
    const room = String(files).length * 2 + 1;
    return `<button class="part-tab" data-part="${escapeHtml(id)}" title="${escapeHtml(title)}">` +
      `${escapeHtml(label)}` +
      // Nothing read yet is just the size of the part; part-read is read over
      // size, with the moving number carrying the colour; all read is a tick,
      // because by then the numbers have nothing left to say.
      `<span class="count" style="min-width:calc(${room}ch + 12px)">` +
      `<b class="done" hidden>0</b><span class="sep" hidden>/</span>` +
      `<span class="total">${files}</span>` +
      `<span class="tick" hidden>${TICK}</span></span>` +
      `</button>`;
  };

  const spare = loose.reduce((n, p) => n + p.files, 0);

  return `<div class="parts">` +
    one("", "Everything", total, "Every file in the change") +
    chains
      .map((part) =>
        one(
          part.id,
          part.label,
          part.files,
          `${part.path} and the ${part.files - 1} file${part.files === 2 ? "" : "s"} its calls reach`,
        ),
      )
      .join("") +
    (spare > 0
      ? one("loose", "on their own", spare, "Files nothing else in the change calls")
      : "") +
    `</div>`;
}

/**
 * The header a pull request has on the forge.
 *
 * Reviewing here and reviewing in the browser should not feel like two
 * different jobs, and the browser's answer to "what am I looking at" is this
 * bar: the state, the title, who is merging what into where, and how much of it
 * has been read. Repeating its shape costs a few rules and saves the reader
 * from having to learn a second one.
 *
 * It renders with or without a pull request. A branch compared against another
 * branch still has an author, a commit count and two ref names, and losing the
 * whole header because no forge is involved would be a strange way to treat the
 * offline case.
 */
function prBar(graph: ChangeGraph, canReview = false): string {
  const meta = graph.meta;
  const pull = meta.pullRequest;
  const authors = meta.authors ?? [];
  const commits = authors.reduce((n, a) => n + a.commits, 0);

  // The state is a button where it can be changed and a label where it cannot.
  // A control that looks pressable and is not is worse than a plain word.
  const state = pull
    ? canReview
      ? `<span class="state-menu">` +
        `<button class="state ${pull.draft ? "draft" : "open"} pressable" ` +
        `data-draft="${pull.draft ? "1" : "0"}" ` +
        `title="${pull.draft ? "Mark this pull request ready for review" : "Change the state of this pull request"}">` +
        `${PR_ICON}${pull.draft ? "Draft" : "Open"}${CARET}</button>` +
        `<span class="state-list" hidden>` +
        (pull.draft
          ? `<button class="state-item" data-ready="1">Ready for review` +
            `<span class="why">Asks the team to look. Reviewers are notified.</span></button>`
          : `<button class="state-item" data-ready="0">Convert to draft` +
            `<span class="why">Takes it back out of the review queue.</span></button>`) +
        `</span></span>`
      : pull.draft
        ? `<span class="state draft">${PR_ICON}Draft</span>`
        : `<span class="state open">${PR_ICON}Open</span>`
    : `<span class="state local">${PR_ICON}Local</span>`;

  const decision =
    pull?.reviewDecision === "APPROVED"
      ? `<span class="tag ok">approved</span>`
      : pull?.reviewDecision === "CHANGES_REQUESTED"
        ? `<span class="tag warn">changes requested</span>`
        : pull?.reviewDecision === "REVIEW_REQUIRED"
          ? `<span class="tag muted">review required</span>`
          : "";

  const heading = pull
    ? `<span class="pr-title" title="${escapeHtml(pull.title)}">${escapeHtml(pull.title)}</span>` +
      `<a class="pr-number" href="${escapeHtml(pull.url)}" target="_blank" rel="noreferrer" ` +
      `title="Open #${pull.number} in the browser">#${pull.number}</a>${decision}`
    : `<span class="pr-title">${escapeHtml(meta.headRef)}</span>`;

  // "wants to merge" is the forge's phrasing, and it is worth borrowing: it
  // names the direction, which two ref names side by side never quite do.
  const who = authors[0]?.name;
  const count = commits === 1 ? "1 commit" : `${commits} commits`;
  const merging =
    (who ? `<span class="who">${escapeHtml(who)}</span> wants to merge ` : "merging ") +
    (commits ? `${count} ` : "") +
    `into <span class="ref base">${escapeHtml(meta.baseRef)}</span> ` +
    `from <span class="ref head">${escapeHtml(meta.headRef)}</span>` +
    `<button class="copy-ref" title="Copy the branch name" data-ref="${escapeHtml(meta.headRef)}">${COPY_ICON}</button>`;

  return `<div class="prbar">
  ${state}
  <span class="about">
    <span class="head-line">${heading}</span>
    <span class="merge-line">${merging}</span>
  </span>
  <span class="spacer"></span>
  <span class="checks-menu" hidden>
    <button class="checks" title="What the forge made of this branch">
      <span class="checks-label">Checks</span><span class="checks-tally"></span>
      ${CHECK_RING}
    </button>
    <span class="checks-list" hidden></span>
  </span>
  <span class="viewed-count" title="Files you have marked as reviewed">
    ${RING}<span class="tally">0 / 0</span> viewed</span>
  <button id="action-review" class="submit" hidden>Submit review<span class="count" hidden>0</span></button>
  <span class="settings-menu">
    <button id="diff-settings" class="icon-button" data-hint="How the change is laid out" title="Diff settings" aria-label="Diff settings">${GEAR}</button>
    <span class="settings-panel" hidden>
      <span class="settings-title">Diff settings</span>
      <span class="settings-group">Diff display</span>
      <label class="settings-option"><input type="radio" name="diff-mode" value="unified"><span>Unified</span></label>
      <label class="settings-option"><input type="radio" name="diff-mode" value="split"><span>Split</span></label>
    </span>
  </span>
</div>`;
}

/**
 * The mark inside a status box, drawn rather than typed.
 *
 * The same shapes the file list uses, so a green plus means the same thing in
 * both places — and drawn, because a glyph is centred on its font's baseline
 * and side bearings rather than on the box it sits in.
 */
const mark = (body: string): string =>
  `<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">${body}</svg>`;

const STATUS_MARK: Record<string, string> = {
  added: mark(
    `<rect x="4.2" y="1.4" width="1.6" height="7.2" rx="0.6" fill="currentColor"/>` +
    `<rect x="1.4" y="4.2" width="7.2" height="1.6" rx="0.6" fill="currentColor"/>`,
  ),
  modified: mark(`<circle cx="5" cy="5" r="2.4" fill="currentColor"/>`),
  deleted: mark(
    `<rect x="1.4" y="4.2" width="7.2" height="1.6" rx="0.6" fill="currentColor"/>`,
  ),
  renamed: mark(
    `<path d="M1.6 5h6M5.4 2.6 8.2 5 5.4 7.4" fill="none" stroke="currentColor" ` +
    `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  phantom: mark(`<circle cx="5" cy="5" r="1.5" fill="currentColor"/>`),
};

const TICK =
  `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">` +
  `<path d="M3.5 8.6 6.4 11.5 12.5 5.2" fill="none" stroke="currentColor" ` +
  `stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const GEAR =
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">` +
  [0, 45, 90, 135, 180, 225, 270, 315]
    .map(
      (angle) =>
        `<rect x="6.9" y="0.6" width="2.2" height="3.8" rx="0.7" ` +
        `fill="currentColor" transform="rotate(${angle} 8 8)"/>`,
    )
    .join("") +
  // Body and bore in one path: the even-odd rule punches the hole, so the
  // middle shows whatever is behind the button rather than a guess at its
  // colour.
  `<path fill-rule="evenodd" fill="currentColor" ` +
  `d="M8 3.3a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4Zm0 2.6a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2Z"/>` +
  `</svg>`;

/**
 * Who was asked to look, the way the forge lists them.
 *
 * The same three facts it shows: who, whether they have answered, and a way
 * through to them. A name here is a link to the account rather than to
 * anything in this page — the question it answers is "who is this person",
 * which this page cannot answer and the forge can.
 */
function reviewerList(reviewers: Reviewer[]): string {
  if (reviewers.length === 0) return "";

  const dot = (state: string) =>
    state === "APPROVED"
      ? `<span class="state ok" title="Approved">${CHECK_DOT}</span>`
      : state === "CHANGES_REQUESTED"
        ? `<span class="state warn" title="Changes requested">${CHANGE_DOT}</span>`
        : state === "PENDING"
          ? `<span class="state waiting" title="Waiting on this review"></span>`
          : `<span class="state said" title="Commented"></span>`;

  const rows = reviewers
    .map((who) => {
      const face = who.avatarUrl
        ? `<img class="face" src="${escapeHtml(who.avatarUrl)}" alt="">`
        : `<span class="face team">${TEAM_ICON}</span>`;
      return `<a class="reviewer-row" href="${escapeHtml(who.url)}" ` +
        `target="_blank" rel="noreferrer" title="Open ${escapeHtml(who.login)} on the forge">` +
        `${face}<span class="login">${escapeHtml(who.login)}</span>${dot(who.state)}</a>`;
    })
    .join("");

  return `<div class="review-list"><div class="review-head">Reviewers</div>${rows}</div>`;
}

/**
 * The ring beside the tally, filled by how many checks have finished.
 *
 * The same shape the viewed count uses, for the same reason: a number says how
 * many, a ring says how far, and a reviewer waiting on CI is asking the second
 * question.
 */
const CHECK_RING =
  `<svg class="ring" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">` +
  `<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="2" ` +
  `opacity="0.25"/>` +
  `<circle class="arc" cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-dasharray="0 38.96" ` +
  `transform="rotate(-90 8 8)"/></svg>`;

const CHECK_DOT =
  `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">` +
  `<path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CHANGE_DOT =
  `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">` +
  `<path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round"/></svg>`;

const TEAM_ICON =
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<circle cx="5.6" cy="6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4"/>` +
  `<path d="M1.8 13c0-2.1 1.7-3.4 3.8-3.4S9.4 10.9 9.4 13" fill="none" ` +
  `stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
  `<path d="M10.6 4.2a2.3 2.3 0 0 1 0 4.4M11.6 9.9c1.6.4 2.6 1.6 2.6 3.1" ` +
  `fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

/** A pull request, drawn rather than borrowed, so nothing has to be fetched. */
const PR_ICON =
  `<svg class="icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<circle cx="4" cy="3.6" r="1.9" fill="currentColor"/>` +
  `<circle cx="4" cy="12.4" r="1.9" fill="currentColor"/>` +
  `<circle cx="12" cy="12.4" r="1.9" fill="currentColor"/>` +
  `<path d="M4 5.9v4.4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
  `<path d="M12 10.3V7.2a2.6 2.6 0 0 0-2.6-2.6H6.6" stroke="currentColor" stroke-width="1.5" ` +
  `fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const COPY_ICON =
  `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">` +
  `<rect x="5.2" y="1.8" width="8" height="9.4" rx="1.6" stroke="currentColor" ` +
  `stroke-width="1.3" fill="none"/>` +
  `<path d="M10.8 13.2a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6V5.6" ` +
  `stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;

/**
 * The progress ring beside the tally.
 *
 * Drawn as a circle whose dash pattern the client rewrites, so reading a file
 * moves it without anything being re-rendered.
 */
const RING =
  `<svg class="ring" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `opacity="0.3"/>` +
  `<circle class="arc" cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0 39" ` +
  `transform="rotate(-90 8 8)"/></svg>`;

/**
 * Where a line comment is written.
 *
 * Kept out of the card so that composing does not change any card's height and
 * set every arrow in the column moving; it floats over the canvas instead,
 * anchored to whatever line was clicked.
 */
function composer(): string {
  return `<div class="composer" hidden>
  <div class="composer-head"><span class="composer-face"></span><span class="composer-where"></span></div>
  ${editor({ placeholder: "Leave a comment", rows: 5 })}
  <div class="composer-actions">
    <button class="composer-cancel">Cancel</button>
    <button class="composer-add primary">Start a review</button>
  </div>
</div>`;
}

/**
 * One box for writing markdown, wherever markdown is written.
 *
 * A line comment, a reply and a review summary are the same act with different
 * destinations, and giving two of them a bare textarea while the third had
 * tabs and a toolbar meant the tool was teaching two habits for one job.
 *
 * The suggestion button is the exception: it fills itself with the lines being
 * commented on, so it only belongs where there are lines under the cursor.
 */
function editor(options: { placeholder: string; rows: number }): string {
  return `<div class="editor">
    <div class="editor-tabs">
      <button class="tab is-on" data-tab="write">Write</button>
      <button class="tab" data-tab="preview">Preview</button>
      <span class="md-tools">${MD_TOOLS}</span>
    </div>
    <textarea class="editor-body" rows="${options.rows}" ` +
      `placeholder="${escapeHtml(options.placeholder)}"></textarea>
    <div class="editor-preview" hidden></div>
  </div>`;
}

/**
 * The markdown buttons, in the order GitHub puts them.
 *
 * Drawn here rather than fetched, like every other glyph in the page. The last
 * one has no equivalent there because it is ours: it fills a suggestion block
 * with the lines being commented on, which is the version of that gesture worth
 * having — a suggestion has to be the whole replacement for the lines it covers,
 * and typing them out again from memory is how the wrong indentation gets in.
 */
/**
 * The suggestion button, first and set apart, as the forge places it.
 *
 * A page with a plus and a minus on it: the same glyph the forge uses, because
 * a reviewer who has seen it there should not have to work out what it is here.
 */
const SUGGEST_TOOL =
  `<button class="md" data-md="suggest" title="Suggest a replacement" ` +
  `aria-label="Suggest a replacement">` +
  `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">` +
  `<path d="M4 2.75h5.2L12 5.4v7.85a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1z" ` +
  `fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>` +
  `<path d="M9.2 2.9V5.4H11.9" fill="none" stroke="currentColor" stroke-width="1.3" ` +
  `stroke-linejoin="round"/>` +
  `<path d="M7.5 7.1v2.3M6.35 8.25h2.3M6.35 11.5h2.3" fill="none" stroke="currentColor" ` +
  `stroke-width="1.3" stroke-linecap="round"/></svg></button>`;

const MD_TOOLS = SUGGEST_TOOL + plainTools();

function plainTools(): string {
  return [
  tool("heading", "Heading", "M4 3v10M12 3v10M4 8h8"),
  tool("bold", "Bold", "M5 3h4a2.5 2.5 0 0 1 0 5H5zM5 8h4.5a2.5 2.5 0 0 1 0 5H5z"),
  tool("italic", "Italic", "M10 3H6.5M9.5 13H6M9 3l-2 10"),
  tool("quote", "Quote", "M3 4v8M6 5h7M6 8h7M6 11h4"),
  tool("code", "Code", "M6 4L2.5 8 6 12M10 4l3.5 4-3.5 4"),
  tool("link", "Link", "M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.7.7M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.7-.7"),
  tool("ul", "Bulleted list", "M6 4h8M6 8h8M6 12h8M3 4h.01M3 8h.01M3 12h.01"),
  tool("ol", "Numbered list", "M6 4h8M6 8h8M6 12h8M2 3h1v3M2 12h2M2 10h2v.01"),
    tool("task", "Task list", "M7 4h7M7 8h7M7 12h7M2 3.5l1 1 1.5-1.5M2 7.5l1 1 1.5-1.5M2 11.5l1 1 1.5-1.5"),
  ].join("");
}

/**
 * Opening the real file, rather than reading the change to it.
 *
 * Hidden until the page finds a host that can open one — the same document is
 * served from disk, where nothing here can reach an editor, and a button that
 * silently does nothing is worse than no button.
 */
/* Both directions at once: this opens what a card is not showing, and closes
   it again. */
const UNFOLD_ICON =
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<path d="M5 6.2 8 3.2l3 3M5 9.8l3 3 3-3" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const SPEECH_ICON =
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<path d="M2.5 3.4h11a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H8l-3.4 2.6V11H2.5a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z" ` +
  `fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const JUMP_ICON =
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<path d="M9.5 2.5H13v3.5M13 2.5L8 7.5" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="M12.5 9.5v3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3" ` +
  `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ` +
  `stroke-linejoin="round"/></svg>`;

/** The state pill opens something, and says so. */
const CARET =
  `<svg class="caret" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">` +
  `<path d="M4 6.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Putting the panel away. Nothing pending is lost by closing it. */
const CLOSE_ICON =
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">` +
  `<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linecap="round"/></svg>`;

function tool(kind: string, label: string, path: string): string {
  return (
    `<button class="md" data-md="${kind}" title="${escapeHtml(label)}" ` +
    `aria-label="${escapeHtml(label)}">` +
    `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">` +
    `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
  );
}

/**
 * The pending review: what has been written, and the verdict to send it with.
 *
 * Comments accumulate here rather than being posted one at a time, which is
 * both what the forge's own model expects and what spares a team a notification
 * per remark. Nothing leaves the machine until one of these three is pressed.
 */
function reviewPanel(): string {
  return `<div class="review" hidden>
  <div class="review-head"><span>Pending review · <span class="review-count">0</span></span>` +
    `<button class="review-close" title="Close" aria-label="Close">${CLOSE_ICON}</button></div>
  <div class="review-list"></div>
  ${editor({ placeholder: "Summary (required to comment or request changes)", rows: 3 })}
  <div class="review-actions">
    <button class="review-submit" data-event="APPROVE">Approve</button>
    <button class="review-submit" data-event="COMMENT">Comment</button>
    <button class="review-submit" data-event="REQUEST_CHANGES">Request changes</button>
  </div>
</div>`;
}


/**
 * Colours a card's code, one contiguous run at a time.
 *
 * Runs matter: a line taken on its own cannot be told apart from the middle of
 * a block comment, so the largest genuinely adjacent stretch is handed over at
 * once. Lines hidden inside an expandable gap are part of the stretch — they
 * are the file's own lines, just folded — while a gap that knows nothing about
 * what it hides ends it, since the next row is somewhere else in the file.
 */
function colourRows(
  node: PlacedNode,
  highlight: CodeHighlighter | undefined,
): Map<DisplayRow, CodeToken[]> {
  const coloured = new Map<DisplayRow, CodeToken[]>();
  const language = node.node.language;
  if (!highlight || !language || !highlight.supports(language)) return coloured;

  let run: DisplayRow[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const lines = highlight.tokenize(language, run.map((r) => r.text).join("\n"));
    run.forEach((row, i) => {
      const line = lines[i];
      if (line) coloured.set(row, line);
    });
    run = [];
  };

  const walk = (rows: readonly DisplayRow[]): void => {
    for (const row of rows) {
      if (row.kind === "gap") {
        if (row.rows) walk(row.rows);
        else flush();
        continue;
      }
      run.push(row);
    }
  };

  walk(node.rows);
  flush();
  return coloured;
}

/**
 * The colours a page ended up using, as classes.
 *
 * A style attribute per token would be most of the document: a large card runs
 * to thousands of tokens and a theme uses a dozen colours. Collecting them
 * turns thirty bytes a token into three.
 */
class Palette {
  private readonly names = new Map<string, string>();

  classFor(token: CodeToken): string {
    if (!token.color && !token.fontStyle) return "";
    const key = `${token.color ?? ""}|${token.fontStyle ?? 0}`;
    let name = this.names.get(key);
    if (!name) {
      name = `t${this.names.size}`;
      this.names.set(key, name);
    }
    return name;
  }

  stylesheet(): string {
    const rules: string[] = [];
    for (const [key, name] of this.names) {
      const [color, style] = key.split("|");
      const bits = Number(style);
      const parts = [
        color ? `color:${color}` : "",
        bits & 1 ? "font-style:italic" : "",
        bits & 2 ? "font-weight:bold" : "",
        bits & 4 ? "text-decoration:underline" : "",
      ].filter(Boolean);
      rules.push(`.${name}{${parts.join(";")}}`);
    }
    return rules.join("");
  }
}

function card(
  node: PlacedNode,
  layout: GraphLayout,
  highlight?: CodeHighlighter,
  palette?: Palette,
  other?: PlacedNode,
): string {
  const { metrics } = layout;
  const style =
    `left:${node.x}px;top:${node.y}px;` +
    `width:${node.width}px;height:${node.height}px`;

  const title = cardTitle(node.node);
  const was = title.was ? `<span class="was">${escapeHtml(title.was)}</span>` : "";
  // Counts carry the diff's own colours, so the card header reads at a glance.
  const counts = [
    title.additions ? `<span class="added">${escapeHtml(title.additions)}</span>` : "",
    title.deletions ? `<span class="removed">${escapeHtml(title.deletions)}</span>` : "",
  ].filter(Boolean).join(" ");
  const stats = counts
    ? `<span class="stats">${counts}</span>`
    : `<span class="stats">${escapeHtml(title.stats)}</span>`;
  const note = title.note
    ? `<span class="note" title="Odin could not look for references in this file">${escapeHtml(title.note)}</span>`
    : "";

  void metrics;

  // Every row is written into the document, including the ones the card starts
  // out hiding. Expanding is then a matter of revealing markup that is already
  // there, and the browser's own search still finds code inside a closed gap.
  const coloured = colourRows(node, highlight);
  // Carried down the card so a run of inserted lines does not print the same
  // base-side number against every one of them.
  // A file that exists on one side only has a single numbering, so both gutters
  // carry it: an empty column down a whole card reads as a column that failed
  // to draw, and the numbers are not in doubt — there is only one set of them.
  const single = node.node.status === "added" || node.node.status === "deleted";
  // Both ways of reading the change are written into the document and the page
  // shows one of them. Re-rendering on the switch would mean shipping the
  // renderer and the diff to the browser; this costs markup instead, which
  // compresses to very little because the two say the same thing.
  // Each mode caps its own card: a split card is shorter, having put pairs of
  // lines on one row, so the two disagree about how much is behind the bar.
  // Which lines an arrow touches. A card's height cap is for tails of untouched
  // context and nothing else: a line the change made, or one a reference points
  // at, must never be behind the bar however the cap was arrived at. Stated
  // here as well as in the layout, because the two have disagreed — a page
  // rendered without the other mode's measurements capped its unified cards
  // with numbers taken from split ones.
  const anchored = new Set<string>();
  for (const edge of layout.edges) {
    if (edge.edge.from.nodeId === node.id) {
      anchored.add(`${edge.edge.from.side}:${edge.edge.from.line}`);
    }
    if (edge.edge.to.nodeId === node.id) {
      anchored.add(`${edge.edge.to.side}:${edge.edge.to.line}`);
    }
  }

  const splitCap = (layout.unified ? other?.visibleRows : node.visibleRows) ?? node.visibleRows;
  const unifiedCap = (layout.unified ? node.visibleRows : other?.visibleRows) ?? node.visibleRows;

  const pairs = pairRows(node.rows);
  const split = pairs
    .map((pair, i) =>
      renderPair(
        pair,
        i >= splitCap && !held(pair.left, anchored) && !held(pair.right, anchored),
        coloured,
        palette,
        single,
      ),
    )
    .join("");
  const unified = node.rows
    .map((row, i) =>
      renderRow(row, i >= unifiedCap && !held(row, anchored), coloured, palette, single),
    )
    .join("");
  const bar = (hidden: number) =>
    hidden > 0
      ? `<div class="row more" role="button" tabindex="0">` +
        `<span class="text">show ${hidden} more lines</span></div>`
      : "";

  const unresolved = title.note ? " unresolved" : "";
  const test = node.node.isTest ? " is-test" : "";
  return `<div class="card status-${node.node.status}${unresolved}${test}" id="card-${cssId(node.id)}" ` +
    `data-id="${escapeHtml(node.id)}" data-path="${escapeHtml(node.path)}" style="${style}">
  <div class="card-title" title="${escapeHtml(node.path)}">` +
    // The same mark the file list puts beside the name, so a card and its row
    // in the list are recognisably the same file.
    `<span class="box">${STATUS_MARK[node.node.status] ?? ""}</span>` +
    `${escapeHtml(title.name)}${was}${stats}${note}` +
    // The controls the forge puts on a file header, in the order it puts them:
    // the path, the whole file, whether it has been read, and what has been
    // said about it. Grouped at the end so the name keeps the middle.
    `<span class="card-controls">` +
    `<button class="copy-path" data-hint="Copy the path to this file" title="Copy the path" aria-label="Copy the path">${COPY_ICON}</button>` +
    `<button class="unfold" data-hint="Show every line this card is holding back" title="Show the whole file" aria-label="Show the whole file">${UNFOLD_ICON}</button>` +
    `<button class="jump" data-hint="Open this file in the editor" title="Open the file" aria-label="Open the file" hidden>${JUMP_ICON}</button>` +
    `<label class="viewed" data-hint="Mark this file as read" title="Mark as reviewed">` +
    `<input type="checkbox" class="viewed-box"><span class="viewed-label">Viewed</span></label>` +
    `<button class="remarks" data-hint="Go to the first comment on this file" title="Comments on this file" aria-label="Comments on this file" hidden>` +
    `${SPEECH_ICON}<span class="tally">0</span></button>` +
    `</span></div>
  <div class="card-body split-view">${split}${bar(pairs.length - splitCap)}</div>
  <div class="card-body unified-view">${unified}${bar(node.rows.length - unifiedCap)}</div>
</div>`;
}

/** Whether a row must stay on screen: the change made it, or an arrow needs it. */
function held(row: DisplayRow | undefined, anchored: Set<string>): boolean {
  if (!row || row.kind === "gap") return false;
  if (row.kind === "add" || row.kind === "del") return true;
  return (
    (row.oldLine !== undefined && anchored.has(`base:${row.oldLine}`)) ||
    (row.newLine !== undefined && anchored.has(`head:${row.newLine}`))
  );
}

/**
 * One row of a card in unified view: one column of code, a gutter either side.
 *
 * The base number on the left and the head number on the right, which is how a
 * reader of this card asks "where is this line in each checkout". A line that
 * exists on one side only leaves the other column empty, the way the forge
 * leaves it — the alternative is either the same number repeated down a whole
 * insertion or a number the line does not have.
 */
function renderRow(
  row: DisplayRow,
  beyondCap = false,
  coloured?: Map<DisplayRow, CodeToken[]>,
  palette?: Palette,
  single = false,
): string {
  const overflow = beyondCap ? " beyond-cap" : "";

  if (row.kind === "gap") {
    const expandable = row.rows ? " expandable" : "";
    const imports = row.imports ? " imports" : "";
    const hidden = (row.rows ?? [])
      .map((inner) => renderRow(inner, beyondCap, coloured, palette, single).replace(
        'class="row ', 'class="row in-gap ',
      ))
      .join("");
    const covers = row.covers ?? {};
    const range = (side: "base" | "head") => {
      const span = covers[side];
      return span ? ` data-${side}-from="${span[0]}" data-${side}-to="${span[1]}"` : "";
    };

    return `<div class="row gap${expandable}${imports}${overflow}" title="${escapeHtml(row.header ?? "")}"` +
      range("base") + range("head") +
      (row.rows ? ' role="button" tabindex="0"' : "") + ">" +
      `<span class="text">${escapeHtml(row.text)}</span>` +
      `<span class="header">${escapeHtml(row.header ?? "")}</span></div>` +
      hidden;
  }

  // The sign sits beside the number that exists: a minus by the base number it
  // was removed from, a plus by the head number it was added at. Kept on the
  // side the line actually has, the two columns read as what happened to each
  // checkout rather than as one column of marks about the other.
  const removed = row.kind === "del" ? "\u2212" : "";
  const added = row.kind === "add" ? "+" : "";
  const anchors =
    (row.oldLine !== undefined ? ` data-old="${row.oldLine}"` : "") +
    (row.newLine !== undefined ? ` data-new="${row.newLine}"` : "");
  // A wholly added or deleted file has one numbering, so both gutters carry it.
  const showLeft = row.oldLine ?? (single ? row.newLine : undefined);
  const showRight = row.newLine ?? (single ? row.oldLine : undefined);

  return `<div class="row flat ${row.kind}${overflow}${row.inDiff ? " in-diff" : ""}"${anchors}>` +
    `<span class="marker">${removed}</span>` +
    `<span class="num old">${showLeft ?? ""}</span>` +
    `<span class="text">${code(row, coloured?.get(row), palette)}</span>` +
    `<span class="num new">${showRight ?? ""}</span>` +
    `<span class="marker right">${added}</span></div>`;
}

/**
 * One row of a card: the base of the change beside the head of it.
 *
 * The two sides are laid out as panes rather than as one stream, so a line and
 * the line that replaced it sit on the same row and both gutters carry a real
 * number. A file that exists on one side only is drawn as a single pane — the
 * other would be blank all the way down.
 */
function renderPair(
  pair: RowPair,
  beyondCap = false,
  coloured?: Map<DisplayRow, CodeToken[]>,
  palette?: Palette,
  single = false,
): string {
  const overflow = beyondCap ? " beyond-cap" : "";

  const band = pair.band;
  if (band) {
    // A gap that knows what it hides can be opened; one that does not must not
    // pretend otherwise, so it is rendered inert.
    const expandable = band.rows ? " expandable" : "";
    const imports = band.imports ? " imports" : "";
    const hidden = pairRows(band.rows ?? [])
      .map((inner) => renderPair(inner, beyondCap, coloured, palette, single).replace(
        'class="row ', 'class="row in-gap ',
      ))
      .join("");
    // What the band hides, so an arrow aimed at a folded line can find it.
    const covers = band.covers ?? {};
    const range = (side: "base" | "head") => {
      const span = covers[side];
      return span ? ` data-${side}-from="${span[0]}" data-${side}-to="${span[1]}"` : "";
    };

    return `<div class="row gap${expandable}${imports}${overflow}" title="${escapeHtml(band.header ?? "")}"` +
      range("base") + range("head") +
      (band.rows ? ' role="button" tabindex="0"' : "") + ">" +
      `<span class="text">${escapeHtml(band.text)}</span>` +
      `<span class="header">${escapeHtml(band.header ?? "")}</span></div>` +
      hidden;
  }

  // The line numbers double as anchors: after an expansion the client finds a
  // row by the line it shows rather than by an index that has since moved. A
  // row carries both, one from each pane.
  const anchors =
    (pair.left?.kind !== "gap" && pair.left?.oldLine !== undefined
      ? ` data-old="${pair.left.oldLine}"` : "") +
    (pair.right?.kind !== "gap" && pair.right?.newLine !== undefined
      ? ` data-new="${pair.right.newLine}"` : "");

  const inDiff = (row?: DisplayRow) => row !== undefined && row.kind !== "gap" && row.inDiff === true;
  const commentable = inDiff(pair.left) || inDiff(pair.right);
  // A one-sided file has a single numbering, and one pane to show it in.
  const panes = single
    ? [pane(pair.right ?? pair.left, "head", coloured, palette, true)]
    : [
        pane(pair.left, "base", coloured, palette, false),
        pane(pair.right, "head", coloured, palette, false),
      ];

  return `<div class="row split${overflow}${commentable ? " in-diff" : ""}"${anchors}>` +
    panes.join("") + `</div>`;
}

/** One side of a row: its marker, its line number, and its code. */
function pane(
  row: DisplayRow | undefined,
  side: "base" | "head",
  coloured?: Map<DisplayRow, CodeToken[]>,
  palette?: Palette,
  single = false,
): string {
  if (!row || row.kind === "gap") {
    return `<span class="side ${side} empty"></span>`;
  }

  const marker = row.kind === "add" ? "+" : row.kind === "del" ? "−" : "";
  // On a one-sided file the number shown is whichever side the file has.
  const line = single
    ? row.newLine ?? row.oldLine
    : side === "base" ? row.oldLine : row.newLine;

  return `<span class="side ${side} ${row.kind}${row.inDiff ? " in-diff" : ""}">` +
    `<span class="marker">${marker}</span>` +
    `<span class="num">${line ?? ""}</span>` +
    `<span class="text">${code(row, coloured?.get(row), palette)}</span></span>`;
}

function edgeLayer(layout: GraphLayout): string {
  // Sized in page units rather than in stroke widths: the stem is cut short by
  // exactly the head's length, and a head that grew with the stroke — the wire
  // thickens while it is followed — would leave that cut in the wrong place.
  const markers = (["added", "removed", "unchanged"] as const)
    .map(
      (change) =>
        `<marker id="arrow-${change}" viewBox="0 0 10 10" refX="10" refY="5" ` +
        `markerUnits="userSpaceOnUse" markerWidth="${HEAD}" markerHeight="${HEAD}" ` +
        `orient="auto-start-reverse">` +
        `<path d="M 0 0 L 10 5 L 0 10 z" class="head-${change}"/></marker>`,
    )
    .join("");

  const style =
    `<style>` +
    `#arrow-added path, .head-added { fill: var(--added); }` +
    `#arrow-removed path, .head-removed { fill: var(--removed); }` +
    `#arrow-unchanged path, .head-unchanged { fill: var(--unchanged); }` +
    `</style>`;

  const paths = layout.edges.map((edge) => {
    const { stem, head, full } = wire(edge);
    // Two places to press. The dot where the arrow leaves takes you to where it
    // lands; the dashes past where it lands take you back. Following a
    // reference across a large graph otherwise means finding the other end by
    // eye and then finding your way home the same way.
    // Clear of the card, not on its edge: half a dot under the border is a
    // smudge, and this one is meant to be pressed.
    const away = edge.fromSide === "right" ? 1 : -1;
    const port =
      `<circle class="port out" cx="${edge.from.x + away * PORT_GAP}" cy="${edge.from.y}" r="4.5">` +
      `<title>Go to the definition this points at</title></circle>`;
    return `<g class="edge ${edge.edge.change} ${edge.edge.kind}" data-id="${escapeHtml(edge.id)}">` +
      `<path class="hit" d="${full}"/>` +
      `<path class="wire" d="${stem}"/>` +
      `<path class="head" d="${head}" marker-end="url(#arrow-${edge.edge.change})"/>` +
      port +
      `</g>`;
  });

  return `<svg id="edges" width="${layout.width}" height="${layout.height}">` +
    `<defs>${markers}</defs>${style}${paths.join("")}</svg>`;
}

/**
 * An arrow, as three paths: what you press, what is drawn, and the head.
 *
 * The line no longer runs the whole way. It starts on the rim of the dot — drawn
 * from the card it went straight through the dot and out again, so the dot read
 * as a bead threaded onto the line rather than the thing the line leaves from —
 * and it stops where the head begins, since a stem carried on underneath a
 * filled triangle shows as a lump at the join.
 */
function wire(edge: PlacedEdge): { stem: string; head: string; full: string } {
  const away = edge.fromSide === "right" ? 1 : -1;
  const start = rim(edge.from.x + away * PORT_GAP, edge.from.y, edge.to.x, edge.to.y);
  const dx = Math.max(40, Math.abs(edge.to.x - edge.from.x) * 0.45);
  const c1 = edge.fromSide === "right" ? edge.from.x + dx : edge.from.x - dx;
  const c2 = edge.toSide === "left" ? edge.to.x - dx : edge.to.x + dx;

  const points: Point[] = [
    start,
    { x: c1, y: edge.from.y },
    { x: c2, y: edge.to.y },
    { x: edge.to.x, y: edge.to.y },
  ];
  const cut = shorten(points, HEAD);

  return {
    full: bezier(points),
    stem: bezier(cut),
    // The head rides its own segment so it can be oriented and placed without
    // anything drawn along it — the stroke is off, only the marker shows.
    head: `M ${cut[3]!.x} ${cut[3]!.y} L ${points[3]!.x} ${points[3]!.y}`,
  };
}

interface Point { x: number; y: number }

/** How far the arrow head reaches back from the line's end. */
const HEAD = 13;
/** How far the dot sits from the card. */
const PORT_GAP = 9;
/**
 * Where a line starting at the dot starts.
 *
 * The dot's own radius, which is the middle of its ring rather than the outside
 * of it: a line stopping cleanly at the outer edge leaves a hairline of
 * background between the two. This tucks the end under the ring instead.
 */
const PORT_RIM = 4.5;

function bezier(p: Point[]): string {
  return `M ${p[0]!.x} ${p[0]!.y} C ${p[1]!.x} ${p[1]!.y}, ` +
    `${p[2]!.x} ${p[2]!.y}, ${p[3]!.x} ${p[3]!.y}`;
}

/**
 * The same curve with its last `back` pixels taken off.
 *
 * Cut with de Casteljau rather than by stepping back along the end tangent: the
 * curve is at its most bent right where it arrives, so a straight backoff of a
 * head's length lands off the line and leaves a visible kink.
 */
function shorten(p: Point[], back: number): Point[] {
  const steps = 96;
  const seen: Point[] = [];
  for (let i = 0; i <= steps; i++) seen.push(pointAt(p, i / steps));

  let travelled = 0;
  let t = 0;
  for (let i = steps; i > 0; i--) {
    const step = Math.hypot(seen[i]!.x - seen[i - 1]!.x, seen[i]!.y - seen[i - 1]!.y);
    if (travelled + step >= back) {
      // Between two samples, not at one of them. On a long arrow a single step
      // is tens of pixels, and stopping at the near end of it leaves the head
      // floating that far off the end of the line.
      t = (i - 1 + (travelled + step - back) / (step || 1)) / steps;
      break;
    }
    travelled += step;
  }

  const a = mix(p[0]!, p[1]!, t);
  const b = mix(p[1]!, p[2]!, t);
  const c = mix(p[2]!, p[3]!, t);
  const d = mix(a, b, t);
  const e = mix(b, c, t);
  return [p[0]!, a, d, mix(d, e, t)].map((q) => ({ x: round(q.x), y: round(q.y) }));
}

function pointAt(p: Point[], t: number): Point {
  const a = mix(p[0]!, p[1]!, t);
  const b = mix(p[1]!, p[2]!, t);
  const c = mix(p[2]!, p[3]!, t);
  return mix(mix(a, b, t), mix(b, c, t), t);
}

function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The point on the dot's rim that faces the far end of the arrow. */
function rim(cx: number, cy: number, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: round(cx + (dx / length) * PORT_RIM),
    y: round(cy + (dy / length) * PORT_RIM),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function pathOf(layout: GraphLayout, nodeId: string): string {
  return layout.nodes.find((n) => n.id === nodeId)?.path ?? nodeId;
}

function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * One line of code, coloured if anything could colour it.
 *
 * The characters are the file's, untouched — only spans are added around them.
 * That matters for more than looks: the browser's own search still finds a
 * string inside a card, and the width the layout engine measured is still the
 * width the line takes.
 */
function code(row: DisplayRow, tokens?: CodeToken[], palette?: Palette): string {
  if (!tokens || tokens.length === 0 || !palette) return escapeHtml(row.text);

  return tokens
    .map((token) => {
      const name = palette.classFor(token);
      return name
        ? `<span class="${name}">${escapeHtml(token.text)}</span>`
        : escapeHtml(token.text);
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Embeds JSON in a `<script>` safely. Source text can legitimately contain
 * `</script>`, and a naive stringify would end the block early and put the rest
 * of the diff into the document as markup.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    // Valid in JSON, but they terminate a JavaScript string literal, and
    // source text can legitimately contain them.
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
