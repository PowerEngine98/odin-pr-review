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
 * The one piece of state a webview keeps across a reload, shared.
 *
 * There is exactly one slot, and two things want it: the camera, so a reader
 * comes back to the two cards they were reading rather than to the whole
 * picture at ten per cent, and the reading itself, so the host can tell one
 * restored frame from another.
 *
 * Both used to call `setState` directly, which meant each quietly replaced the
 * other. The camera lost its place on every rebuild — the agent changes a file,
 * the graph is rebuilt, and the reader is thrown across the drawing — and the
 * reading was lost whenever the camera moved. Neither failure said anything.
 *
 * So it is one object with a name per tenant, merged rather than overwritten.
 */
export function keep(part: Record<string, unknown>): void {
  if (!host) return;
  try {
    const held = (host.getState() ?? {}) as Record<string, unknown>;
    host.setState({ ...held, ...part });
  } catch {
    /* a host that will not hold state is not worth failing a paint over */
  }
}

/** Whatever that tenant last kept, if anything. */
export function held<T>(name: string): T | undefined {
  if (!host) return undefined;
  try {
    const all = (host.getState() ?? {}) as Record<string, unknown>;
    return all[name] as T | undefined;
  } catch {
    return undefined;
  }
}

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
 * Told before the drawing changes under the reader, so their place can be kept.
 *
 * A hook rather than a call, because what has to happen is the camera's own
 * business and this module is imported by the camera — naming it here directly
 * would be a cycle between the two. It is registered when a canvas mounts and
 * is nothing at all in a page that has none, which is every rendering done by
 * Node.
 *
 * Deliberately before rather than after: where the reader is has to be read
 * against the arrangement they were looking at, and by the time the new model
 * is assigned that arrangement is gone.
 */
