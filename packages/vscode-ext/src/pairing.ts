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
  promptFor,
  runAgent,
  type Agency,
  type AgentKind,
  type AgentState,
  type Ask,
  type ReviewComment,
  type RunHandle,
} from "@odin/core";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  ) {
    this.load();
  }

  /* ------------------------------------------------------------- the store */

  private load(): void {
    let held: Stored | undefined;
    try {
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
    return this.comments;
  }

  /** What this machine can run, as the panel and the queue both need it. */
  agents(): AgentKind[] {
    return this.installed;
  }

  /** Whatever the named agent has printed this session. */
  transcript(id: string): string {
    return this.transcripts.get(id) ?? "";
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

    this.comments = [...this.comments, comment];
    this.save();

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

    this.state.set(agentId, "working");
    this.mark(Number(ask.id), "working");
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
     */
    const claiming = this.rootOf(Number(ask.id));
    if (claiming) this.taking.set(claiming.id, agentId);
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

    if (said) {
      this.reply(Number(ask.id), kind.name, agentId, said);
    } else if (run.code !== 0) {
      this.reply(
        Number(ask.id),
        kind.name,
        agentId,
        run.stopped
          ? "Stopped before finishing."
          : `Could not finish — ${kind.command} exited ${run.code}. The terminal has what it printed.`,
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

  /** An agent's message, in the thread the ask belongs to. */
  private reply(to: number, name: string, agentId: string, body: string): void {
    const root = this.rootOf(to);
    if (!root) return;

    const id = this.next--;
    this.comments = [
      ...this.comments,
      {
        id,
        path: root.path,
        line: root.line,
        ...(root.startLine !== undefined ? { startLine: root.startLine } : {}),
        side: root.side,
        body,
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
    const span =
      root.startLine !== undefined && root.startLine < root.line
        ? `${root.startLine}-${root.line}`
        : String(root.line);
    return `${root.path}:${span}`;
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
