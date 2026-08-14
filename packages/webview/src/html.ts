import {
  DARK_THEME,
  cardTitle,
  components,
  describeGaps,
  pairRows,
  singlePane,
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

import { APP_SCRIPT, APP_STYLES } from "./generated/app.js";
import { renderApp } from "./generated/ssr.js";
import { ODIN_MARK } from "./mark.js";
import { tokens } from "./tokens.js";

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
   * How the reader last had the page set up, if the host remembers such things.
   *
   * Written into the document rather than sent after it, so a page never draws
   * itself one way and then redraws itself the other while the reader watches.
   * Opaque to the host that stores it: what a setting means, and what it falls
   * back to when it is missing, belongs to the page.
   */
  settings?: Record<string, unknown>;
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

  // The same cards measured the other way round. Each reading caps its own
  // card, so the number for the mode that is not on screen has to come from
  // the arrangement that measured it.
  const alternate = options.alternate
    ? new Map(
        (options.alternate.withTests ?? options.alternate.layout).nodes.map(
          (n) => [n.id, n],
        ),
      )
    : undefined;

  const viewModel = {
    ...(options.settings ? { settings: options.settings } : {}),
    width: layout.width,
    height: layout.height,
    rowGap: layout.metrics.rowGap,
    // The width of one character, for placing a mark over a symbol without
    // measuring text in the browser — the same number the layout engine used.
    charWidth: layout.metrics.charWidth,
    // Where a row's first character sits: the marker column, the base number,
    // the padding between that and the code, and the strip kept clear between
    // them for the marks a reader picks lines with. That strip is part of the
    // answer because it is part of the card the engine measured — leave it out
    // and everything placed from this number lands a column early.
    textLeft:
      layout.metrics.padding +
      layout.metrics.gutterWidth +
      layout.metrics.pickColumn,
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
      // What kind of change it is, for the map in the corner: it draws files as
      // rectangles and colour is all it has to say what they are.
      status: n.node.status,
      // A file, unless something assembled it. The settings menu offers the
      // database switch only when there is a schema on the canvas, and it can
      // only decide that for itself if the vertices say what they are.
      ...(n.node.kind ? { kind: n.node.kind } : {}),
      // The diff itself, coloured here where the grammar lives. Every row,
      // including the ones behind the bar: expanding a band should reveal what
      // is already in the page rather than ask the host for three lines.
      rows: withTokens(n.rows, colourRows(n, options.highlight)),
      title: cardTitle(n.node),
      single: singlePane(n.node),
      ...caps(n, layout, alternate?.get(n.id)),
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
      // What the far end is called here, when the two ends spell it
      // differently — generated code says `ACCOUNT` for a table called
      // `account`, and the mark has to sit on the word that is written.
      fromSymbol: e.edge.from.symbolName ?? "",
      label: e.edge.label ?? "",
    })),
    parts: [
      ...parts
        .filter((p) => p.files > 1)
        .map((p) => ({
          id: p.id,
          nodes: p.nodeIds,
          // What the strip calls it. Sent rather than worked out in the page:
          // the id happens to be the first node's id today, and a strip that
          // silently lost its labels when that stopped being true would be
          // worse than one that is simply told.
          label: graph.nodes.find((n) => n.id === p.id)?.path ?? "",
        })),
      {
        id: "loose",
        nodes: parts.filter((p) => p.files === 1).flatMap((p) => p.nodeIds),
        label: "Loose files",
      },
    ],
    // The forge's own facts, for the bar across the top. None of it places
    // anything, which is why it is kept apart from the drawing.
    meta: {
      baseRef: graph.meta.baseRef,
      headRef: graph.meta.headRef,
      ...(graph.meta.authors ? { authors: graph.meta.authors } : {}),
      ...(graph.meta.pullRequest
        ? {
            pullRequest: {
              number: graph.meta.pullRequest.number,
              title: graph.meta.pullRequest.title,
              url: graph.meta.pullRequest.url,
              ...(graph.meta.pullRequest.draft !== undefined
                ? { draft: graph.meta.pullRequest.draft }
                : {}),
              ...(graph.meta.pullRequest.reviewDecision
                ? { reviewDecision: graph.meta.pullRequest.reviewDecision }
                : {}),
              // Already inlined as data URIs by whoever built the graph: a
              // webview will not fetch a remote image, and a face that has to
              // be asked for is a face that never arrives.
              ...(graph.meta.pullRequest.reviewers
                ? { reviewers: graph.meta.pullRequest.reviewers }
                : {}),
            },
          }
        : {}),
      ...(graph.meta.worktree ? { worktree: true } : {}),
    },
    canReview: options.canReview === true,
    // What a half-written review is filed under between page loads: the pull
    // request if there is one, the pair of refs if there is not.
    review: graph.meta.pullRequest
      ? `pr:${graph.meta.pullRequest.number}`
      : `${graph.meta.baseRef}..${graph.meta.headRef}`,
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

  /*
   * The document, rendered twice over.
   *
   * The markup comes from the components running on this side, so a webview
   * shows the change the moment the panel opens rather than a blank rectangle
   * while a bundle parses — and a file written to disk is a readable page even
   * where the script never runs. The same components then wake up in the
   * browser and take the markup over.
   *
   * They are handed the identical object: `window.__ODIN__` is what the
   * browser half reads, and rendering from anything else here would produce
   * markup the script did not expect to find.
   */
  const rendered = renderApp(viewModel);

  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    ...(options.csp ? [contentSecurityPolicy(options.csp)] : []),
    `<title>${escapeHtml(title)}</title>`,
    // Only the vocabulary. Every rule that draws anything now lives in the
    // component that draws it.
    `<style>${tokens(theme, layout.metrics)}</style>`,
    // The components' own styles, scoped by the compiler. They come after the
    // page's, so a component that means to override one can.
    `<style>${APP_STYLES}</style>`,
    rendered.head,
    `</head><body>`,
    `<div id="app">${rendered.body}</div>`,
    `<script${nonce}>window.__ODIN__=${jsonForScript(viewModel)};</script>`,
    `<script${nonce}>${APP_SCRIPT}</script>`,
    `</body></html>`,
  ].join("\n");
}

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

  // The strip that scrolls sits inside a rail that does not. The rail carries
  // the background: the fade at a travelling edge is drawn by masking the
  // strip, and a mask takes the element's own background with it — which left a
  // notch of the header showing through at exactly the edge being pointed at.
  return `<div class="parts-rail"><div class="parts">` +
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
    `</div></div>`;
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
function prBar(graph: ChangeGraph, canReview = false, notes = ""): string {
  const meta = graph.meta;
  // A switch for something the change does not have is a switch that teaches
  // the reader nothing, so the database only appears in the menu when there is
  // a schema on the canvas.
  const hasSchema = graph.nodes.some((n) => n.kind === "database");
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
  <span class="refreshing" hidden aria-live="polite">${SPINNER}<span class="refreshing-note">Refreshing</span></span>
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
      <span class="settings-title">Settings</span>
      <span class="settings-rule"></span>
      <span class="settings-group">Diff display</span>
      <label class="settings-option"><input type="radio" name="diff-mode" value="unified"><span>Unified</span></label>
      <label class="settings-option"><input type="radio" name="diff-mode" value="split"><span>Split</span></label>
      <span class="settings-rule"></span>
      <span class="settings-group">Show</span>
      <label class="settings-option" title="Import statements and the arrows they produce"><input type="checkbox" id="filter-imports"><span>Imports</span></label>
      <label class="settings-option"><input type="checkbox" id="filter-unchanged"><span>Unchanged references</span></label>
      <label class="settings-option" title="Test files reference a great deal of what they exercise, which buries the change under them"><input type="checkbox" id="filter-tests"><span>Tests</span></label>
      <label class="settings-option" title="Hides untouched files once everything referencing them has been read. Files the change touched always stay."><input type="checkbox" id="filter-viewed"><span>Hide viewed relations</span></label>
      ${hasSchema
        ? `<label class="settings-option" title="The database schema as a card of its own, and the migrations and generated code that reach it"><input type="checkbox" id="filter-infra" checked><span>Database</span></label>`
        : ""}
      <span class="settings-rule"></span>
      <span class="settings-group">View</span>
      <label class="settings-option"><input type="checkbox" data-hud="reviewers" checked><span>Reviewers</span></label>
      <label class="settings-option"><input type="checkbox" data-hud="comments" checked><span>Comments</span></label>
      <label class="settings-option"><input type="checkbox" data-hud="map" checked><span>Map</span></label>
      <span class="settings-rule"></span>
      <span class="settings-actions">
        <button id="action-fit">Fit the drawing</button>
        <button id="action-keys">Keys</button>
      </span>
      <div class="keys-panel" hidden></div>
      ${notes}
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

/** The X each corner carries, for turning that corner off from where it is. */
const HUD_CLOSE = (part: string, what: string) =>
  `<button class="hud-close" data-close="${part}" title="Hide ${what}" ` +
  `aria-label="Hide ${what}">` +
  `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">` +
  `<path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linecap="round"/></svg></button>`;

const CHEVRON_DOWN =
  `<svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">` +
  `<path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
 * What the page could not do, said once and quietly.
 *
 * Files with diff lines and no arrows, and languages nothing could colour.
 * Neither stops a review, and both explain something a reader would otherwise
 * put down to a bug — so they belong where the settings are, not across the
 * top of the drawing.
 */
function notes(graph: ChangeGraph, highlight?: CodeHighlighter): string {
  const gaps = describeGaps(graph.meta.coverage);
  const missing = paint(highlight);
  if (!gaps && !missing) return "";

  return `<span class="settings-rule"></span>` +
    (gaps
      ? `<span class="settings-note" title="These files have diff lines but no arrows, because nothing could read them">${escapeHtml(gaps)}</span>`
      : "") +
    missing;
}

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

  return `<div class="review-list"><div class="review-head">Reviewers` +
    `${HUD_CLOSE("reviewers", "the reviewers")}</div>${rows}</div>`;
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
 * The spinner beside "Refreshing".
 *
 * An arc rather than a ring of dots: the arc is one path, so it spins as a
 * single transform and costs nothing while a rebuild is holding the extension
 * host busy. Drawn from the same geometry as the progress ring beside it, so
 * the two sit at the same optical weight in the bar.
 */
const SPINNER =
  `<svg class="spinner" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">` +
  `<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8" ` +
  `opacity="0.25"/>` +
  `<circle class="spin-arc" cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-dasharray="10 29"/></svg>`;

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

/**
 * The mark git puts where a file ends without a newline.
 *
 * A circle struck through, which is what every forge draws for it, because a
 * reviewer who has seen it once recognises it and one who has not can hover it.
 * Nothing in the code says this: the last line looks the same either way, and
 * the difference only appears the next time somebody appends to the file and
 * their line lands on the end of this one.
 */
const NO_NEWLINE_ICON =
  `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">` +
  `<circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
  `<path d="M5.2 8h5.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const NO_NEWLINE_LABEL = "No newline at end of file";

/**
 * The mark, when this row is the line git said that about.
 *
 * Drawn inside the row rather than on one of its own, because every card's
 * height is worked out from how many rows it has, and a row nobody can point an
 * arrow at would move every arrow below it.
 */
function noNewlineMark(row: DisplayRow | undefined): string {
  if (!row || row.kind === "gap" || !row.noNewline) return "";
  return `<span class="no-newline" title="${NO_NEWLINE_LABEL}" ` +
    `aria-label="${NO_NEWLINE_LABEL}">${NO_NEWLINE_ICON}</span>`;
}

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
 * The rows with their colours carried on them.
 *
 * The old renderer kept a `Map` from row to tokens because the two were joined
 * a moment later in the same function. Crossing into a page means the join has
 * to survive being serialised, and a map does not — so the tokens ride the row
 * they belong to. Bands are walked into: a row folded away is still a row, and
 * opening a band should not reveal uncoloured code.
 */
function withTokens(
  rows: readonly DisplayRow[],
  coloured: Map<DisplayRow, CodeToken[]>,
): DisplayRow[] {
  return rows.map((row) => {
    if (row.kind === "gap") {
      return row.rows ? { ...row, rows: withTokens(row.rows, coloured) } : row;
    }
    const tokens = coloured.get(row);
    return tokens ? { ...row, tokens } : row;
  });
}

/**
 * How much of each card is shown before the bar, in each reading.
 *
 * Taken from whichever arrangement measured that reading rather than from the
 * one on screen. Stated here as well as in the layout because the two have
 * disagreed: a page rendered without the other mode's measurements capped its
 * unified cards with numbers taken from split ones.
 */
function caps(
  node: PlacedNode,
  layout: GraphLayout,
  other: PlacedNode | undefined,
): { splitCap: number; unifiedCap: number } {
  return {
    splitCap: (layout.unified ? other?.visibleRows : node.visibleRows) ?? node.visibleRows,
    unifiedCap: (layout.unified ? node.visibleRows : other?.visibleRows) ?? node.visibleRows,
  };
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
  const single = singlePane(node.node);
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
  // Which sides of the file actually changed, for the reading of a card too
  // small to show its lines: a two-pane card painted half red would be
  // claiming removals from a file that only ever gained.
  const oneWay = node.node.stats.deletions === 0
    ? " only-added"
    : node.node.stats.additions === 0
      ? " only-removed"
      : "";
  return `<div class="card status-${node.node.status}${unresolved}${test}${oneWay}" id="card-${cssId(node.id)}" ` +
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
  ${primaryBody(layout.unified,
    `<div class="card-body split-view">${split}${bar(pairs.length - splitCap)}</div>`,
    `<div class="card-body unified-view">${unified}${bar(node.rows.length - unifiedCap)}</div>`)}
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
    `<span class="text">${code(row, coloured?.get(row), palette)}${noNewlineMark(row)}</span>` +
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
    `<span class="text">${code(row, coloured?.get(row), palette)}${noNewlineMark(row)}</span></span>`;
}

/**
 * The mark a schema card wears.
 *
 * A card whose rows are tables is not a file, and the fastest way to say so is
 * the shape everybody already reads as a database. Drawn beside the card rather
 * than inside it, since a card clips its own contents.
 */
const SCHEMA_MARK =
  '<svg viewBox="0 0 48 42" width="44" height="38" aria-hidden="true">' +
  '<ellipse cx="24" cy="9" rx="17" ry="6.6"/>' +
  '<path d="M7 9v23c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6V9"/>' +
  '<path d="M7 17c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6"/>' +
  '<path d="M7 25c0 3.6 7.6 6.6 17 6.6s17-3 17-6.6"/>' +
  "</svg>";

function schemaMarks(layout: GraphLayout): string {
  return layout.nodes
    .filter((n) => n.node.kind === "database")
    .map(
      (n) =>
        `<div class="schema-mark" data-id="${escapeHtml(n.node.id)}" ` +
        `style="left:${Math.round(n.x + n.width / 2 - 22)}px;top:${n.y - 46}px">` +
        `${SCHEMA_MARK}</div>`,
    )
    .join("");
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

  const schema = new Set(
    layout.nodes.filter((n) => n.node.kind === "database").map((n) => n.node.id),
  );

  const paths = layout.edges.map((edge) => {
    const { stem, head, full } = wire(edge);
    // An arrow into or out of a schema card describes the shape of the
    // database rather than a change to it, and is never hidden by a filter
    // about references that did not change.
    const structural =
      schema.has(edge.edge.to.nodeId) || schema.has(edge.edge.from.nodeId)
        ? " schema"
        : "";
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
    return `<g class="edge ${edge.edge.change} ${edge.edge.kind}${structural}" data-id="${escapeHtml(edge.id)}">` +
      `<path class="hit" d="${full}"/>` +
      `<path class="wire" d="${stem}"/>` +
      // The road onwards, when this arrow is the one carrying a gathered run,
      // and the wider invisible stroke that makes it pressable. Both empty
      // until the page decides which arrows travel together.
      `<path class="road-hit" d=""/>` +
      `<path class="trunk" d=""/>` +
      `<path class="head" d="${head}" marker-end="url(#arrow-${edge.edge.change})"/>` +
      port +
      `</g>`;
  });

  return `<svg id="edges" class="edges" width="${layout.width}" height="${layout.height}">` +
    `<defs>${markers}</defs>${style}${paths.join("")}</svg>`;
}

/**
 * The way back, drawn over the cards rather than under them.
 *
 * The dot at an arrow's head belongs just inside the card it arrives at — the
 * head is already on the border, and a dot beyond it sits out in the canvas the
 * arrow has just crossed. But the cards are drawn after the arrows, so a dot
 * inside one is a dot underneath it. It gets its own layer, laid over the
 * cards, holding nothing but these.
 */
function portLayer(layout: GraphLayout): string {
  // An arrow read forwards leaves the reader somewhere they did not choose to
  // be, and the way home was a shape they had to find by eye; this is the same
  // journey offered in reverse, in the same place they pressed to make it.
  const ports = layout.edges.map((edge) => {
    const back = edge.toSide === "left" ? 1 : -1;
    return `<g class="edge ${edge.edge.change} ${edge.edge.kind}" data-id="${escapeHtml(edge.id)}">` +
      `<circle class="port in" cx="${edge.to.x + back * PORT_GAP}" cy="${edge.to.y}" r="4.5">` +
      `<title>Go back to where this is called from</title></circle></g>`;
  });

  return `<svg id="ports" class="edges" width="${layout.width}" height="${layout.height}">` +
    ports.join("") +
    `</svg>`;
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
/**
 * One line of code, coloured.
 *
 * Runs are merged before they become markup. A grammar emits a token per
 * lexical unit — a name, the dot after it, the space after that — and most
 * neighbours land on the same colour, so a line arrives as a dozen tokens and
 * needs three spans. Whitespace never needs one at all: there is nothing in a
 * run of spaces for a colour to show, and leaving it unwrapped lets the plain
 * runs either side of it join up.
 *
 * The saving is the document's size, which is most of what a large change
 * costs the browser: on a forty-file change these spans were half of every
 * element on the page.
 */
/**
 * The two readings of a card: the one being read, and the one in reserve.
 *
 * Only one of them is in the document. A card carries a few hundred rows and a
 * change carries dozens of cards, and having both readings live doubled every
 * element on the page for a mode the reader is not in — style, layout and
 * memory paid twice over for something invisible.
 *
 * The other reading waits in a `template`, which the browser parses into a
 * fragment of its own rather than into the page: no styles resolved, nothing
 * laid out, nothing painted. Switching modes swaps the two over, which is one
 * move per card and nothing to rebuild.
 */
function primaryBody(unified: boolean, split: string, flat: string): string {
  const live = unified ? flat : split;
  const spare = unified ? split : flat;
  return `${live}<template class="spare-body">${spare}</template>`;
}

function code(row: DisplayRow, tokens?: CodeToken[], palette?: Palette): string {
  if (!tokens || tokens.length === 0 || !palette) return escapeHtml(row.text);

  const parts: string[] = [];
  let run = "";
  let runClass: string | undefined;

  const flush = () => {
    if (!run) return;
    parts.push(runClass ? `<span class="${runClass}">${escapeHtml(run)}</span>` : escapeHtml(run));
    run = "";
  };

  for (const token of tokens) {
    // Whitespace joins whichever run it finds itself in.
    const name = /^\s*$/.test(token.text) ? runClass : palette.classFor(token);
    if (name !== runClass) {
      flush();
      runClass = name;
    }
    run += token.text;
  }
  flush();

  return parts.join("");
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
