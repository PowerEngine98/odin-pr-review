import {
  addressedTo,
  assign,
  describeRequest,
  doingOf,
  permitted,
  avatarFor,
  ownerOf,
  discoverAgents,
  forgeEnv,
  git,
  keepsOpen,
  lineOf,
  linesOf,
  probeOf,
  passageAt,
  promptFor,
  spanText,
  standingOf,
  runAgent,
  withoutMarker,
  within,
  type Agency,
  type AgentKind,
  type AgentState,
  type Ask,
  type Change,
  type Delta,
  type Standing,
  type ReviewComment,
  type RunHandle,
} from "@odin/core";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";

/**
 * Pairing with the agents on this machine, for one reading.
 *
 * Everything here is local. A message the reader writes to an agent, and
 * everything an agent writes back, lives in this session and in the editor's
 * own storage — the forge is never told, because the conversation is working
 * out what to do rather than a review of what was done. Publishing one is a
 * separate act with its own button, and it is not this.
 *
 * One of these per reading rather than one per window: a reviewer with two
 * changes open is having two conversations, and an agent that answered in the
 * wrong one would be answering about code it was never shown.
 */

/** A remark that exists only here, until somebody says otherwise. */
export interface LocalComment extends ReviewComment {
  /** Always true. What tells this from something the forge knows about. */
  local: true;
  /** The agent that wrote it, when an agent did. */
  agent?: string;
  /** How the work this message asked for is going, for the badge. */
  task?: "queued" | "working" | "done" | "failed" | "asking" | "stopped";
  /**
   * A decision this remark is waiting on, when it is one.
   *
   * The request is a message in the thread rather than a dialogue over the
   * editor, so that what was asked, what was decided and what happened next are
   * one record somebody can read afterwards. A modal would settle the same
   * question and leave nothing behind.
   */
  approval?: {
    id: string;
    /** What the agent wants to do, as a sentence rather than a tool name. */
    what: string;
    state: "waiting" | "allowed" | "denied";
  };
  /**
   * The code this remark was written against, so it can be found again.
   *
   * Only in a live reading, where the file underneath a remark changes while
   * the remark is still open — an agent takes an earlier message, inserts nine
   * lines, and every line number below the insertion is now pointing at
   * something else. A number is a position; this is an identity, and it is what
   * lets the position be worked out afresh whenever it is needed.
   *
   * Absent for a reading of committed code, where nothing moves under a remark
   * and the number is the whole truth, and for a remark on the base side, whose
   * lines are not in the working tree to be found.
   */
  anchor?: {
    /** The lines themselves, exactly as they read when the remark was written. */
    text: string;
    /** Where they were then, which is what decides between repeated passages. */
    line: number;
    startLine?: number;
  };
  /**
   * The code this remark was written against is no longer in the file.
   *
   * Not an error and not a reason to hide it: somebody rewrote the passage, or
   * deleted it, and that is often the most interesting thing that has happened
   * to the remark. It keeps the line it had, because there is nowhere honest to
   * move it to, and this says that the line is now a historical fact rather
   * than a place.
   */
  adrift?: boolean;
}

/**
 * Where local comments live.
 *
 * The editor's workspace storage, keyed by the reading. A conversation with an
 * agent is worth as much as the notes a reviewer takes while reading, and
 * losing it to a window reload would make the whole thing untrustworthy to use
 * for anything that mattered.
 */
const KEY = "odin.pairing";

interface Stored {
  comments: LocalComment[];
  /** Where the next local id comes from. Negative, and always descending. */
  next: number;
  /**
   * The conversation each agent is having about this reading, by agent id.
   *
   * The whole of session recovery. A reload throws away this window and every
   * process in it, but the tools keep their own conversations on disk — so what
   * has to survive is not the conversation but its name. Come back tomorrow,
   * reopen the tab, and the next thing said to Claude carries on from what it
   * already knows about this change rather than starting from nothing.
   *
   * Per reading, so two changes open at once are two conversations. An agent
   * that remembered one change while being asked about another would be worse
   * than one that remembered nothing.
   */
  sessions?: Record<string, string>;
  /**
   * What the reader calls each conversation, when they have named one.
   *
   * Odin's name for it rather than the tool's. A tool that lets a session be
   * named takes that name when the session is created and has no way to change
   * it afterwards, so a rename that had to reach the tool would be a rename
   * that only worked once. This is a label on our side, which can be changed
   * as often as the reader likes and means the same thing either way: which of
   * several conversations this one is.
   */
  labels?: Record<string, string>;
  /**
   * What each agent printed, as far as it is worth keeping.
   *
   * Held only in memory to begin with, which meant a window reload emptied
   * every terminal: the conversation carried on — the session ids survive — but
   * the record of how it got there did not, and the box that exists to show
   * that record said "Nothing yet".
   *
   * A shorter tail than the running one. This is scrollback for a turn that is
   * already over, and the far end of it is the cheapest thing here to lose.
   */
  logs?: Record<string, string>;
  /**
   * Which conversations have been settled, by the id of the message that began
   * them.
   *
   * Kept beside the comments rather than on them because a thread's root may be
   * a comment on the forge, which this store does not own and cannot write to.
   * The forge has its own answer for those and it is the one that counts; this
   * is what is known here, which for a conversation that exists only on this
   * machine is all there is.
   */
  settled?: Record<string, boolean>;
  /**
   * Every edit the agents made in this reading, oldest first.
   *
   * Kept with the reading rather than with the tool. Each of these tools has a
   * conversation on disk somewhere and none of them keep a record of what they
   * changed that anything else can read; and the question the ledger answers —
   * what happened to this branch while I was reviewing it — is a question about
   * the reading, which is the thing this store already is.
   */
  deltas?: Delta[];
}

/**
 * Local ids are negative, and that is the whole of the collision story.
 *
 * A comment on the forge has a large positive id, and everything downstream —
 * the thread grouping, the reply pointer, the badge — is written against those.
 * Giving local comments ids from the same space would mean a scheme for telling
 * them apart that every one of those places had to know about. Negative numbers
 * are already impossible from the forge, so nothing needs to be taught anything.
 */
const FIRST_LOCAL = -1;

/** How many edits the ledger keeps before the far end starts falling off. */
const KEEP_DELTAS = 400;

/**
 * What a remark is signed with before the forge has said who is reading.
 *
 * Written down rather than spelled out at each end, because two spellings of
 * it would mean remarks that are never signed properly and nothing saying why.
 */
export const PLACEHOLDER = "you";

/**
 * How long the list of installed tools is worth trusting.
 *
 * Long, because the thing being remembered is what somebody has installed on
 * their machine, and that changes on the order of never. The cost of being
 * wrong is a panel one tool out of date until the reader presses refresh; the
 * cost of not remembering is a probe of the whole list on every rebuild.
 */
const REMEMBER_FOR = 10 * 60 * 1000;

/** The last answer, shared by every reading in this window. */
let known: { at: number; agents: AgentKind[] } | undefined;

/** An answer already being waited on, so three tabs ask once between them. */
let looking: Promise<AgentKind[]> | undefined;

export class PairingSession {
  private comments: LocalComment[] = [];
  private next = FIRST_LOCAL;

  /** What each agent is doing, which is what the queue is decided from. */
  private readonly state = new Map<string, AgentState>();

  /** Turns in flight, so they can be stopped when the reading closes. */
  private readonly running = new Map<string, RunHandle>();

  /** Everything each agent has printed this session, for its terminal. */
  private readonly transcripts = new Map<string, string>();

  /** Messages nobody has taken yet. */
  private waiting: Ask[] = [];

  /**
   * The conversation each agent is having about this reading.
   *
   * An id we chose, minted the first time an agent is asked anything here and
   * kept for as long as the reading exists. Only for tools that can be told
   * which conversation to continue; the rest have no entry and start fresh
   * every turn, which is what they do anyway.
   */
  private sessions: Record<string, string> = {};

  /** What the reader calls each conversation, where they have named one. */
  private labels: Record<string, string> = {};
  /** Which conversations have been settled, by the id that began them. */
  private settled: Record<string, boolean> = {};

  /** Every edit the agents have made here, oldest first. */
  private deltas: Delta[] = [];

  /** The agents installed here, once anybody has looked. */
  private installed: AgentKind[] = [];

  /** Which are switched on, in the reader's order. Set by the page. */
  private order: string[] = [];