export const rebuilding = { before: null as (() => void) | null };

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
  hud: {
    reviewers: true,
    comments: true,
    map: true,
    checks: true,
    checksFolded: false,
    // On by default, and still invisible over a reading of the forge's copy:
    // there is nothing for an agent to change in a picture of somebody else's
    // commits, and a panel offering it would be offering a thing that cannot
    // work.
    agents: true,
    agentsFolded: false,
  },
  pairing: [],
  terminals: [],
  terminalsFolded: [],
  agency: {},
  terminalWidth: 360,
  terminalHeight: 320,
  diagrams: {},
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
  /** Agents mid-turn, for the badge on what they were asked. */
  busyAgents: new Set<string>(),
  /** What each agent has printed this session, by agent id. */
  transcripts: {} as Record<string, string>,
  /**
   * Which agent has claimed which conversation, by the thread's root comment.
   *
   * Decided by the host, because the same rule decides who the next message in
   * that thread goes to — and two spellings of it would drift into the thread
   * naming one agent while the work went to another.
   */
  owners: {} as Record<string, string>,
  /**
   * Agents that have a conversation about this reading to carry on from.
   *
   * An agent that remembers the last hour of this change behaves differently
   * from one meeting it for the first time, and nothing else on screen tells
   * those two apart.
   */
  carrying: new Set<string>(),
  /** What the reader calls each agent's conversation, where they named one. */
  labels: {} as Record<string, string>,
  /**
   * Which rungs of the ladder each tool actually offers.
   *
   * Not every tool has a word for every level, and a control offering one the
   * tool has never heard of is a control that silently does nothing.
   */
  rungs: {} as Record<string, string[]>,
  /** The conversation id each agent is carrying, for copying out. */
  sessions: {} as Record<string, string>,
  /**
   * What an agent has asked to do and nobody has answered yet.
   *
   * Shown in two places — the thread, which is the record, and the terminal,
   * which is where somebody staring at a stalled log will be looking.
   */
  pending: [] as { id: string; what: string }[],
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
  /*
   * `at` says which end of it the reader asked for. Opening from the badge on
   * an agent's mark means "show me what it said", and what it said is at the
   * bottom of a conversation that may be long — the top of the box would be
   * the reader's own question, which they already know.
   */
  thread: null as { id: string; anchor: DOMRect | null; at?: "agent" } | null,
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

      /*
       * What this frame is a reading of, kept where a reload can find it.
       *
       * The host has no way to tell one restored frame from another — the
       * editor hands back empty panels and nothing else — so the frame carries
       * the answer itself. This is the only thing on this side that outlives
       * the window, and it is not drawn anywhere: the page is told, writes it
       * down, and the host reads it back after a reload to know which change
       * to rebuild into which tab.
       */
      case "reading":
        keep({ reading: message.payload });
        return;

      /*
       * Which agents this machine can run.
       *
       * Assigned onto the model rather than kept beside it, so a rebuild does
       * not lose it — the same reason the forge's verdicts are carried across
       * one. An empty array is an answer: it says the host looked and found
       * none, which the panel draws differently from not having asked.
       */
      case "agents":
        model.current.agents = Array.isArray(message.payload)
          ? message.payload
          : [];
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
        if (next.merging === undefined && model.current.merging !== undefined) {
          next.merging = model.current.merging;
        }
        // What is installed on this machine does not change because a file was
        // saved, and looking again on every keystroke would be a `which` per
        // known tool per rebuild.
        if (next.agents === undefined && model.current.agents !== undefined) {
          next.agents = model.current.agents;
        }
        /*
         * Where the reader is, before the drawing they are reading is replaced.
         *
         * The camera survives this — the document is not — but the coordinates
         * it holds only mean anything against one arrangement. A rebuild that
         * adds a file, or that makes one card taller, moves every card below
         * and to the right of it, so the same numbers now frame a different
         * part of the picture. Which is what an agent finishing its work looked
         * like: the view left where it was and the change moved out from under
         * it.
         */
        rebuilding.before?.();
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

        /*
         * The same hold as a whole new model, for the same reason.
         *
         * This message is the small one — a card's rows, and nothing else — but
         * rows are what a card's height is made of, and a card that grows by
         * twelve lines pushes every card under it down by twelve lines' worth.
         * The reader's numbers do not move and the drawing does.
         */
        if (patches.length > 0) rebuilding.before?.();

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

      /*
       * What has become of the pull request, without rebuilding anything.
       *
       * A review outlives the window it was opened in: come back the next day
       * and somebody else may have merged it. Nothing about the diff has moved
       * — what has changed is whether reviewing it still means anything, and
       * that is a line in the bar rather than a reason to redraw the change.
       */
      case "pullRequest":
        if (message.payload) {
          model.current.meta = {
            ...model.current.meta,
            pullRequest: message.payload as never,
          };
        }
        return;

      case "merging":
        model.current.merging = message.payload;
        return;

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
        // Which agents are mid-turn, sent alongside because it changes at the
        // same moments and for the same reasons: a turn starting and a turn
        // finishing are both a comment appearing.
        if (Array.isArray(message.busy)) {
          ui.busyAgents = new Set(message.busy as string[]);
        }
        if (message.owners && typeof message.owners === "object") {
          ui.owners = message.owners as Record<string, string>;
        }
        if (Array.isArray(message.carrying)) {
          ui.carrying = new Set(message.carrying as string[]);
        }
        if (message.labels && typeof message.labels === "object") {
          ui.labels = message.labels as Record<string, string>;
        }
        if (message.rungs && typeof message.rungs === "object") {
          ui.rungs = message.rungs as Record<string, string[]>;
        }
        if (message.sessions && typeof message.sessions === "object") {
          ui.sessions = message.sessions as Record<string, string>;
        }
        if (Array.isArray(message.pending)) {
          ui.pending = message.pending as { id: string; what: string }[];
        }
        return;

      /*
       * A line an agent printed.
       *
       * Its own channel rather than part of the model, because these arrive
       * continuously for minutes and the model is what the whole page is drawn
       * from — folding them in would be a redraw of every card per line of
       * output. Kept here so the terminal has a session to show when it is
       * opened rather than only what has been printed since.
       */
      /*
       * Everything one agent has printed, in answer to being asked.
       *
       * Replaces rather than appends: this is the session, and a terminal that
       * appended it to whatever had already streamed in would show the first
       * half of the turn twice.
       */
      case "agentTranscript": {
        const who = message.payload?.agent;
        if (typeof who !== "string") return;
        ui.transcripts[who] = String(message.payload.text ?? "");
        return;
      }

      case "agentOutput": {
        const who = message.payload?.agent;
        if (typeof who !== "string") return;
        ui.transcripts[who] = (ui.transcripts[who] ?? "") + String(message.payload.chunk ?? "");
        return;
      }

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
