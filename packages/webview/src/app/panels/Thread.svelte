<!--
  An open conversation, beside the line it is about.

  Comments already on the pull request are shown next to the file rather than in
  it. A remark is about a line but it is not part of the code, and threading it
  through the diff pushes the code around to make room for something the reader
  may not want to read yet. The mark sits in the margin at the height of the
  line; this is what it opens.

  The box takes the empty canvas to the left of the file and never crosses onto
  it: a reader answering a remark is reading the code it quotes, and a panel over
  that code takes away the thing being discussed.
-->
<script module lang="ts">
  import type { CommentView } from "../model.js";

  /** One conversation: what was said first, and everything said since. */
  export interface Conversation {
    root: CommentView;
    comments: CommentView[];
  }

  /**
   * The comments, grouped into the conversations they belong to.
   *
   * Derived rather than stored. The host replaces the whole list every time the
   * forge answers, and a second copy kept alongside it is a copy that is wrong
   * from the moment a reply lands — which showed up as a thread that had been
   * answered still saying it had not.
   */
  export function threadsOf(comments: CommentView[]): Conversation[] {
    const byId: Record<string, CommentView> = {};
    for (const comment of comments) byId[comment.id] = comment;

    // A reply belongs to whatever it answers, however deep the chain goes.
    const rootOf = (comment: CommentView): CommentView => {
      const seen: Record<string, boolean> = {};
      let current = comment;
      while (current.inReplyTo && byId[current.inReplyTo] && !seen[current.id]) {
        seen[current.id] = true;
        current = byId[current.inReplyTo];
      }
      return current;
    };

    const groups: Record<string, Conversation> = {};
    const order: string[] = [];
    for (const comment of comments) {
      const root = rootOf(comment);
      if (!groups[root.id]) {
        groups[root.id] = { root, comments: [] };
        order.push(root.id);
      }
      groups[root.id].comments.push(comment);
    }

    return order.map((id) => {
      const group = groups[id];
      group.comments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return group;
    });
  }

  /** The author's initials, for when the page has no picture of them. */
  export function initialsOf(name: string): string {
    return (name || "?")
      .replace(/[^a-zA-Z0-9]/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  /**
   * The picture the host sent, under either of the names it sends it under.
   *
   * The page is built with an avatar field and the forge answers with an
   * avatarUrl, so every refresh after a reaction quietly replaced the faces with
   * initials — the pictures were there all along, under another name.
   */
  export function faceOf(comment: { avatar?: string }): string | undefined {
    const either = comment as { avatar?: string; avatarUrl?: string };
    return either.avatar || either.avatarUrl;
  }

  /**
   * How long ago, said the way a reader would say it.
   *
   * Minutes matter in a conversation: "today" on a remark written four minutes
   * ago tells you nothing about whether the person is still there.
   */
  export function ago(iso: string): string {
    const then = Date.parse(iso);
    if (!then) return "";
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    const days = Math.round(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 30) return days + " days ago";
    const months = Math.round(days / 30);
    if (months < 12) return months + (months === 1 ? " month ago" : " months ago");
    const years = Math.round(months / 12);
    return years + (years === 1 ? " year ago" : " years ago");
  }

  /** The moment itself, in the reader's own locale, for when relative is not enough. */
  export function exactly(iso: string): string {
    const then = new Date(iso);
    return isNaN(then.getTime()) ? "" : then.toLocaleString();
  }

  /** Which file and which lines, as short as it can be said. */
  export function placeOf(root: CommentView): string {
    // A question about the change rather than about a line has no file to name
    // and is not nowhere.
    if (!root.path) return "the change";
    const file = root.path.split("/").pop() ?? root.path;
    if (root.wholeFile) return file;
    const span =
      root.startLine && root.startLine < root.line
        ? root.startLine + "–" + root.line
        : String(root.line);
    return file + ":" + span;
  }

  /** Where a mark has ended up on screen, as the browser reports it. */
  export interface Anchor {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  }

  interface Reaction {
    content: string;
    count: number;
  }

  /** The eight the forge offers, in the order it offers them. */
  const EMOJI: Record<string, string> = {
    "+1": "👍",
    "-1": "👎",
    laugh: "😄",
    hooray: "🎉",
    confused: "😕",
    heart: "❤️",
    rocket: "🚀",
    eyes: "👀",
  };

  function reactionsOf(comment: CommentView): Reaction[] {
    return Array.isArray(comment.reactions) ? (comment.reactions as Reaction[]) : [];
  }
</script>

<script lang="ts">
  import type { CommentView } from "../model.js";
  import { host, model, notify, ui } from "../state.svelte.js";
  // The exact module, not the package: `@odin/core` reaches git and spawns
  // processes, none of which exists in a browser.
  import { markOf } from "@odin/core/agents/marks.js";
  import { forget, load, remember, threadKey } from "./drafts.js";
  import Editor from "./Editor.svelte";
  import { EDGE, leftOf, topOf, WIDEST, widthOf } from "./thread.js";

  let {
    /** The conversation on screen, named by the remark that started it. */
    openId = null,
    /**
     * Where the mark that opened this ended up, in screen coordinates.
     *
     * Passed in rather than measured here, and the placement below is derived
     * from it. Placing the thread by calling a function after the mark had moved
     * left it a frame behind — enough, after a flight across the canvas, to sit
     * on the wrong side of the file it belongs to. A value cannot be sequenced
     * wrongly: the box is wherever the mark is, in the same update.
     */
    anchor = null,
    /**
     * The rows a remark covers, read back off the card it points at. Only the
     * canvas knows them, and a suggestion needs them to show what it replaces.
     */
    linesOf = null,
    /**
     * Which end of the conversation the reader asked for.
     *
     * "agent" means they pressed an agent's face — on the mark in the margin,
     * or wherever else one is drawn — and what they are asking is what it said.
     * That is at the bottom of a thread that by then holds their question, a
     * plan and an answer, so the box opens there rather than at the top.
     */
    at = null,
    onclose = () => {},
  }: {
    openId?: string | null;
    anchor?: Anchor | null;
    linesOf?: ((comment: CommentView) => string[]) | null;
    at?: "agent" | null;
    onclose?: () => void;
  } = $props();

  /**
   * What a message's badge says.
   *
   * Only while it is not finished: a remark that has been answered has its
   * answer under it, and a tick saying so as well is a second way of stating
   * the same thing. Failure keeps its badge, because the reply an agent leaves
   * on a failure says what happened and not that it happened.
   */
  const TASK: Record<string, string> = {
    queued: "waiting",
    working: "working",
    asking: "asking you",
    failed: "failed",
    // The window went away mid-turn. The conversation is intact and the agent
    // still remembers it; answering here carries on from where it stopped.
    stopped: "stopped",
  };

  /**
   * The agent that owns this conversation, ready to draw.
   *
   * The claim itself is the host's answer, not one worked out here: the same
   * rule decides who the next message in this thread goes to, and a second
   * spelling of it would eventually have the thread naming one agent while the
   * work went to another.
   */
  const claimed = $derived.by(() => {
    if (!thread) return null;
    const who = ui.owners[String(thread.root.id)];
    if (!who) return null;
    const agent = (model.current.agents ?? []).find((one) => one.id === who);
    return {
      name: agent?.name ?? who,
      mark: markOf(who),
      working: ui.busyAgents.has(who),
    };
  });

  /**
   * Asks a question again, as a new remark rather than by rerunning the old.
   *
   * The thread is the record: a question asked twice was asked twice, and a
   * silent re-run would leave an answer sitting under a remark already marked
   * as having failed to get one.
   */
  function askAgain(root: CommentView): void {
    notify("askAgents", {
      path: root.path,
      line: root.line,
      ...(root.startLine !== undefined && root.startLine < root.line
        ? { startLine: root.startLine }
        : {}),
      side: root.side,
      body: root.body,
      inReplyTo: Number(root.id),
    });
  }

  const threads = $derived(threadsOf(model.current.comments ?? []));
  const thread = $derived(threads.find((one) => one.root.id === openId) ?? null);
  /**
   * A conversation about the change rather than about a line has no mark.
   *
   * Everything else here hangs off one: the box is placed beside the mark, and
   * a thread with no rectangle is a thread that cannot be positioned. A remark
   * with no file has no card, so no mark, so no rectangle — and it would have
   * been a conversation that exists, holds an agent's answers, and cannot be
   * opened anywhere. It stands at the edge instead, where an anchorless box
   * already goes.
   */
  const anchorless = $derived(thread !== null && !thread.root.path);
  const open = $derived(thread !== null && (anchor !== null || anchorless));

  /**
   * The conversation the reader was in, gone.
   *
   * A remark can be deleted from anywhere — another window, the forge itself —
   * and the next list from the host simply will not have it. The box that was
   * quoting it has nothing left to say.
   */
  $effect(() => {
    if (openId && !thread) onclose();
  });

  /* ------------------------------------------------- opening at the answer */

  let body = $state<HTMLElement | null>(null);

  /**
   * The last thing the agent said, brought into view.
   *
   * Keyed on the conversation and on how much of it there is, so it happens
   * again when the agent adds to a thread the reader opened this way — that is
   * the point of having opened it this way — and not on every unrelated update.
   *
   * Measured against the box rather than handed to `scrollIntoView`, which is
   * entitled to scroll every scrollable ancestor including the page: this box
   * floats over a canvas that is itself pannable, and the drawing sliding out
   * from under a thread is not what anybody asked for.
   */
  let shown = "";
  $effect(() => {
    if (!open || at !== "agent" || !body || !thread) {
      if (!open) shown = "";
      return;
    }
    const key = `${openId}:${thread.comments.length}`;
    if (shown === key) return;
    shown = key;

    const said = [...thread.comments].reverse().find((comment) => comment.agent);
    const box = body;
    const found = said
      ? box.querySelector<HTMLElement>(`[data-remark="${CSS.escape(String(said.id))}"]`)
      : null;
    if (!found) {
      // Nothing of the agent's yet, or the page has not drawn it. The end of
      // the conversation is still the newest thing in it.
      box.scrollTop = box.scrollHeight;
      return;
    }
    box.scrollTop += found.getBoundingClientRect().top - box.getBoundingClientRect().top - 6;
  });

  /* ------------------------------------------------------------- placement */

  let height = $state(0);

  /**
   * How far down the chrome reaches.
   *
   * Measured rather than assumed: the bar carries a pull request title that
   * wraps on a narrow window, and a constant sat the thread on top of it there.
   */
  let chromeBottom = $state(0);
  $effect(() => {
    const measure = () => {
      const bar = document.querySelector(".chrome");
      chromeBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  /*
   * The sums themselves are next door, in the module the camera reads too: the
   * flight that brings a reader to a remark has to leave this box its room
   * before it exists, and a width the panel decided on its own is a width the
   * camera would be making room for by hearsay.
   */
  const width = $derived(anchor ? widthOf(anchor.left) : WIDEST);
  const left = $derived(anchor ? leftOf(anchor.left, width) : EDGE);
  const top = $derived(
    anchor
      ? topOf(anchor.top, height, chromeBottom + EDGE, window.innerHeight)
      : chromeBottom + EDGE,
  );

  /**
   * How tall the box is allowed to be, which is the room there actually is.
   *
   * It used to be three fifths of the window, which is a guess that is wrong in
   * both directions: on a short window it reaches under the chrome, and on a
   * tall one it stops well short and leaves the conversation scrolling inside a
   * letterbox with empty space beneath it. What bounds this box is the same
   * thing that bounds where it may sit — the bottom of the chrome, the bottom
   * of the window, and the margin it keeps from both.
   *
   * Measured on resize with the chrome, because both answers change together
   * and a height that was right for the last window is a box hanging off the
   * bottom of this one.
   */
  let room = $state(0);
  $effect(() => {
    const measure = () => (room = window.innerHeight);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  const tallest = $derived(Math.max(220, room - chromeBottom - EDGE * 2));

  /* ----------------------------------------------------------- the answer */

  /** Rewriting a remark reuses the reply box, which is already the right shape. */
  let editing = $state<string | null>(null);
  let reply = $state("");

  const key = $derived(thread ? threadKey(thread.root.id) : "");

  // Loaded when the conversation changes, saved on every keystroke. The two are
  // separate effects so that filing what was typed does not also re-read it.
  $effect(() => {
    const which = key;
    editing = null;
    reply = which ? (load(model.current.review).unsent[which] ?? "") : "";
  });

  $effect(() => {
    const which = key;
    const text = reply;
    if (which && editing === null) remember(model.current.review, which, text);
  });

  function send(): void {
    const body = reply.trim();
    if (!body || !thread) return;

    if (editing !== null) {
      notify(local ? "editLocal" : "editComment", { id: editing, body });
      editing = null;
    } else if (local) {
      /*
       * A conversation the forge has never heard of.
       *
       * These threads are held on this machine and their remarks carry ids of
       * our own, which are not ids the forge can be asked about — sending one
       * to it produced "Parent comment not found", after the reader had
       * written the reply and pressed the button.
       *
       * And the answer is not merely "post it locally instead": a reply here is
       * the next thing said to the agent working in this thread, which is what
       * asking does. The message goes where the conversation is.
       */
      notify("askAgents", {
        path: thread.root.path,
        line: thread.root.line,
        ...(thread.root.startLine !== undefined && thread.root.startLine < thread.root.line
          ? { startLine: thread.root.startLine }
          : {}),
        side: thread.root.side,
        body,
        inReplyTo: thread.root.id,
      });
    } else {
      // Answering belongs to the thread, not to the line: a second remark
      // beside the first is how one conversation becomes two.
      notify("reply", { id: thread.root.id, body });
    }
    forget(model.current.review, key);
    reply = "";
  }

  /**
   * Whether this conversation is one the forge knows about.
   *
   * Read off the thread's root rather than off each remark: a thread is local
   * or it is not, and every remark in it follows. What hangs on it is which
   * side every action goes to — the forge refuses an id it never issued, and
   * says so only after the reader has written something.
   */
  const local = $derived(thread?.root.local === true);

  /* ------------------------------------------------- a remark's own actions */

  /**
   * Copying and quoting happen here, because they need nothing from the forge.
   * Editing and deleting are offered only on your own remarks — the forge would
   * refuse anybody else's, and a menu item that always fails is worse than one
   * that is not there.
   */
  let menu = $state<{ comment: CommentView; x: number; y: number } | null>(null);
  let picker = $state<{ comment: CommentView; x: number; y: number } | null>(null);

  function closeMenus(): void {
    menu = null;
    picker = null;
  }

  function openMenu(comment: CommentView, event: MouseEvent): void {
    event.stopPropagation();
    const at = (event.currentTarget as HTMLElement).getBoundingClientRect();
    picker = null;
    menu = { comment, x: at.right, y: at.bottom + 4 };
  }

  function openPicker(comment: CommentView, event: MouseEvent): void {
    event.stopPropagation();
    const at = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = null;
    picker = { comment, x: at.left, y: at.top - 40 };
  }

  function copy(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function quote(comment: CommentView): void {
    const quoted = (comment.body || "")
      .split("\n")
      .map((line) => "> " + line)
      .join("\n");
    reply = quoted + "\n\n";
  }

  function startEdit(comment: CommentView): void {
    editing = comment.id;
    reply = comment.body || "";
  }

  /* ------------------------------------------------------------- the rest */

  /** What a suggestion in a remark replaces, when the canvas can say. */
  function contextOf(comment: CommentView) {
    const node = model.current.nodes.find((one) => one.path === comment.path);
    return {
      before: linesOf ? linesOf(comment) : [],
      startLine: comment.startLine || comment.line,
      language: node?.language ?? "",
    };
  }

  let box = $state<HTMLElement | null>(null);
  let menuBox = $state<HTMLElement | null>(null);
  let pickerBox = $state<HTMLElement | null>(null);

  /**
   * Anywhere else puts it away.
   *
   * Asked as "did this land in the conversation" rather than answered by every
   * part of the conversation stopping its own clicks. A box that has to
   * remember to swallow clicks loses the one it forgets — and the menu and the
   * picker hang outside the box, so the box alone was never the whole question.
   * The mark that opened this is the parent's, and it stops its own click:
   * without that, opening a thread would be the click that closed it.
   */
  $effect(() => {
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (box?.contains(target)) {
        closeMenus();
        return;
      }
      if (menuBox?.contains(target) || pickerBox?.contains(target)) return;
      closeMenus();
      onclose();
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  });
</script>

{#snippet face(comment: CommentView, kind: string)}
  {#if faceOf(comment)}
    <img class={kind} src={faceOf(comment)} alt={comment.author} />
  {:else}
    <span class="{kind} initials">{initialsOf(comment.author)}</span>
  {/if}
{/snippet}

{#if open && thread}
  <div
    class="thread"
    style="left:{left}px;top:{top}px;width:{width}px;max-height:{tallest}px"
    bind:clientHeight={height}
    bind:this={box}
    role="dialog"
    aria-label="Conversation on {placeOf(thread.root)}"
    tabindex="-1"
  >
    <div class="thread-head">
      <span class="thread-where">{placeOf(thread.root)}</span>
      <!-- Whoever answered here first, and it does not change hands. An agent
           that replied has already started changing files, so a claim a faster
           second agent could take would be no claim at all. Naming somebody in
           a message still overrides it — the reader is the one authority above
           the agents. -->
      {#if claimed}
        <span class="claimed" title="{claimed.name} claimed this conversation. Follow-ups here go to it; name another agent to override.">
          <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
            <rect width="24" height="24" rx="12" fill={claimed.mark.color} />
            {#if claimed.mark.stroke}
              <path d={claimed.mark.path} fill="none" stroke={claimed.mark.ink} stroke-width="2" stroke-linecap="round" />
            {:else}
              <path d={claimed.mark.path} fill={claimed.mark.ink} />
            {/if}
          </svg>
          {claimed.name}
          {#if claimed.working}<span class="claimed-state">working</span>{/if}
        </span>
      {/if}
      <button class="thread-close" title="Close" aria-label="Close" onclick={onclose}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="thread-body" bind:this={body}>
      {#each thread.comments as comment (comment.id)}
        <div class="remark" data-remark={comment.id}>
          {@render face(comment, "face")}
          <div class="said">
            <div class="head">
              <span class="who">{comment.author || "?"}</span>
              <span class="when" title={exactly(comment.createdAt)}>{ago(comment.createdAt)}</span>
              {#if comment.outdated}<span class="outdated">outdated</span>{/if}
              <!-- Never sent anywhere. Said on every local remark rather than
                   only on the reader's own, because the thing worth knowing is
                   about the conversation: nobody else can see any of this, and
                   a thread where that is true of some messages and not others
                   is a thread nobody can reason about. -->
              {#if comment.local}
                <span class="only-here" title="On this machine only. The forge has not been told.">local</span>
              {/if}
              {#if comment.task && comment.task !== "done"}
                <span class="task {comment.task}">{TASK[comment.task]}</span>
              {/if}
              {#if host}
                <button
                  class="more-actions"
                  title="More actions"
                  aria-label="More actions"
                  onclick={(event) => openMenu(comment, event)}
                >···</button>
              {/if}
            </div>

            <!--
              A decision, where the conversation is.

              The buttons sit on the message that asks, so what was asked, what
              was decided and what the agent did next read in order. Once
              answered the buttons go and the answer stays: a thread that
              forgets what was allowed is not a record of anything.
            -->
            {#if comment.approval}
              <div class="approval {comment.approval.state}">
                {#if comment.approval.state === "waiting"}
                  <button
                    class="approve"
                    onclick={() => notify("answerApproval", { id: comment.approval?.id, allow: true })}
                  >Allow</button>
                  <button
                    class="refuse"
                    onclick={() => notify("answerApproval", { id: comment.approval?.id, allow: false })}
                  >Deny</button>
                  <span class="approval-why">once, for this action</span>
                {:else}
                  <span class="approval-said">
                    {comment.approval.state === "allowed" ? "You allowed this" : "You refused this"}
                  </span>
                {/if}
              </div>
            {/if}

            <div class="text">
              <!-- The body is a person's text from a forge, rendered by the
                   same box the reply is written in: it is parsed into elements
                   and printed as text, so nothing in it can become markup. -->
              <Editor readonly value={comment.body || ""} context={contextOf(comment)} />
            </div>

            <!--
              A turn that never finished, and the one thing to do about it.

              Here as well as in the terminal, because this is where the
              question is: a reader looking at a remark marked "stopped" is
              already looking at the thing they would retry, and sending them
              to a log to do it is a detour.

              Below the question rather than beside the name. In the head it
              sat in a row of labels — author, time, "local", "stopped" — which
              is a row that says what this remark is, and a thing you press is
              not one of those. It also pushed the labels around as it came and
              went. Under the text it is what it is: the question, then the one
              thing to do about it.
            -->
            {#if comment.local && !comment.agent
              && (comment.task === "stopped" || comment.task === "failed")}
              <div class="after">
                <button
                  class="again"
                  title="Ask again. The conversation is intact, so this carries on from where it stopped."
                  onclick={(event) => { event.stopPropagation(); askAgain(comment); }}
                >ask again</button>
              </div>
            {/if}

            <!-- Reactions are the forge's: they live on a comment it issued an
                 id for, and there is nowhere to put one on a remark it has
                 never seen. Offering the picker anyway would be a button that
                 always fails. -->
            <div class="reactions" class:none={local}>
              {#each reactionsOf(comment) as reaction}
                <button
                  class="pill"
                  title={reaction.content}
                  onclick={(event) => { event.stopPropagation(); notify("react", { id: comment.id, content: reaction.content }); }}
                >
                  <span class="emoji">{EMOJI[reaction.content] ?? "?"}</span>
                  <span class="n">{reaction.count}</span>
                </button>
              {/each}
              {#if host}
                <!-- Drawn rather than typed: the smiley character renders at
                     whatever size and weight the font feels like, which beside a
                     14-pixel emoji is a speck. -->
                <button class="add" title="Leave a reaction" onclick={(event) => openPicker(comment, event)}>
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4" />
                    <circle cx="5.8" cy="6.6" r="0.95" fill="currentColor" />
                    <circle cx="10.2" cy="6.6" r="0.95" fill="currentColor" />
                    <path d="M5.2 9.6a3.2 3.2 0 0 0 5.6 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                  </svg>
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>

    {#if host}
      <div class="thread-reply">
        <!-- Re-keyed on the conversation: a box carried from one thread to the
             next arrives holding the last one's half-written sentence. -->
        {#key thread.root.id}
          <Editor bind:value={reply} placeholder="Reply…" rows={3} context={contextOf(thread.root)} />
        {/key}
        <div class="reply-actions">
          <button class="reply-send primary" onclick={send}>{editing === null ? "Reply" : "Save"}</button>
        </div>
      </div>
    {/if}
  </div>

  {#if menu}
    <div class="menu" style="left:{Math.round(menu.x)}px;top:{Math.round(menu.y)}px" bind:this={menuBox} role="menu" tabindex="-1">
      <button onclick={() => { copy(menu?.comment.url || ""); closeMenus(); }}>Copy link</button>
      <button onclick={() => { copy(menu?.comment.body || ""); closeMenus(); }}>Copy Markdown</button>
      <button onclick={() => { if (menu) quote(menu.comment); closeMenus(); }}>Quote reply</button>
      {#if (local && !menu.comment.agent) || (model.current.viewer && menu.comment.author === model.current.viewer)}
        <span class="divider"></span>
        <button onclick={() => { if (menu) startEdit(menu.comment); closeMenus(); }}>Edit</button>
        <button class="danger" onclick={() => { notify(local ? "deleteLocal" : "deleteComment", { id: menu?.comment.id }); closeMenus(); }}>Delete</button>
      {/if}
    </div>
  {/if}

  {#if picker}
    <div class="picker" style="left:{Math.round(picker.x)}px;top:{Math.round(picker.y)}px" bind:this={pickerBox} role="menu" tabindex="-1">
      {#each Object.keys(EMOJI) as content}
        <button
          title={content}
          onclick={() => { notify("react", { id: picker?.comment.id, content }); closeMenus(); }}
        >{EMOJI[content]}</button>
      {/each}
    </div>
  {/if}
{/if}

<style>
  /*
    A remark is shown whole, however long it is.

    The renderer caps its box at a fraction of the viewport and scrolls inside
    it, which is one answer to a long comment — and the wrong one here. It puts
    a second scrollbar inside a panel that already scrolls, so a reader dragging
    down the thread stops dead in the middle of a remark and has to find the
    inner one. The thread is the thing that scrolls; a remark is as tall as it
    is.
  */
  .text :global(.rendered) {
    max-height: none;
    overflow: visible;
  }

  /* Its own line under the remark, left-aligned with the text it belongs to. */
  .after {
    margin: 4px 0 2px;
  }

  .again {
    padding: 2px 8px 2px 9px;
    border: 1px solid color-mix(in srgb, var(--text) 22%, transparent);
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 10px;
    /* Set like the labels above it — "local", "stopped" — because it belongs to
       the same row of small facts about this remark, and a lowercase pill among
       uppercase ones reads as a different kind of thing. The trailing pixel is
       the letter-spacing's gap after the last letter, which padding doubles. */
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
  }

  .again:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .approval {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 2px;
  }

  .approve,
  .refuse {
    padding: 2px 10px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--text) 22%, transparent);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  /* The allowing one is the coloured one, and it is the narrower claim: this
     action, once. Nothing here grants anything standing. */
  .approve {
    border-color: transparent;
    background: var(--action, #0a84ff);
    color: var(--action-ink, #fff);
  }

  .refuse:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }

  .approval-why,
  .approval-said {
    color: var(--muted);
    font-size: 10px;
  }

  /* Who is on this, in the one place that is about the conversation rather
     than about any message in it. */
  .claimed {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 1px 7px 1px 3px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--muted);
    font-size: 10px;
  }

  .claimed-state {
    color: var(--warning, #e2b341);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 9px;
    animation: claim-breathing 1.6s ease-in-out infinite;
  }

  @keyframes claim-breathing {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  /* The two marks a local conversation carries: that nobody else can see it,
     and what is being done about it. Both read as asides rather than as state
     to act on, which is what they are. */
  .only-here,
  .task {
    /* The head is `gap: 0` and every child carries its own leading space —
       the name, the time, the outdated pill. These two did not, so they sat
       hard against the time and against each other and read as one word. */
    margin-left: 6px;
    /* Room around the word. At `0 5px` the letters sat against the ends of the
       pill and it read as a highlight rather than a label. */
    padding: 1px 7px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .task.working {
    color: var(--warning, #e2b341);
    /* Breathing rather than spinning: there is nothing here to turn, and a
       thread with a spinner in it reads as a page that is still loading. */
    animation: task-breathing 1.6s ease-in-out infinite;
  }

  .task.failed { color: var(--removed, #f85149); }

  /* Not a failure and not a state to act on: something ended it from outside,
     and the next thing said in the thread picks it up. */
  .task.stopped { color: var(--muted); }

  .task.asking {
    color: var(--warning, #e2b341);
    animation: task-breathing 1.6s ease-in-out infinite;
  }

  @keyframes task-breathing {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  /* Fixed rather than placed on the canvas: prose at a tenth of its size is not
     readable, and a comment is not part of the drawing. */
  .thread {
    position: fixed;
    z-index: 41;
    /* The height is measured and set on the element: what bounds this box is
       the chrome above it and the edge of the window below, and a fraction of
       the viewport is a guess that is wrong in both directions. Kept here as
       the answer for a page rendered with no browser to measure in. */
    max-height: 60vh;
    /* A column, so the reply box stays put and the remarks scroll behind it. A
       long thread used to push the button that answers it off the bottom of the
       popover, which left the reader scrolling to reach the one control they
       opened the thread to use. */
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 10px 12px 12px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
    font-size: 12px;
  }

  .thread-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    color: var(--muted);
  }

  .thread-where {
    font-family: var(--mono);
  }

  .thread-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin: -4px -4px -4px 0;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .thread-close:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  .thread-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .thread-reply {
    flex: 0 0 auto;
    margin-top: 8px;
  }

  .remark {
    display: flex;
    gap: 8px;
    padding: 7px 0;
  }

  /* Everything after the opening remark is an answer to it, and sits under it:
     a flat list of four faces is four people talking, not a conversation. */
  .remark + .remark {
    border-top: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
    padding-left: 20px;
  }

  .face {
    width: 22px;
    height: 22px;
    flex: 0 0 auto;
    border-radius: 50%;
    object-fit: cover;
  }

  .face.initials {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--bg);
    background: var(--status-renamed);
  }

  .said {
    min-width: 0;
    flex: 1 1 auto;
  }

  .said .head {
    display: flex;
    align-items: baseline;
    gap: 0;
  }

  .who {
    color: var(--text);
    font-weight: 600;
  }

  .when {
    color: var(--muted);
    margin-left: 6px;
    font-size: 11px;
  }

  .outdated {
    margin-left: 6px;
    color: var(--warning);
    font-size: 10px;
    border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
    border-radius: 999px;
    padding: 0 6px;
  }

  .more-actions {
    margin-left: auto;
    padding: 0 4px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    line-height: 1;
    cursor: pointer;
  }

  .more-actions:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  .text {
    margin-top: 3px;
  }

  /* What was left on a remark, and the way to leave one. */
  .reactions.none { display: none; }

  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 6px;
  }

  .reactions .pill,
  .reactions .add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  /* Room for the face, and no more: it is one glyph, not a label. */
  .reactions .add {
    width: 34px;
    padding: 0;
  }

  .reactions .pill .emoji {
    font-size: 13px;
    line-height: 1;
  }

  .reactions .pill:hover,
  .reactions .add:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--status-renamed) 60%, transparent);
  }

  .reactions .pill .n {
    font-weight: 600;
  }

  .reply-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 8px;
  }

  .reply-send {
    font: inherit;
    border-radius: 5px;
    padding: 3px 10px;
    cursor: pointer;
    color: var(--action-ink);
    background: var(--action);
    border: 1px solid color-mix(in srgb, #000 22%, var(--action));
    font-weight: 600;
  }

  .reply-send:hover {
    filter: brightness(1.08);
  }

  /* Above the thread rather than inside it: a menu clipped by the box it opened
     from is a menu with its last item missing. */
  .menu,
  .picker {
    position: fixed;
    z-index: 43;
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 96%, var(--text) 4%);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 8px 24px color-mix(in srgb, #000 45%, transparent);
  }

  .menu {
    display: flex;
    flex-direction: column;
    min-width: 150px;
    padding: 4px;
    transform: translateX(-100%);
  }

  .menu button {
    padding: 5px 10px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .menu button:hover {
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  .menu button.danger {
    color: var(--removed);
  }

  .menu .divider {
    height: 1px;
    margin: 4px 2px;
    background: color-mix(in srgb, var(--text) 14%, transparent);
  }

  .picker {
    display: flex;
    gap: 2px;
    padding: 4px;
    border-radius: 999px;
  }

  .picker button {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }

  .picker button:hover {
    background: color-mix(in srgb, var(--text) 14%, transparent);
  }
</style>