  constructor(
    private readonly memento: vscode.Memento,
    private readonly key: string,
    private readonly repo: string,
    /** Called whenever anything the page draws has changed. */
    private readonly changed: () => void,
    /**
     * Whether this reading is of the files on disk.
     *
     * Which decides whether a remark can be anchored to the code it is about.
     * In a live reading the working tree *is* what is being reviewed, so the
     * lines a reader picked are lines of a file an agent will open, and both
     * move together. In a reading of committed code the working tree is
     * somebody else's branch or an older state of this one, and looking a
     * remark's passage up in it would anchor the remark to whatever that file
     * happens to contain — which is worse than not anchoring at all.
     */
    private readonly live = false,
  ) {
    this.load();
  }

  /* ------------------------------------------------------------- the store */

  private load(): void {
    let held: Stored | undefined;
    try {
      /*
       * Only what is filed under this reading's own name.
       *
       * Conversations written before a conversation had a name of its own are
       * left where they are, deliberately. They were filed under the tab's
       * name, which for a live reading carries no branch — so there is nothing
       * in them that says which branch they were about, and handing them to
       * whichever branch happens to be checked out is a guess that puts one
       * change's review conversation onto another. That is the fault being
       * fixed here, and a migration is not a licence to commit it once more.
       *
       * Nothing is deleted. `Odin: Forget This Reading's Conversation` is there
       * for a reading that has ended up holding somebody else's.
       */
      held = this.memento.get<Record<string, Stored>>(KEY, {})[this.key];
    } catch {
      held = undefined;
    }
    this.comments = Array.isArray(held?.comments) ? held.comments : [];
    this.next = typeof held?.next === "number" ? held.next : FIRST_LOCAL;
    this.sessions =
      held?.sessions && typeof held.sessions === "object" ? { ...held.sessions } : {};
    this.labels =
      held?.labels && typeof held.labels === "object" ? { ...held.labels } : {};
    this.settled =
      held?.settled && typeof held.settled === "object" ? { ...held.settled } : {};
    this.deltas = Array.isArray(held?.deltas) ? held.deltas : [];
    /*
     * A turn that was running when the window went away.
     *
     * The remarks survive a reload and the processes do not — so a message left
     * mid-turn came back still saying it was being worked on, for ever, with
     * nothing running and nothing about to. The reader sees an agent apparently
     * busy and a terminal with nothing in it, which is the least explicable
     * state this thing can be in.
     *
     * Said plainly instead. The conversation is still there and the agent still
     * remembers it — answering in the thread carries on from where it stopped.
     */
    this.comments = this.comments.map((comment) =>
      comment.task === "working" || comment.task === "queued" || comment.task === "asking"
        ? { ...comment, task: "stopped" as const }
        : comment,
    );
    // Any decision that was outstanding died with the window that would have
    // answered it, and a button that answers nothing is worse than no button.
    this.comments = this.comments.map((comment) =>
      comment.approval?.state === "waiting"
        ? { ...comment, approval: { ...comment.approval, state: "denied" as const } }
        : comment,
    );

    if (held?.logs && typeof held.logs === "object") {
      for (const [agent, text] of Object.entries(held.logs)) {
        if (typeof text === "string") this.transcripts.set(agent, withoutInvocations(text));
      }
    }
  }

  private save(): void {
    try {
      const all = { ...this.memento.get<Record<string, Stored>>(KEY, {}) };
      all[this.key] = {
        comments: this.comments,
        next: this.next,
        sessions: this.sessions,
        labels: this.labels,
        settled: this.settled,
        deltas: this.deltas,
        logs: Object.fromEntries(
          [...this.transcripts].map(([agent, text]) => [agent, keepable(text)]),
        ),
      };
      void this.memento.update(KEY, all);
    } catch {
      /* a conversation that will not persist is not worth an error mid-turn */
    }
  }

  /** Everything written here, for the page to draw beside the forge's own. */
  local(): LocalComment[] {
    // The state is carried by the message that began the conversation, which is
    // where every reader of it — the list, the panel, the mark — already looks
    // for what the conversation is.
    /*
     * Each file read once for the whole list, rather than once per remark.
     *
     * A thread on a busy file is a dozen remarks, and this runs on every change
     * anything makes to the conversation.
     */
    const read = new Map<string, string | undefined>();
    const held = (path: string): string | undefined => {
      if (!read.has(path)) read.set(path, this.fileAt(path));
      return read.get(path);
    };

    return this.comments.map((comment) => {
      const settled = this.settled[String(comment.id)];
      const shown =
        settled === undefined ? comment : { ...comment, resolved: settled };

      /*
       * And where its code has got to, if it has moved.
       *
       * So the mark in the margin, the conversation panel and the composer all
       * follow the passage rather than staying on a number that now points at
       * something else. A remark whose passage has gone keeps its old number
       * and is marked as adrift: there is nowhere honest to move it to, and
       * quietly leaving it where it was — with nothing saying so — is what this
       * exists to stop.
       */
      if (!this.live || !comment.anchor) return shown;
      const file = held(comment.path);
      if (file === undefined) return shown;

      const now = standingOf(file, comment.anchor.text, {
        line: comment.anchor.line,
        ...(comment.anchor.startLine !== undefined
          ? { startLine: comment.anchor.startLine }
          : {}),
      });
      if (now.state === "here") return shown;
      if (now.state === "gone") return { ...shown, adrift: true };

      // Rebuilt rather than spread over, so a remark that has shrunk to one
      // line does not keep the `startLine` of the span it used to be.
      const { startLine: _was, ...rest } = shown;
      return {
        ...rest,
        line: now.span.line,
        ...(now.span.startLine !== undefined ? { startLine: now.span.startLine } : {}),
      };
    });
  }

  /** What is known here about each conversation, by the id that began it. */
  settledThreads(): Record<string, boolean> {
    return { ...this.settled };
  }

  /**
   * Settling a conversation, or opening it again.
   *
   * Recorded here whatever the thread is, and told to whoever is listening so
   * that a thread rooted on the forge can be settled there too. Both, rather
   * than one or the other: the forge is the answer that outlives this window,
   * and this is the answer the page can draw before a round trip has finished.
   */
  settle(rootId: number, resolved: boolean): void {
    const key = String(rootId);
    if (this.settled[key] === resolved) return;
    this.settled[key] = resolved;
    this.save();
    this.onSettle?.(rootId, resolved);
    this.changed();
  }

  /**
   * The same, without telling anybody.
   *
   * For putting back a state the forge refused. Announcing that would send the
   * refusal straight back to the forge as a fresh instruction, which is a loop
   * rather than an undo.
   */
  unsettle(rootId: number, resolved: boolean): void {
    this.settled[String(rootId)] = resolved;
    this.save();
    this.changed();
  }

  /** Told when a conversation is settled or opened, so the forge can hear of it. */
  onSettle: ((rootId: number, resolved: boolean) => void) | undefined;

  /** What this machine can run, as the panel and the queue both need it. */
  agents(): AgentKind[] {
    return this.installed;
  }

  /** Whatever the named agent has printed this session. */
  transcript(id: string): string {
    return this.transcripts.get(id) ?? "";
  }

  /* ----------------------------------------------------------- the anchors */

  /**
   * The passage a remark is about, read out of the file it is in.
   *
   * Nothing at all outside a live reading, for a remark about the change as a
   * whole, or for one on the base side — the base is what the file used to say,
   * it is not in the working tree, and it cannot move.
   */
  private anchorFor(
    comment: LocalComment,
  ): { text: string; line: number; startLine?: number } | undefined {
    if (!this.live) return undefined;
    if (!comment.path || !comment.line || comment.side === "LEFT") return undefined;

    const held = this.fileAt(comment.path);
    if (held === undefined) return undefined;

    const span = {
      line: comment.line,
      ...(comment.startLine !== undefined ? { startLine: comment.startLine } : {}),
    };
    const text = passageAt(held, span);
    if (text === undefined) return undefined;
    return { text, ...span };
  }

  /**
   * Where a remark's code is now, when the remark has any to look for.
   *
   * The one question everything else here asks. Answered against the file each
   * time rather than written down, because the answer is a fact about the file
   * — it changes when an agent saves, and nothing tells this store that it has.
   */
  private standing(comment: LocalComment): Standing | undefined {
    if (!this.live || !comment.anchor) return undefined;
    const held = this.fileAt(comment.path);
    if (held === undefined) return undefined;
    return standingOf(held, comment.anchor.text, {
      line: comment.anchor.line,
      ...(comment.anchor.startLine !== undefined
        ? { startLine: comment.anchor.startLine }
        : {}),
    });
  }

