import type { CommentView, ReaderSettings, ViewModel } from "./model.js";

/**
 * What the page is showing, as data the components react to.
 *
 * The extension embeds a view model in the document and then sends messages
 * that change it — a rebuild starting, a check finishing, a comment arriving.
 * Under the old renderer each of those was a hand-written search of the DOM
 * for the elements it affected; here it is an assignment, and the components
 * that read the field are the ones that redraw.
 *
 * This is also what makes a rebuild cheap. The host can hand over a whole new
 * model and the page keeps its scroll, its open threads and its camera,
 * because nothing was thrown away to apply it.
 */

/** The bridge to the extension, absent when the page is opened in a browser. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export const host =
  typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

/**
 * What the host embedded, if there is a host.
 *
 * Read through a guard because this module is evaluated by Node as well as by
 * a browser: the same components are compiled a second time to render the page
 * as text, for a webview to show before its script has parsed, for the file
 * `odin view` writes, and for an SVG that will never run anything at all. On
 * that side there is no window, and reaching for one at module scope threw
 * before a component existed to be rendered — which made the failure look like
 * the renderer being broken rather than a missing global.
 *
 * The server is handed its model as a prop instead, and seeds this.
 */
function embedded(): ViewModel {
  if (typeof window !== "undefined" && window.__ODIN__) return window.__ODIN__;
  return EMPTY;
}

/**
 * A page with nothing in it.
 *
 * Not an error: rendering on the server starts here and is given the real
 * model a moment later, and a browser that opened the document before the host
 * wrote it gets an empty drawing rather than a stack trace.
 */
const EMPTY: ViewModel = {
  width: 0,
  height: 0,
  rowGap: 0,
  charWidth: 0,
  textLeft: 0,
  padding: 0,
  gutterWidth: 0,
  columnGap: 0,
  margin: 0,
  nodes: [],
  edges: [],
  parts: [],
  meta: { baseRef: "", headRef: "" },
  arrangements: {
    withTests: { width: 0, height: 0, nodes: {} },
    withoutTests: { width: 0, height: 0, nodes: {} },
  },
  unified: false,
  canReview: false,
  review: "",
  viewer: "",
  viewerFace: "",
  comments: [],
};

/** The graph, the layout and everything drawn from them. */
export const model = $state<{ current: ViewModel }>({ current: embedded() });

/**
 * Where the reader has the drawing, in canvas units.
 *
 * `placed` says whether they have moved it themselves. A resize of a view
 * nobody has touched should grow the picture to fill the room; a resize of one
 * they have framed should keep their framing and let the room appear at the
 * edges. `framed` is the viewport that framing was made against.
 */
export const view = $state({
  x: 0,
  y: 0,
  scale: 1,
  placed: false,
  framed: null as { width: number; height: number } | null,
});

/**
 * How the change is being read, as opposed to what it is.
 *
 * Every one of these survives a rebuild: they are the reader's choices, and a
 * graph arriving from disk is no reason to undo them.
 */
const DEFAULTS: ReaderSettings = {
  unified: false,
  showTests: false,
  showImports: true,
  showUnchanged: false,
  hideViewed: false,
  showInfra: true,
  hud: { reviewers: true, comments: true, map: true, checks: true, checksFolded: false },
};

/**
 * The defaults, with whatever the host remembered laid over them.
 *
 * Field by field rather than wholesale, and the same for the panels inside
 * `hud`. A setting introduced after the reader last changed anything has no
 * stored answer, and taking the stored object entire would hand it `undefined`
 * — so a new toggle would arrive switched off for everyone who had ever opened
 * the settings panel, and on for everyone who had not.
 */
function remembered(): ReaderSettings {
  const saved = embedded().settings ?? {};
  return {
    ...DEFAULTS,
    ...saved,
    hud: { ...DEFAULTS.hud, ...(saved.hud ?? {}) },
  };
}

export const settings = $state<ReaderSettings>(remembered());

/**
 * Hands the reader's choices to the host, which is the only thing here that
 * outlives the page.
 *
 * These are about the reader rather than about the change — somebody who does
 * not want to see imports does not want to see them in the next review either —
 * so the host keeps them against the editor rather than against the repository.
 *
 * Called from a single effect over the whole object rather than from each
 * control, so a setting added later is carried without anybody remembering to
 * wire it up.
 */
export function watchSettings(): void {
  // Reading them all is what subscribes to them all.
  const now = $state.snapshot(settings);
  if (!host) return;
  notify("settings", now);
}

/**
 * The parts of the page that are about the page rather than about the change.
 *
 * `refreshing` is the working tree being read again because the reader saved
 * something; `note` says what provoked it, when the host knows.
 */