  /**
   * Whether a message is still about code that exists, and what to do if not.
   *
   * Asked at the moment a turn would start rather than when the message was
   * written, because that is when it matters and when it can be true: a message
   * can wait minutes in the queue behind another agent that is editing the very
   * file it is about.
   *
   * The reader decides. There are only bad defaults here — sending it anyway
   * points an agent at a line naming code nobody has seen, and dropping it
   * loses a question somebody wrote — and neither is a decision this store is
   * entitled to make quietly on their behalf.
   */
  private async stillStands(ask: Ask): Promise<boolean> {
    const root = this.rootOf(Number(ask.id));
    if (!root) return true;
    const now = this.standing(root);
    if (now?.state !== "gone") return true;

    const anyway = "Ask anyway";
    const look = "Show me";
    const answer = await vscode.window.showWarningMessage(
      `Odin: the lines this message was written about are no longer in ${root.path}.`,
      {
        modal: true,
        detail:
          `It was written against ${root.path}:${spanText(now.from)}, which read:\n\n` +
          `${quoted(root.anchor?.text ?? "")}\n\n` +
          "Something has rewritten or removed that passage since. Sending the " +
          "message on would point an agent at a line number that now names " +
          "different code.",
      },
      anyway,
      look,
    );

    if (answer === anyway) {
      /*
       * Sent, and sent honestly. The prompt says the passage has gone and
       * quotes it, so the agent is looking for the code the reader meant rather
       * than trusting a line number that no longer names it.
       */
      this.adrift(root.id);
      return true;
    }

    if (answer === look) {
      // Where it was, which is the only place there is to look. The message is
      // still in the thread and can be asked again from there.
      void vscode.window.showTextDocument(
        vscode.Uri.file(join(this.repo, root.path)),
        { selection: new vscode.Range(spot(now.from), spot(now.from)) },
      );
    }

    /*
     * Dismissed, or the reader went to look. Either way the message stays in
     * the conversation — it is a question they wrote, and throwing it away
     * would be a second decision they did not make.
     */
    this.note(
      root.id,
      "Not sent: the lines this was written about are no longer in the file. " +
        "Ask again when you have decided what it should say now.",
    );
    return false;
  }

  /** Marks a remark as no longer standing on the code it was written about. */
  private adrift(id: number): void {
    this.comments = this.comments.map((comment) =>
      comment.id === id ? { ...comment, adrift: true } : comment,
    );
    this.save();
  }

  /** A file of this checkout, or nothing when it cannot be read. */
  private fileAt(path: string): string | undefined {
    return this.contentOf(path);
  }

  /* ------------------------------------------------------------ the ledger */

  /**
   * An edit a tool announced, kept as evidence of who did what.
   *
   * Not an entry. The ledger is built from what the watcher saw, because the
   * watcher sees every change to this checkout whoever made it — a tool that
   * narrates, a tool that does not, and the reader's own hands are all the same
   * to it, and a record of what happened to this branch that only knows about
   * one of the three is not a record of what happened to this branch.
   *
   * What a narrated turn adds is the one thing the watcher cannot know: whose
   * change it was. So an announced edit is remembered as a claim on a file for
   * a short while, and the entry the watcher produces a moment later picks it
   * up.
   */
  private record(agent: string, change: Change): void {
    this.claims.set(this.inRepo(change.path), { agent, at: Date.now() });
  }

  /**
   * How long a tool's announcement stands as a claim on a file.
   *
   * Long enough to cover the settling delay and the write landing after the
   * announcement; short enough that an edit somebody makes by hand two minutes
   * later is not filed under the agent that last touched that file.
   */
  private static readonly CLAIM_HOLDS = 30_000;

  /** Which agent last said it was writing which file, and when. */
  private readonly claims = new Map<string, { agent: string; at: number }>();

  /**
   * Files the watcher saw change, turned into entries.
   *
   * The before is whatever this last knew the file to say, and the first time a
   * file is seen that is what it says at HEAD — so an entry made in the first
   * minute of a reading is "what has happened to this file since the last
   * commit", which is what a reviewer means by the question. Every entry after
   * that is the step from one state to the next.
   */
  async observed(paths: readonly string[]): Promise<void> {
    let added = false;
    for (const path of paths) {
      const after = this.contentOf(path) ?? "";
      const before = this.snapshots.has(path)
        ? this.snapshots.get(path)!
        : await this.committed(path);

      this.snapshots.set(path, after);
      // A file the editor announced and nothing in it moved — a touch, a
      // formatter that decided against it, a save with no edit.
      if (before === after) continue;

      const claim = this.claims.get(path);
      const mine =
        claim && Date.now() - claim.at < PairingSession.CLAIM_HOLDS
          ? claim.agent
          : undefined;

      /*
       * The passage that changed, not the two files it changed between.
       *
       * Kept as whole files at first, which was wrong three ways at once. The
       * entry held two copies of a source file, four hundred of those live in
       * the editor's workspace storage beside every comment in the reading, and
       * — the one that showed — "is this entry still true" became "is this file
       * byte for byte what it was", which stops being true on the very next
       * save. Every row in a working session was marked outdated, correctly and
       * uselessly.
       *
       * Diffed here and stored as the two sides of the change with a little
       * context, so `after` is a passage again: something that can be looked
       * for in the file, that means one place rather than a whole document, and
       * that stays true while the rest of the file moves around it.
       */
      const drawn = linesOf(before, after);
      const wasThere = drawn
        .filter((row) => row.kind !== "add")
        .map((row) => row.text)
        .join("\n");
      const isThere = drawn
        .filter((row) => row.kind !== "del")
        .map((row) => row.text)
        .join("\n");

      const delta: Delta = {
        id: `${this.deltas.length}:${Date.now()}:${path}`,
        ...(mine ? { agent: mine } : {}),
        at: Date.now(),
        path,
        before: within(wasThere),
        after: within(isThere),
        whole: before === "" || after === "",
        ...(mine && this.working !== undefined ? { ask: this.working } : {}),
      };
      // One unbroken run of the new text, which is what "is this still true"
      // and "where do I fly to" are both answered from. `after` may be several
      // passages with a marker between them, and that matches no file anywhere.
      const probe = probeOf(drawn);
      if (probe) delta.probe = probe;
      const line = probe ? this.lineIn(path, probe) : undefined;
      if (line !== undefined) delta.line = line;

      this.deltas.push(delta);
      added = true;
    }
    if (!added) return;

    /*
     * Bounded, oldest first.
     *
     * An afternoon of work on a busy branch is hundreds of these, and all of
     * them are held in the editor's own storage next to every comment in the
     * reading. The far end is the cheapest to lose for the same reason as the
     * transcript: nobody scrolls to the bottom of a ledger to find out what is
     * happening now.
     */
    if (this.deltas.length > KEEP_DELTAS) {
      this.deltas = this.deltas.slice(-KEEP_DELTAS);
    }
    this.save();
    this.wrote?.(this.ledger());
  }

  /** What this last knew each watched file to say. */
  private readonly snapshots = new Map<string, string>();

  /**
   * The file as the last commit has it, which is where a reading starts from.
   *
   * Empty for a file that is not in the commit at all, which is the honest
   * answer for one that has just been created: there was nothing there before.
   */
  private async committed(path: string): Promise<string> {
    return await git(["show", `HEAD:${path}`], { cwd: this.repo }).catch(() => "");
  }

  /**
   * The ledger, with each entry checked against the file as it stands.
   *
   * Stamped here rather than stored, because whether an entry is still true is
   * a fact about the working tree and not about the entry. A reader who comes
   * back tomorrow, or who has had an agent rewrite the same passage twice,
   * wants to know which of these rows still describe the file in front of them
   * — and the row itself cannot know.
   */
  ledger(): Delta[] {
    const read = new Map<string, string | null>();
    const content = (path: string): string | null => {
      if (!read.has(path)) {
        // Gone, or never in this checkout. Either way there is nothing left for
        // the entry to match, which is exactly what outdated means.
        read.set(path, this.contentOf(path) ?? null);
      }
      return read.get(path) ?? null;
    };

    return this.deltas.map((delta) => {
      const held = content(delta.path);
      if (held === null) return { ...delta, stale: true };
      // The probe rather than the drawing, for the reasons on `probe` itself.
      const at = delta.probe ? lineOf(held, delta.probe) : undefined;
      return {
        ...delta,
        stale: at === undefined,
        // Followed, so an entry whose passage has since been pushed down the
        // file still flies to it. The line is where the code is now, which is
        // the only line a reader can be taken to.
        ...(at === undefined ? {} : { line: at }),
      };
    });
  }

  /** Told when an edit lands, so the page's ledger can follow the turn. */
  wrote: ((deltas: Delta[]) => void) | undefined;

  /**
   * Where a tool's path sits inside this checkout, as a card would name it.
   *
   * Both spellings of the checkout, because on macOS a tool and this process
   * routinely disagree about which one they are in: `/tmp` and `/var` are
   * symlinks into `/private`, and a tool that resolves its own working
   * directory reports `/private/var/…` for the very path this was handed as
   * `/var/…`. Measured rather than reasoned about — a real turn against a real
   * tool produced an entry whose path was the whole of `/private/var/folders/…`
   * because the prefix did not match by one word.
   *
   * A path that still does not sit under this checkout is left as it is. An
   * agent may genuinely write outside the repository, and an entry naming
   * where that happened is worth more than one pretending it was in here.
   */
  private inRepo(path: string): string {
    for (const root of roots(this.repo)) {
      if (path.startsWith(root)) return path.slice(root.length);
    }
    return path;
  }

  /**
   * A file of this reading, whether it is named from the root or absolutely.
   *
   * `join` does not treat an absolute second part as absolute — it glues them,
   * so a path this could not make relative became `<repo>/private/var/…`, which
   * exists nowhere. Every entry built that way read as outdated, with no line
   * to go to, and the two failures looked exactly like an honest answer.
   */
  private contentOf(path: string): string | undefined {
    try {
      return readFileSync(isAbsolute(path) ? path : join(this.repo, path), "utf8");
    } catch {
      return undefined;
    }
  }

  /** Which line a passage starts on, or nothing when it is not there. */
  private lineIn(path: string, passage: string): number | undefined {
    const held = this.contentOf(path);
    return held === undefined ? undefined : lineOf(held, passage);
  }

  /**
   * The server description Claude needs, written where it can be pointed at.
   *
   * A file rather than an argument because that is the shape the flag takes,
   * and one per reading rather than one per turn: the socket outlives the turn,
   * so the description of it does too.
   */
  private configPath = "";

  private configFor(_kind: AgentKind): string {
    const door = this.opened();
    if (this.configPath) return this.configPath;
    this.configPath = join(mkdtempSync(join(tmpdir(), "odin-mcp-")), "mcp.json");
    writeFileSync(
      this.configPath,
      JSON.stringify({
        mcpServers: {
          odin: {
            command: process.execPath,
            args: [PairingSession.stub, door],
          },
        },
      }),
    );
    return this.configPath;
  }

  /** Which agents are working, for the badges and for the panel. */
  busy(): string[] {
    return [...this.state.entries()]
      .filter(([, what]) => what === "working")
      .map(([id]) => id);
  }

  /* --------------------------------------------------------- what is there */

  /**
   * What is installed, asked of the machine at most occasionally.
   *
   * The answer is cached across every reading in the window, and the reason is
   * not politeness. A page is rebuilt whenever the working tree changes — which
   * in a live reading is every time the reader saves a file — and each rebuilt
   * page asks this again. Uncached, that was six `which` calls and three Node
   * interpreters booting on every keystroke that reached disk, for an answer
   * that changes when somebody installs a tool.
   *
   * `again` is the refresh button, which is the one moment the reader is
   * telling us the answer has changed.
   */
  async look(again = false): Promise<AgentKind[]> {
    const now = Date.now();
    if (!again && known && now - known.at < REMEMBER_FOR) {
      this.installed = known.agents;
      return this.installed;
    }

    // Shared, so three tabs opening at once ask once between them rather than
    // three times over.
    if (!again && looking) {
      this.installed = await looking;
      return this.installed;
    }

    const asking = discoverAgents({ cwd: this.repo, env: forgeEnv() })
      .then((found) => {
        known = { at: Date.now(), agents: found };
        return found;
      })
      .catch(() => [] as AgentKind[])
      .finally(() => {
        if (looking === asking) looking = undefined;
      });
    looking = asking;

    this.installed = await asking;
    return this.installed;
  }

  /**
   * Which agents the reader switched on, and in what order.
   *
   * Kept rather than read from the settings store, because the order is the
   * priority rule and the page is where it is decided. An id naming something
   * not installed is dropped here rather than at every use.
   */
  setOrder(order: string[]): void {
    const have = new Set(this.installed.map((agent) => agent.id));
    this.order = order.filter((id) => have.has(id));
    // A message may have been waiting on an agent that has only now been
    // switched on.
    this.pump();
  }

  /* ------------------------------------------------------------- the queue */

  /**
   * A message from the reader, which becomes a local comment and a task.
   *
   * The comment appears immediately and the work starts when somebody is free.
   * Those are deliberately two things: a reviewer who writes three messages in
   * a row should see three messages, not watch two of them vanish until an
   * agent gets to them.
   */
  ask(where: {
    /**
     * The file this is about, or nothing.
     *
     * Empty for a question about the change rather than about a line — what
     * shape this ought to be, where a thing belongs, whether two files should
     * be one. Those have no line to hang off and are worth asking anyway, so
     * they are recorded as remarks about the change itself: no path, no line,
     * no mark in any margin, and everything else about them the same.
     */
    path?: string;
    line?: number;
    startLine?: number;
    side?: "LEFT" | "RIGHT";
    body: string;
    inReplyTo?: number;
    author: string;
    avatarUrl?: string;
    /**
     * The agent this was written to, when the writing itself says so.
     *
     * A message typed into an agent's own terminal is addressed to that agent,
     * the same way naming it in the text is — and naming it in the text still
     * wins, because that is the reader saying it in as many words.
     */
    to?: string;
  }): LocalComment {
    const id = this.next--;
    const at = new Date().toISOString();

    const line = where.line ?? 0;
    const comment: LocalComment = {
      id,
      path: where.path ?? "",
      line,
      ...(where.startLine !== undefined && where.startLine < line
        ? { startLine: where.startLine }
        : {}),
      side: where.side ?? "RIGHT",
      body: where.body,
      author: where.author,
      ...(where.avatarUrl ? { avatarUrl: where.avatarUrl } : {}),
      createdAt: at,
      url: "",
      outdated: false,
      ...(where.inReplyTo !== undefined ? { inReplyTo: where.inReplyTo } : {}),
      local: true,
      task: "queued",
    };

    /*
     * What it is about, alongside where it is.
     *
     * Captured now, while the numbers the reader picked are certainly right —
     * they picked them against a drawing built from this file. A minute later
     * an agent may have moved the whole passage, and then there is no way back
     * to what they meant from a number alone.
     */
    const anchored = this.anchorFor(comment);
    if (anchored) comment.anchor = anchored;

    this.comments = [...this.comments, comment];
    this.save();

    /*
     * Asking again opens the conversation again.
     *
     * A settled thread the reader has just written into is not settled — that
     * is what writing into it means — and leaving it closed would file the new
     * question under the answers already given, where nobody is looking.
     */
    if (where.inReplyTo !== undefined) {
      const root = this.rootOf(where.inReplyTo);
      if (root) this.settle(root.id, false);
    }

    const named = addressedTo(
      where.body,
      this.installed.map((agent) => ({ id: agent.id, name: agent.name })),
    );
    this.waiting.push({
      id: String(id),
      body: where.body,
      at,
      ...(named ?? where.to ? { addressee: named ?? where.to! } : {}),
      // Whoever answered here first. Worked out now rather than when the
      // message is taken: an agent may answer in another thread in between,
      // and the claim on this one is about this one.
      ...(this.ownerOfThread(id) ? { owner: this.ownerOfThread(id)! } : {}),
    });

    this.changed();
    this.pump();
    return comment;
  }

  /**
   * Hands out whatever is waiting to whoever is free.
   *
   * Called after every change that could free an agent or add work. The
   * decision itself is not here — it is a pure function with its own tests, and
   * this is the part that spawns processes.
   */
  private pump(): void {
    if (this.order.length === 0) return;

    const taken = assign(this.waiting, this.order, this.state);
    if (taken.length === 0) return;

    const claimed = new Set(taken.map((one) => one.ask.id));
    this.waiting = this.waiting.filter((ask) => !claimed.has(ask.id));

    for (const { ask, agent } of taken) void this.work(ask, agent);
  }