export const ui = $state({
  refreshing: false,
  note: "Refreshing",
  /** How many times the forge has answered about the checks. */
  checksAt: 0,
  /** The part of the change on screen, or null for all of it. */
  part: null as string | null,
  /** Files the reader has marked off. */
  viewed: new Set<string>(),
  /** The card and edge under the reader's attention, for dimming the rest. */
  activeNode: null as string | null,
  activeEdge: null as string | null,
  /**
   * The conversation on screen, and where its mark is.
   *
   * Shared rather than owned by the thread, because three things open one: the
   * mark in the margin, the reviewer list, and a card's remarks button. Held
   * as the root comment's id rather than the thread itself, so a reply
   * arriving does not have to be found and re-opened — the thread derives
   * itself from the comments and simply contains the new one.
   */
  thread: null as { id: string; anchor: DOMRect | null } | null,
  /**
   * Where a new remark is being written.
   *
   * The composer is anchored to a row rather than living in the card, because
   * a box inside a card changes that card's height, and every arrow below it
   * is placed from that height.
   */
  composer: null as {
    path: string;
    /*
     * The forge's spelling, not the drawing's.
     *
     * Everywhere else in this page a side is `base` or `head`, because that is
     * what the two halves of a diff are called. A comment is different: it
     * leaves this page and goes to GitHub, which accepts only `LEFT` and
     * `RIGHT` and rejects anything else — after the reader has written it.
     * Carrying the forge's word this far means the translation happens once,
     * where the pick is made, rather than being remembered at the moment of
     * posting by whoever is posting.
     */
    side: "LEFT" | "RIGHT";
    /**
     * The line the remark is filed against — the last of a range.
     *
     * Absent for a remark about the file itself, which has no line to sit on:
     * "this file should not exist" pinned to line one reads as a note about an
     * import. The composer and `drafts.ts` have always modelled it that way;
     * this said `number`, so the one place that opens a file-level composer had
     * to cast its way past the declaration to say a true thing.
     */
    line?: number;
    /** The first of a range, absent when only one line was picked. */
    startLine?: number;
    /** The picked code, so a suggestion can start from what is there. */
    lines?: string[];
    /*
     * Two boxes, not one. The composer is placed against the row it is about
     * and held within the card that row belongs to — a box anchored to the row
     * alone would hang off the side of a narrow card.
     */
    anchor: { row: DOMRect; card: DOMRect } | null;
  } | null,
  /**
   * Which cards are on the canvas right now.
   *
   * Derived by the canvas from the part, the filters and what has been read,
   * and published here because two things outside the canvas need the same
   * answer — the map draws these and no others, and the reviewer list shows
   * the faces belonging to them. Re-deriving that rule in three places is how
   * three places come to disagree about it.
   */
  visible: new Set<string>(),
});

/**
 * A review being written, which is not part of the change.
 *
 * Kept here because the two components that touch it are siblings: the
 * composer appends a remark and the review panel lists them and takes them
 * away again. Passing one array down and binding it to both made the parent
 * the owner of something neither of its children could describe.
 */
export const review = $state({
  drafts: [] as {
    id: string;
    path: string;
    side: "base" | "head";
    line: number;
    startLine?: number;
    body: string;
  }[],
  summary: "",
  open: false,
});

/**
 * A comment as the page names its fields.
 *
 * The forge calls the author's picture `avatarUrl`; this model calls it
 * `avatar`. The document the host builds does that renaming as it embeds the
 * first set of comments, and then the refresh — a reply arriving, a review
 * being posted — sends the forge's own shape straight down the channel. Two
 * spellings for one field meant a face that was there when the page opened and
 * gone the moment anybody said anything, which is not a failure anyone would
 * think to look for in a message handler.
 *
 * Renaming here rather than at the sending end because this is where the
 * model's names are decided, and there is more than one sender.
 */
function normalise(comments: unknown): CommentView[] {
  if (!Array.isArray(comments)) return [];
  return comments.map((comment) => {
    const c = comment as CommentView & { avatarUrl?: string };
    if (c.avatar === undefined && c.avatarUrl) {
      return { ...c, avatar: c.avatarUrl };
    }
    return c;
  });
}

/**
 * Sends something to the extension, and does nothing without one.
 *
 * Snapshotted on the way out. Anything held in `$state` is handed around as a
 * proxy, and the channel to the extension copies what it is given rather than
 * sharing it — a proxy has no copy, so it throws `DataCloneError` and the
 * message is simply lost. That is a whole review's worth of drafts disappearing
 * on the press of a button, and it is invisible from the host side, which
 * merely never hears anything. Doing it here rather than at each caller means a
 * payload cannot acquire the fault later by being made reactive.
 */
export function notify(type: string, payload?: unknown): void {
  host?.postMessage({ type, payload: $state.snapshot(payload) });
}

/**
 * Where the host may send the reader, once the page has somewhere to send them.
 *
 * Pressing a file in the side bar, or one of the references under it, is a
 * message that ends in a camera flight — and the camera is the one thing this
 * module must not know about. Everything on this page reads the state; the
 * camera reads it too, so importing it back would tie the two into a knot for
 * the sake of two calls, and the leaf of the graph would suddenly drag the
 * placement, the arrows and the measurements into anything that wanted a
 * setting.
 *
 * So the page hands its answers in. Filled by the component that owns the
 * drawing and emptied when it goes; absent while the page is being rendered to
 * text on the server, where there is no camera and nobody to press anything.
 */