  /** One agent, one message, from the prompt to the reply it writes. */
  private async work(ask: Ask, agentId: string): Promise<void> {
    const kind = this.installed.find((one) => one.id === agentId);
    if (!kind) return;

    /*
     * Claimed before anything is awaited, and that ordering is load-bearing.
     *
     * This agent is spoken for from the moment its message is taken — not from
     * the moment the process starts. The two used to be the same instant; then
     * a decision the reader might have to make was put in between, and for as
     * long as that decision is open the agent looked idle to everything that
     * asks: the queue would hand it a second message, and the page would draw
     * it as free while a dialogue about its first one was on screen.
     */
    this.state.set(agentId, "working");

    /*
     * The code this message is about may have gone while it was queued.
     *
     * Which is a decision, not a detail. Sending it anyway hands an agent a
     * line number naming code the reader never saw, and the reader finds out
     * when something they did not ask for has been edited. Dropping it
     * silently loses a question they took the trouble to write. Neither is
     * ours to make on their behalf, so they are asked — and the turn does not
     * start until they answer.
     */
    if (!(await this.stillStands(ask))) {
      this.waiting = this.waiting.filter((one) => one.id !== ask.id);
      this.state.set(agentId, "idle");
      this.mark(Number(ask.id), "stopped");
      this.changed();
      this.pump();
      return;
    }
    /*
     * Who is on this conversation, from the moment it is taken.
     *
     * A claim used to be read off the thread — whoever spoke in it first — and
     * an agent that has been asked but has not answered yet has said nothing.
     * So for the whole of its first turn, which is the minutes somebody spends
     * watching to see what it is doing, the conversation had no owner: no face
     * beside the mark, no name in the thread, nothing on screen tying the work
     * to the tool doing it. Taking a message is the claim; speaking is the
     * evidence of one.
     *
     * Recorded *before* the message is marked as being worked on, because
     * marking it is what tells the page — and a claim written a line later
     * missed that message and waited for the next one, which is the agent's
     * first word. Which is precisely the wait this exists to remove: the mark
     * went yellow with nobody's face on it.
     */
    const claiming = this.rootOf(Number(ask.id));
    if (claiming) this.taking.set(claiming.id, agentId);
    this.mark(Number(ask.id), "working");
    // So a permission request arriving mid-turn can be attributed and put in
    // the thread it belongs to rather than at the top of the file.
    this.asking = agentId;
    this.working = Number(ask.id);

    const prompt = promptFor({
      agent: kind.name,
      ...(this.placeOf(Number(ask.id)) ? { place: this.placeOf(Number(ask.id))! } : {}),
      said: this.threadOf(Number(ask.id)),
      ask: ask.body,
      ...(ask.owner ? { owner: this.nameOf(ask.owner) } : {}),
      others: this.order
        .filter((id) => id !== agentId)
        .map((id) => this.installed.find((one) => one.id === id)?.name ?? id)
        .filter(Boolean),
    });

    /**
     * Written down every so often, not only when the turn ends.
     *
     * A turn that ends normally saves its log. One that ends because the window
     * went away does not — and that is exactly the turn somebody comes back
     * wanting to read, to find out what it managed before it stopped.
     */
    let kept = 0;
    const say = (chunk: string): void => {
      this.transcripts.set(agentId, tail((this.transcripts.get(agentId) ?? "") + chunk));
      const now = Date.now();
      if (now - kept > 4000) {
        kept = now;
        this.save();
      }
      // Not `changed`: the terminal follows its own channel, and redrawing
      // every comment for every line an agent prints would be a rebuild per
      // character.
      this.printed?.(agentId, chunk);
    };

    const start = (args?: string[]): RunHandle => {
      const handle = runAgent({
        kind,
        prompt,
        cwd: this.repo,
        env: forgeEnv(),
        ...(args ? { args } : {}),
        onOutput: say,
        onEdit: (change) => this.record(agentId, change),
      });
      this.running.set(agentId, handle);
      return handle;
    };

    let run;
    try {
      const carrying = this.sessions[agentId];

      /*
       * What it is actually being run with, in its own log.
       *
       * An agent that comes back saying it was refused permission is either on
       * a rung that refuses, or on a rung the reader thought they had changed —
       * and from outside those look identical. The invocation is the only thing
       * that settles it, and the terminal is where somebody is already looking
       * when they ask.
       */
      /*
       * What it was asked, in its own log, before what it did about it.
       *
       * A terminal that opens with an invocation and then eight paragraphs of
       * answer is missing the question — and the question is the one thing the
       * reader wrote themselves. Carried with the conversation it belongs to,
       * so the log can offer to take them back to it.
       *
       * Every line prefixed rather than only the first: the marker has to
       * survive being split back apart by whatever draws it, and a question is
       * routinely several lines long.
       */
      const root = this.rootOf(Number(ask.id));
      const asked = ask.body
        .split("\n")
        .map((line) => `[odin:ask ${root?.id ?? ask.id}] ${line}`)
        .join("\n");
      say(`\n${asked}\n`);

      /*
       * Worked out, and not written down.
       *
       * The invocation went into the log while it was in question whether the
       * rung was reaching the tool at all. It was — and what is left is a line
       * of flags between every question and its answer, in a box whose whole
       * job is to be readable. What it answered is answered better elsewhere:
       * the rung is a control at the top of this terminal, and the conversation
       * has a button that copies its id.
       */
      const chosen = this.argsFor(kind, agentId);
      // The arguments already worked out, not worked out again: asking twice
      // mints a second conversation and then tries to resume the first.
      run = await start(chosen).done;

      /*
       * A conversation the tool no longer has.
       *
       * The id is ours and it is kept here, but the transcript behind it is the
       * tool's and lives in its own directory — cleared by an uninstall, a
       * cleanup, a new machine, or a tool that expires old sessions. Resuming
       * one that has gone fails immediately and produces nothing, which from
       * the thread looks exactly like an agent that had nothing to say.
       *
       * So the conversation is started again under a new name and the turn is
       * run a second time. The reader loses what the agent remembered, which is
       * already lost; what they do not lose is the answer.
       */
      if (run.code !== 0 && carrying && kind.session) {
        say(`\n[odin] could not resume ${carrying}; starting a new conversation\n`);
        delete this.sessions[agentId];
        this.save();
        run = await start(this.argsFor(kind, agentId)).done;
      }
    } finally {
      this.running.delete(agentId);
      this.state.set(agentId, "idle");
      this.asking = undefined;
      this.working = undefined;
      // The turn is over, so the claim goes back to being whatever the thread
      // says it is — which, by now, includes whatever this agent said in it.
      if (claiming) this.taking.delete(claiming.id);
      /*
       * Anything still parked is refused, now that nobody is waiting on it.
       *
       * The turn has ended — the tool gave up, or was stopped, or finished
       * around the request. Leaving the promise unsettled would leak it, and
       * leaving the remark saying "waiting" would leave a button in the thread
       * that answers nothing.
       */
      for (const [id] of [...this.waitingOn]) this.answer(id, false);
    }

    /*
     * The reply, which is what it printed as an answer and not what it logged.
     *
     * A transcript is a log; a comment is a message. The line between them is
     * not a guess: every tool here runs in its answer-once mode, and in that
     * mode standard output is the reply while progress and complaints go to
     * standard error. Both are in the terminal; only one belongs in a thread.
     */
    // What the tool said was its answer, when it narrated and named one.
    // Otherwise everything it printed, which is the whole answer for a tool
    // that simply prints.
    const said = run.answer !== undefined ? replyIn(run.answer) : replyIn(run.output);
    this.mark(Number(ask.id), run.code === 0 && !run.stopped ? "done" : "failed");

    const finished = run.code === 0 && !run.stopped;
    if (said) {
      this.reply(Number(ask.id), kind.name, agentId, said, finished);
    } else if (run.code !== 0) {
      this.reply(
        Number(ask.id),
        kind.name,
        agentId,
        run.stopped
          ? "Stopped before finishing."
          : `Could not finish — ${kind.command} exited ${run.code}. The terminal has what it printed.`,
        false,
      );
    }

    // The log, written down now the turn is over. Not on every chunk: that
    // would be a write to the editor's storage per line an agent prints.
    this.save();
    this.changed();
    this.pump();
  }

  /**
   * How to invoke this agent for this turn: starting, or carrying on.
   *
   * Minting on the way past, so the id exists before the conversation does.
   * That ordering is what makes recovery survive a crash: there is nothing to
   * read out of the output afterwards, and a turn that dies before printing a
   * word still leaves a named conversation to come back to.
   */
  private argsFor(kind: AgentKind, agentId: string): string[] | undefined {
    /*
     * What lets it act, added to whatever names the conversation.
     *
     * Every one of these tools stops and asks before writing a file, and here
     * there is nobody to ask: no terminal, standard input closed, the reader
     * looking at a graph. Without this an agent given real work comes back
     * having worked out exactly what to do and been refused permission to do
     * it — which is the least useful answer available and reads as the tool
     * being broken.
     */
    const free = kind.agency?.[this.agencyOf(agentId)] ?? [];
    // Narrated, where the tool can: a terminal that says nothing for four
    // minutes and then everything at once is the thing this box exists to fix.
    const aloud = kind.streams?.args ?? [];

    /*
     * Where to ask, for a tool that can be told to ask.
     *
     * Only below the top rung: an agent run with the checks off has nothing to
     * ask about, and handing it a place to ask anyway would be a socket nobody
     * ever opens. And only when the stub is actually on disk, which it is not
     * when this runs from a test or a checkout that was never packaged.
     */
    const asking =
      kind.asks && PairingSession.stub && this.agencyOf(agentId) !== "full"
        ? kind.asks(this.configFor(kind))
        : [];

    const extra = [...free, ...asking, ...aloud];
    if (!kind.session) return extra.length ? [...kind.once, ...extra] : undefined;

    const held = this.sessions[agentId];
    if (held) return [...kind.session.resume(held), ...extra];

    const fresh = randomUUID();
    this.sessions[agentId] = fresh;
    this.save();
    return [...kind.session.start(fresh), ...extra];
  }