export const travel: {
  toFile?: (path: string) => void;
  toLine?: (path: string, line: number, side: "base" | "head") => void;
} = {};

/**
 * Everything the host says, routed to the field it belongs to.
 *
 * One listener rather than one per concern: the messages arrive on a single
 * channel, and a page that registered six listeners would run all six for
 * every message anyway.
 */
export function listen(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data;
    if (!message || typeof message.type !== "string") return;

    switch (message.type) {
      case "refreshing":
        ui.refreshing = message.value === true;
        if (message.note) ui.note = message.note;
        return;

      // A rebuilt graph, applied without the document being replaced. This is
      // the whole reason for the reactive rendering: the reader keeps their
      // camera, their scroll and whatever thread they had open.
      case "model": {
        if (!message.payload) return;
        const next = message.payload as ViewModel;
        /*
         * The forge's verdicts survive a rebuild.
         *
         * A rebuild is a new reading of the working tree, and it has nothing to
         * say about what CI made of the branch — but it replaces the model
         * whole, so anything the host had only ever sent as a message went with
         * it. The checks panel disappeared on the first save after it appeared.
         */
        if (next.checks === undefined && model.current.checks !== undefined) {
          next.checks = model.current.checks;
        }
        model.current = next;
        return;
      }

      /*
       * A few cards' rows, and deliberately nothing else.
       *
       * Swapping the whole model is cheap for the host and not free for the
       * page: every card object is replaced, so everything derived from any of
       * them is recomputed — including the map in the corner, which is drawn
       * from the cards and has nothing whatever to say about somebody editing
       * a comment inside one. The reader sees the map flicker on every save,
       * for a change it cannot represent.
       *
       * So the host names the cards it redrew and this writes into the node
       * objects the page already has. Each node is its own piece of state, so
       * assigning one card's rows wakes that card and no other: the map reads
       * a node's box and its status, and if neither moved it is never told
       * anything happened.
       *
       * Which is why every field is compared before it is written. Assigning
       * an identical width is still an assignment, and to everything watching
       * that width it is indistinguishable from a card that moved.
       */
      case "rows": {
        const patches: Record<string, unknown>[] = Array.isArray(message.nodes)
          ? message.nodes
          : [];
        /*
         * Arrows the host cannot vouch for yet.
         *
         * Taken out of the drawing and nothing else. The host still has them —
         * it has to, because which files are connected is what decides the
         * parts and the whole arrangement, and a graph two arrows short lays
         * out differently. Withdrawing them here rather than there is what
         * keeps the picture still: the cards do not move, the strip does not
         * rename itself, and the reader's view stays where they put it. They
         * come back with the next answer, on the right lines.
         */
        const withdraw: string[] = Array.isArray(message.withdraw)
          ? message.withdraw
          : [];
        if (withdraw.length > 0) {
          const gone = new Set(withdraw);
          model.current.edges = model.current.edges.filter((e) => !gone.has(e.id));
        }

        for (const patch of patches) {
          const node = model.current.nodes.find((n) => n.id === patch["id"]);
          if (!node) continue;
          const fields = node as unknown as Record<string, unknown>;
          for (const key of Object.keys(patch)) {
            if (key === "id") continue;
            // `rows` is an array rebuilt every time and never equal by
            // identity, so it is always written; it is also the one thing this
            // message exists to deliver.
            if (key !== "rows" && fields[key] === patch[key]) continue;
            fields[key] = patch[key];
          }
        }
        return;
      }

      case "checks":
        model.current.checks = message.payload;
        // Counted as well as stored. A refresh that comes back saying exactly
        // what it said before is still an answer, and the control that asked
        // has to stop spinning — which it cannot tell from the payload, since
        // an unchanged summary is an unchanged summary.
        ui.checksAt += 1;
        return;

      case "comments":
        model.current.comments = normalise(message.comments);
        return;

      // The verdict landed. The forge's own copy of the review comes back with
      // it, so the page stops showing what was pending and starts showing what
      // was posted — done here rather than in the panel that sent it, because
      // every component reading the comments needs the same answer.
      case "reviewSubmitted":
        if (message.comments) model.current.comments = normalise(message.comments);
        return;

      // A file was pressed in the side bar. The list is a way around the
      // drawing rather than a way out of it, so this moves the camera and
      // opens nothing: the card's own button is where opening a file is asked
      // for.
      case "focus":
        if (typeof message.path === "string") travel.toFile?.(message.path);
        return;

      // One of the references under a file. It names where it lands rather than
      // which arrow it is, because that is what a row in the list knows — and
      // because the same three fields would open an editor at the same place.
      case "line":
        if (typeof message.path === "string" && typeof message.line === "number") {
          travel.toLine?.(
            message.path,
            message.line,
            message.side === "base" ? "base" : "head",
          );
        }
        return;

      case "setViewed": {
        const paths: string[] = message.paths ?? [];
        const next = new Set(ui.viewed);
        for (const path of paths) {
          if (message.viewed === true) next.add(path);
          else next.delete(path);
        }
        ui.viewed = next;
        return;
      }
    }
  });
}