  /**
   * Whether the agents may act without stopping to ask.
   *
   * The reader's switch, and it is a real one: on, these tools write files and
   * run commands in this checkout with no sandbox and no confirmation. That is
   * what makes them useful for the work they are being handed, and it is not a
   * decision to make on somebody's behalf in a constant.
   */
  private agency: Record<string, Agency> = {};

  /** What the reader has allowed each agent, from the page. */
  setAgency(levels: Record<string, Agency>): void {
    this.agency = levels;
  }

  /**
   * What this agent is allowed, falling back to what most work needs.
   *
   * `edits` rather than `ask`, because asking has nowhere to go here — no
   * terminal, standard input closed, the reader looking at a graph — and an
   * agent that comes back having worked out exactly what to do and been
   * refused permission to do it reads as a broken tool rather than a setting.
   * Not `full` either: writing files in the checkout the reader is looking at
   * is the work, and running arbitrary commands is a separate decision they
   * can make per agent.
   */
  private agencyOf(agentId: string): Agency {
    return this.agency[agentId] ?? "edits";
  }

  /** Which rungs each installed tool actually offers, for the page to draw. */
  rungs(): Record<string, Agency[]> {
    const out: Record<string, Agency[]> = {};
    for (const kind of this.installed) {
      out[kind.id] = ["ask", ...(Object.keys(kind.agency ?? {}) as Agency[])];
    }
    return out;
  }

  /**
   * Which tools say what they are doing as they do it.
   *
   * The ledger is read off a narrated turn — the tool announces each call it
   * makes, and the edits are lifted out of those announcements. A tool with no
   * streaming mode prints its answer and nothing else, so there is nothing to
   * lift, and its ledger is empty however much it changed.
   *
   * Which the page has to be told, because an empty list means two completely
   * different things: this agent has not written anything, or this agent
   * cannot say. Told rather than inferred from an empty list, since the first
   * of those is also what a fresh session looks like.
   */
  narrating(): string[] {
    return this.installed.filter((kind) => kind.streams).map((kind) => kind.id);
  }

  /** Which conversation an agent is carrying here, for whoever asks. */
  session(agentId: string): string | undefined {
    return this.sessions[agentId];
  }

  /**
   * Signs the reader's own remarks once the forge has said who they are.
   *
   * A remark appears the instant it is written, which is before anyone has
   * asked `gh` anything — so the first ones in a session are signed with a
   * placeholder. Leaving them that way puts "you" in a thread beside everybody
   * else's real name and picture, and it stays that way for ever because
   * nothing else ever revisits a written comment.
   *
   * Only the reader's own: an agent's messages are signed by the agent, and a
   * remark that came from the forge belongs to whoever wrote it there.
   *
   * Answers whether anything changed, so a page is only redrawn when it would
   * look different.
   */
  identify(login: string, face: string): boolean {
    let touched = false;
    this.comments = this.comments.map((comment) => {
      if (comment.agent || comment.author === login) return comment;
      if (comment.author !== PLACEHOLDER) return comment;
      touched = true;
      return {
        ...comment,
        author: login,
        ...(face ? { avatarUrl: face } : {}),
      };
    });
    if (touched) this.save();
    return touched;
  }

  /** What the reader calls this agent's conversation here, if anything. */
  label(agentId: string): string {
    return this.labels[agentId] ?? "";
  }

  /** Every label, for the page to draw its terminals with. */
  labelled(): Record<string, string> {
    return { ...this.labels };
  }

  /**
   * Rewrites a remark the reader wrote here.
   *
   * Only their own: an agent's message is the record of what it actually said,
   * and editing that would leave a thread that reads as an audit trail and is
   * not one.
   */
  edit(id: number, body: string): boolean {
    let touched = false;
    this.comments = this.comments.map((comment) => {
      if (comment.id !== id || comment.agent) return comment;
      touched = true;
      return { ...comment, body };
    });
    if (touched) {
      this.save();
      this.changed();
    }
    return touched;
  }

  /**
   * Removes a remark, and everything hanging off it when it is a whole thread.
   *
   * A root taken away without its replies would leave those replies orphaned:
   * the grouping follows the reply pointers up, so they would each become a
   * thread of their own, scattered across the file at the same line.
   */
  remove(id: number): boolean {
    const before = this.comments.length;
    const root = this.rootOf(id);
    const whole = root?.id === id;
    this.comments = this.comments.filter((comment) =>
      whole
        ? this.rootOf(comment.id)?.id !== id
        : comment.id !== id,
    );
    if (this.comments.length === before) return false;
    this.save();
    this.changed();
    return true;
  }

  /** Names a conversation, or takes the name off it again. */
  rename(agentId: string, name: string): void {
    const trimmed = name.trim().slice(0, 60);
    if (trimmed) this.labels[agentId] = trimmed;
    else delete this.labels[agentId];
    this.save();
    this.changed();
  }

  /** The agents that have something to carry on from, for the panel to say so. */
  carrying(): string[] {
    return Object.keys(this.sessions);
  }

  /**
   * Forgets the conversations without forgetting what was said in the thread.
   *
   * Two different things: the messages are the reader's record and stay, while
   * the agents' own memory of how they got there is theirs. Starting over is
   * sometimes exactly what is wanted — an agent that has talked itself into a
   * corner carries that corner into every following turn.
   */
  forgetSessions(): void {
    this.sessions = {};
    this.save();
  }

  /**
   * Everything this reading holds, thrown away.
   *
   * For a reading that has ended up holding a conversation about some other
   * change — which is what a live reading of a second branch in one checkout
   * used to inherit, and what a reader is left with once it has. There is no
   * way to sort one branch's remarks from another's after the fact: the record
   * was kept under a name with no branch in it, so nothing in it says which
   * branch it was about.
   *
   * Deliberately whole. A partial clear would leave threads whose roots had
   * gone and agents carrying conversations about remarks that no longer exist,
   * which is a worse state than either.
   */
  forgetEverything(): void {
    this.comments = [];
    this.sessions = {};
    this.labels = {};
    this.settled = {};
    this.deltas = [];
    this.transcripts.clear();
    this.next = FIRST_LOCAL;
    this.save();
    this.changed();
  }

  /** What this reading is holding, for a warning that has to name it. */
  weight(): { remarks: number; agents: number } {
    return {
      remarks: this.comments.length,
      agents: Object.keys(this.sessions).length,
    };
  }

  /** What an agent is called, which is what a prompt and a thread both use. */
  private nameOf(id: string): string {
    return this.installed.find((one) => one.id === id)?.name ?? id;
  }

  /* -------------------------------------------------------- being asked */

  /**
   * Where Claude's permission tool reaches us.
   *
   * A socket rather than anything shared in-process, because the tool that asks
   * is not this process: Claude spawns its own copy of the asking stub, and the
   * stub's only way back here is something it can open by name.
   *
   * Made on first use and kept for the life of the reading. Opening one per
   * turn would leave a file per turn behind and a race at the start of each.
   */
  private door: Server | undefined;
  private doorPath = "";

  /** Requests parked on a reader who has not answered yet. */
  private readonly waitingOn = new Map<
    string,
    { settle: (decision: unknown) => void; comment: number }
  >();

  /** Where the spawnable stub lives. Set once, at activation. */
  static stub = "";

  private opened(): string {
    if (this.door) return this.doorPath;

    // Short, because a unix socket path is bounded at about a hundred
    // characters and a workspace path is not.
    this.doorPath = join(mkdtempSync(join(tmpdir(), "odin-ask-")), "s");
    this.door = createServer((socket) => {
      let held = "";
      socket.on("error", () => undefined);
      socket.on("data", (chunk) => {
        held += String(chunk);
        const at = held.indexOf("\n");
        if (at < 0) return;
        let asked: { tool?: string; input?: unknown; agent?: string };
        try {
          asked = JSON.parse(held.slice(0, at));
        } catch {
          socket.end(`${JSON.stringify({ behavior: "deny", message: "unreadable" })}\n`);
          return;
        }
        held = held.slice(at + 1);
        void this.decide(asked).then((decision) => {
          try {
            socket.end(`${JSON.stringify(decision)}\n`);
          } catch {
            /* the tool gave up waiting, which is its answer */
          }
        });
      });
    });
    this.door.on("error", () => undefined);
    this.door.listen(this.doorPath);
    return this.doorPath;
  }

  /**
   * Whether this may go ahead, asking the reader only when it has to.
   *
   * The rung is a standing answer, and re-asking a question already answered is
   * how a permission prompt becomes something people click through without
   * reading. So anything the rung covers is allowed without an interruption,
   * and the reader is kept for what the prompt is actually for: an agent
   * reaching past what it was given.
   */
  private decide(asked: { tool?: string; input?: unknown }): Promise<unknown> {
    const tool = asked.tool ?? "";
    const agentId = this.asking ?? "";
    const rung = this.agencyOf(agentId);

    if (permitted(rung, doingOf(tool))) {
      return Promise.resolve({ behavior: "allow", updatedInput: asked.input ?? {} });
    }

    const what = describeRequest(tool, asked.input);
    const id = randomUUID();
    const comment = this.say(agentId, `May I ${what}?`, { id, what, state: "waiting" });

    return new Promise((settle) => {
      this.waitingOn.set(id, { settle, comment });
    });
  }

  /** The reader's answer, which is also the end of the waiting. */
  answer(id: string, allow: boolean): void {
    const held = this.waitingOn.get(id);
    if (!held) return;
    this.waitingOn.delete(id);

    this.comments = this.comments.map((comment) =>
      comment.id === held.comment && comment.approval
        ? { ...comment, approval: { ...comment.approval, state: allow ? "allowed" : "denied" } }
        : comment,
    );
    this.save();
    this.changed();

    held.settle(
      allow
        ? { behavior: "allow", updatedInput: {} }
        : { behavior: "deny", message: "The reviewer declined this." },
    );
  }

  /** Everything a reader has been asked and has not answered. */
  pending(): { id: string; what: string }[] {
    const out: { id: string; what: string }[] = [];
    for (const comment of this.comments) {
      if (comment.approval?.state === "waiting" && this.waitingOn.has(comment.approval.id)) {
        out.push({ id: comment.approval.id, what: comment.approval.what });
      }
    }
    return out;
  }

  /** Whichever agent's turn is running, so a request can be attributed. */
  private asking: string | undefined;

  /** A message from an agent, in the thread it is working in. */
  private say(
    agentId: string,
    body: string,
    approval?: LocalComment["approval"],
  ): number {
    const root = this.rootOf(this.working ?? 0);
    const id = this.next--;
    this.comments = [
      ...this.comments,
      {
        id,
        path: root?.path ?? "",
        line: root?.line ?? 0,
        ...(root?.startLine !== undefined ? { startLine: root.startLine } : {}),
        side: root?.side ?? "RIGHT",
        body,
        author: this.nameOf(agentId),
        avatarUrl: avatarFor(agentId),
        createdAt: new Date().toISOString(),
        url: "",
        outdated: false,
        ...(root ? { inReplyTo: root.id } : {}),
        local: true,
        agent: agentId,
        ...(approval ? { approval } : {}),
      },
    ];
    this.save();
    this.changed();
    return id;
  }

  /** The message whose turn is running, so a request lands in its thread. */
  private working: number | undefined;

  /** Told when an agent prints, for a terminal that is following along. */
  printed: ((agent: string, chunk: string) => void) | undefined;

  /**
   * An agent's message, in the thread the ask belongs to.
   *
   * An answer ends the conversation unless the answer says otherwise. That is
   * what an answer usually is — the reader asked, the agent did the work and
   * said what it did — and a thread left open after every one of them turns a
   * list of a hundred and eighty-five into a list nobody reads. An agent whose
   * answer is really a question writes `keep-open` on a line of its own, which
   * is taken out before the reader sees it: it is an instruction to Odin rather
   * than something said to them.
   */
  private reply(
    to: number,
    name: string,
    agentId: string,
    body: string,
    /**
     * Whether this answer is one.
     *
     * A tool that exited non-zero, or that was stopped part-way, still writes
     * into the thread — that is how the reader finds out — but what it writes
     * is an apology rather than an answer, and settling the conversation on one
     * would file the question under "done" precisely when it is not.
     */
    answers = true,
  ): void {
    const root = this.rootOf(to);
    if (!root) return;

    const open = !answers || keepsOpen(body);
    const said = open ? withoutMarker(body) : body;
    const id = this.next--;
    this.comments = [
      ...this.comments,
      {
        id,
        path: root.path,
        line: root.line,
        ...(root.startLine !== undefined ? { startLine: root.startLine } : {}),
        side: root.side,
        body: said,
        author: name,
        // Drawn rather than fetched: a webview will not load a remote image,
        // and everybody else in the thread already has a face.
        avatarUrl: avatarFor(agentId),
        createdAt: new Date().toISOString(),
        url: "",
        outdated: false,
        inReplyTo: root.id,
        local: true,
        agent: agentId,
      },
    ];
    this.save();
    if (!open) this.settle(root.id, true);
    else this.changed();
  }

  /**
   * Something Odin has to say in a thread, signed by Odin.
   *
   * Not an agent and not the reader. A message that was not sent because its
   * code had gone is a fact about the conversation, and the conversation is
   * where the record of this whole thing lives — a warning that appeared once
   * in the corner of the editor and then vanished is not a record of anything.
   */
  private note(to: number, body: string): void {
    const root = this.rootOf(to);
    if (!root) return;
    this.comments = [
      ...this.comments,
      {
        id: this.next--,
        path: root.path,
        line: root.line,
        ...(root.startLine !== undefined ? { startLine: root.startLine } : {}),
        side: root.side,
        body,
        author: "Odin",
        createdAt: new Date().toISOString(),
        url: "",
        outdated: false,
        inReplyTo: root.id,
        local: true,
      },
    ];
    this.save();
    this.changed();
  }

  /** Moves a message's badge, which is the only thing on it that changes. */
  private mark(id: number, task: LocalComment["task"]): void {
    let touched = false;
    this.comments = this.comments.map((comment) => {
      if (comment.id !== id) return comment;
      touched = true;
      return { ...comment, task };
    });
    if (touched) {
      this.save();
      this.changed();
    }
  }

  /**
   * Who has claimed the conversation this message belongs to.
   *
   * Every remark in the thread, not merely the replies to this one: a claim is
   * about the conversation, and a reader who starts a second branch of it is
   * still talking to the agent that has been doing the work.
   */
  private ownerOfThread(id: number): string | undefined {
    const root = this.rootOf(id);
    if (!root) return undefined;
    return ownerOf(
      this.comments.filter(
        (comment) => this.rootOf(comment.id)?.id === root.id,
      ),
    );
  }

  /** Conversations taken but not yet spoken in: root id to the agent on it. */
  private readonly taking = new Map<number, string>();

  /** Who has claimed a thread, for the page to say so on it. */
  owners(): Record<number, string> {
    const claimed: Record<number, string> = {};
    for (const comment of this.comments) {
      if (comment.inReplyTo !== undefined) continue;
      const who = this.ownerOfThread(comment.id);
      if (who) claimed[comment.id] = who;
    }
    // A turn in progress on a conversation nobody has spoken in yet. The
    // thread's own answer wins where it has one: an agent working on a
    // conversation another agent claimed earlier does not take it over.
    for (const [root, agent] of this.taking) {
      if (!claimed[root]) claimed[root] = agent;
    }
    return claimed;
  }

  /** The comment a thread hangs off, following the reply pointers up. */
  private rootOf(id: number): LocalComment | undefined {
    const by = new Map(this.comments.map((comment) => [comment.id, comment]));
    let current = by.get(id);
    const seen = new Set<number>();
    while (current?.inReplyTo !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const up = by.get(current.inReplyTo);
      if (!up) break;
      current = up;
    }
    return current;
  }

  /**
   * The conversation an ask belongs to, oldest first.
   *
   * Everything said in it, including what other agents have written. That is
   * what makes a claim mean anything: an agent that cannot see "On it" has no
   * way to stay out of work somebody else took.
   */
  private threadOf(id: number): { author: string; body: string }[] {
    const root = this.rootOf(id);
    if (!root) return [];
    return this.comments
      .filter(
        (comment) =>
          comment.id !== id &&
          (comment.id === root.id || this.rootOf(comment.id)?.id === root.id),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((comment) => ({ author: comment.author, body: comment.body }));
  }

  /** Where the thread is anchored, in words an agent can act on. */
  private placeOf(id: number): string | undefined {
    const root = this.rootOf(id);
    if (!root) return undefined;
    /*
     * A question about the change rather than about a line.
     *
     * Said in words rather than left out: without it the prompt simply has no
     * "this is about" line, and an agent reading a bare question in a review
     * tool assumes it is about whatever it looked at last. `:0` would be worse
     * — a file called nothing, at a line that does not exist.
     */
    if (!root.path) return "the change as a whole, not one line of it";

    /*
     * The lines as they are now, not as they were when the remark was written.
     *
     * This is the whole point of anchoring. A message can sit in the queue for
     * minutes while another agent works, and the file it is about is the file
     * that agent is editing — so by the time this prompt is built, the numbers
     * the reader picked may name entirely different code. Handing those over is
     * how an agent ends up confidently editing the wrong place.
     */
    const now = this.standing(root);
    if (now?.state === "moved") {
      return `${root.path}:${spanText(now.span)} — the passage this was written about, which has moved since (it was at ${spanText(now.from)})`;
    }

    /*
     * The reader has been asked and said send it anyway.
     *
     * So the prompt says what is true: the line number names something else
     * now, and here is the code the remark was actually about. An agent given
     * that looks for the code; an agent given the bare number edits whatever is
     * sitting on it, which is the failure this whole mechanism exists to stop.
     */
    if (now?.state === "gone") {
      return [
        `${root.path}, around line ${spanText(now.from)} — but the code this was written about is no longer there.`,
        "It read:",
        root.anchor?.text ?? "",
        "Find where that has gone before changing anything. Do not assume the line numbers above still name it.",
      ].join("\n");
    }

    const span = {
      line: root.line,
      ...(root.startLine !== undefined && root.startLine < root.line
        ? { startLine: root.startLine }
        : {}),
    };
    return `${root.path}:${spanText(span)}`;
  }

  /**
   * Ends one agent's turn, because the reader said so.
   *
   * Not an error and not a failure of the tool: an agent three minutes into
   * rewriting something the reader has changed their mind about is doing work
   * that is already wrong, and watching it finish helps nobody. The turn ends
   * the way it would if the window had gone away — the tool is stopped, what it
   * printed stays in the log, and the remark it was answering is marked as
   * having been stopped, which is the state that offers to ask again.
   *
   * Silent for an agent that is not running: pressing stop on a turn that ended
   * a moment ago is a reasonable thing to do by accident, and it should do
   * nothing rather than complain.
   */
  stop(agentId: string): void {
    this.running.get(agentId)?.stop();
  }

  /**
   * What is written and waiting, in the order it will be taken.
   *
   * The queue is the one part of this the reader cannot see anywhere else. A
   * message that has been written and not yet started is a mark in a margin
   * they may be nowhere near, and the terminal — where somebody watching an
   * agent work is actually looking — said only what was running. So four
   * questions asked in a row looked exactly like one.
   */
  queued(): { id: number; body: string; addressee?: string }[] {
    return this.waiting.map((ask) => ({
      id: Number(ask.id),
      body: ask.body,
      ...(ask.addressee ? { addressee: ask.addressee } : {}),
    }));
  }

  /**
   * Takes a message back before anybody has started on it.
   *
   * Cheap and complete, which is the whole difference between this and
   * stopping a turn: nothing has run, so there is nothing to undo. The remark
   * stays in the thread — it was written, and the record of a review is what
   * was said, not what survived — and it is marked as stopped, which is the
   * state that offers to ask it again.
   *
   * Silent for a message that has already been taken. Between deciding to
   * cancel and pressing the button an agent may have picked it up, and the
   * honest answer then is that it is running: `stop` is the control for that,
   * and quietly doing nothing is better than half-cancelling something.
   */
  cancel(id: number): void {
    const before = this.waiting.length;
    this.waiting = this.waiting.filter((ask) => Number(ask.id) !== id);
    if (this.waiting.length === before) return;
    this.mark(id, "stopped");
  }

  /** Ends every turn in flight. The reading is going away. */
  dispose(): void {
    for (const handle of this.running.values()) handle.stop();
    this.running.clear();
    this.waiting = [];
    // Nobody is left to ask, so nothing more may be allowed.
    for (const [id] of [...this.waitingOn]) this.answer(id, false);
    this.door?.close();
    this.door = undefined;
  }
}

/**
 * How much of a session is worth keeping.
 *
 * An agent left running against a large repository prints without limit, and
 * every byte of it is held three times over: here, in the page, and in the
 * markdown the terminal parses out of it. None of that is bounded by anything
 * else — a turn ends when the work ends, not when the log gets inconvenient.
 *
 * The tail rather than the head, because the end is what somebody watching is
 * looking at, and the beginning of a log nobody read is the cheapest thing in
 * it to lose.
 */
const KEEP = 400_000;

/**
 * How much of a finished turn is worth writing down.
 *
 * A fifth of what is held while it runs. Storage is the editor's, shared with
 * everything else that wants to remember something about this workspace, and
 * this is scrollback for a turn that has already ended.
 */
const KEEP_STORED = 80_000;

function keepable(text: string): string {
  return text.length <= KEEP_STORED
    ? text
    : `[odin] …earlier output dropped\n${text.slice(text.length - KEEP_STORED)}`;
}

/**
 * A passage as it reads inside a dialogue, which has no room for a file.
 *
 * Shown at all because the numbers are exactly what has stopped being true: a
 * reader asked to decide about `src/a.ts:212-219` cannot decide anything from
 * that, and the code is the only thing left that says what the remark was
 * about.
 */
function quoted(passage: string): string {
  const lines = passage.split("\n");
  const shown = lines.slice(0, 8).map((line) => `    ${line}`);
  if (lines.length > 8) shown.push(`    … ${lines.length - 8} more lines`);
  return shown.join("\n");
}

/** The head of a span, as a place in a document. */
function spot(span: { line: number; startLine?: number }): vscode.Position {
  return new vscode.Position(Math.max(0, (span.startLine ?? span.line) - 1), 0);
}

/**
 * Every way this checkout is spelled, longest first.
 *
 * `/tmp` and `/var` are symlinks into `/private` on macOS, and which of the two
 * spellings a path arrives in depends on whether whoever produced it resolved
 * its working directory. A tool spawned in `/var/folders/…/repo` reports the
 * files it edited under `/private/var/folders/…/repo`, and a prefix test
 * against the one this process was handed misses every one of them.
 */
function roots(repo: string): string[] {
  const one = repo.endsWith("/") ? repo : `${repo}/`;
  const other = one.startsWith("/private/") ? one.slice("/private".length) : `/private${one}`;
  return [one, other].sort((a, b) => b.length - a.length);
}

function tail(text: string): string {
  if (text.length <= KEEP) return text;
  const cut = text.slice(text.length - KEEP);
  // From a line boundary, so the first thing on screen is not half a word.
  const start = cut.indexOf("\n");
  return `[odin] …earlier output dropped\n${start >= 0 ? cut.slice(start + 1) : cut}`;
}

/**
 * Odin's old habit of writing the invocation into the log, undone.
 *
 * It stopped being written when the question it answered was settled, and that
 * left every conversation started before then carrying a line of flags between
 * each question and its answer — for ever, because a log is kept. Nothing
 * regenerates these, so they are taken out on the way in.
 *
 * Only the invocations. The other notes — a conversation that could not be
 * resumed, output dropped for length — are Odin explaining something that
 * happened, and are the reason the prefix exists.
 */
function withoutInvocations(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\[odin\] \S+ --/.test(line))
    .join("\n");
}

/** As much of a message as a conversation should hold. */
const LONGEST = 2000;

/**
 * An agent's answer, as a message in a thread.
 *
 * Given what the tool printed as its answer, so there is nothing to separate
 * out — the separating happened where it can be done honestly, between the two
 * streams. What is left is bounding it: a thread is a conversation, and a reply
 * that has to be scrolled for a minute is a log posted into one. The whole of
 * it stays in the terminal, and the message says where to find it rather than
 * ending mid-sentence with no explanation.
 */
export function replyIn(output: string): string {
  // Odin's own notes about a turn are not the agent's message. It never wrote
  // them, and posting them as its words puts words in its mouth.
  const body = output
    .split("\n")
    .filter((line) => !line.startsWith("[odin]"))
    .join("\n")
    .trim();

  if (body.length <= LONGEST) return body;
  return `${body.slice(0, LONGEST).trimEnd()}\n\n…the rest is in the terminal.`;
}
