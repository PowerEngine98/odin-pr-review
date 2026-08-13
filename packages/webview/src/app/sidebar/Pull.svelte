<!--
  One pull request in the chooser.

  Pressing it means the obvious thing when there is one reading of the change:
  go there. With two — because this machine has commits or edits the forge has
  not seen — the press cannot mean either without guessing, so it opens the row
  and lets the reader say. Checking out is still reachable from the row it
  belongs to; it is simply no longer what happens when the answer is ambiguous.
-->
<script lang="ts">
  import Chevron from "./Chevron.svelte";
  import type { PullView } from "./model.js";
  import { notify } from "./state.svelte.js";

  let { pull }: { pull: PullView } = $props();

  let open = $state(false);

  const pr = $derived(pull.pr);

  /** `APPROVED` and friends, said the way a reader would say them. */
  const DECISION: Record<string, { label: string; tone: string }> = {
    APPROVED: { label: "approved", tone: "ok" },
    CHANGES_REQUESTED: { label: "changes requested", tone: "warn" },
    REVIEW_REQUIRED: { label: "review required", tone: "muted" },
  };
  const decision = $derived(pr.reviewDecision ? DECISION[pr.reviewDecision] : undefined);

  const drifted = $derived(pull.local !== undefined);

  /**
   * How the local copy differs, said in as few words as fit a row.
   *
   * Commits first: they are the part that survives, and the part the forge
   * could have if it were pushed. Uncommitted work is second and phrased as
   * files rather than changes, because that is the unit the reader will
   * recognise when they go looking for it.
   */
  const drift = $derived.by(() => {
    const local = pull.local;
    if (!local) return "";
    const parts: string[] = [];
    if (local.ahead > 0) parts.push(`${local.ahead} commit${local.ahead === 1 ? "" : "s"}`);
    if (local.uncommitted > 0) parts.push(`${local.uncommitted} uncommitted`);
    return parts.join(", ");
  });

  const sha = $derived(pr.headSha ? pr.headSha.slice(0, 7) : "");
  const initial = $derived((pr.author || "?").slice(0, 1).toUpperCase());

  function press(event: MouseEvent): void {
    const choice = (event.target as Element | null)?.closest("[data-where]");
    if (choice) {
      notify("read", {
        number: pr.number,
        where: choice.getAttribute("data-where"),
      });
      return;
    }
    if (drifted) {
      open = !open;
      return;
    }
    notify("checkout", { number: pr.number });
  }
</script>

<div
  class="pull"
  class:current={pull.current}
  class:drifted
  class:open
  title={pr.branch}
  role="button"
  tabindex="0"
  onclick={press}
  onkeydown={(event) => {
    if (event.key !== "Enter") return;
    if (drifted) open = !open;
    else notify("checkout", { number: pr.number });
  }}
>
  <div class="line">
    <!-- The fold on the row rather than beside it: a change with work of its own
         on top is not a different kind of thing in the list, it is the same row
         with a question attached. -->
    {#if drifted}<Chevron {open} size={14} />{/if}
    <span class="num">#{pr.number}</span>
    <span class="title">{pr.title}</span>
  </div>

  <!--
    Wraps, unlike the title line above it.

    A change can be open, have changes requested, have been pushed to since this
    reader last looked, and have work of its own sitting here — four pills on a
    bar a few words wide. Held to one line the overflow fell off the right edge
    rather than being clipped, so the last pill was simply not there.
  -->
  <div class="line meta">
    {#if pr.state === "merged"}
      <span class="tag merged">merged</span>
    {:else if pr.state === "closed"}
      <span class="tag closed">closed</span>
    {:else if pr.draft}
      <span class="tag draft">draft</span>
    {:else}
      <span class="tag open">open</span>
    {/if}
    {#if decision}<span class="tag {decision.tone}">{decision.label}</span>{/if}
    <!-- Pushed to since this reviewer last opened it. The forge goes on showing
         the verdict they left on a commit that is no longer the head, and this
         is the only thing in the list that says so. -->
    {#if pull.moved}<span class="tag fresh">new commits</span>{/if}
    <!-- What this machine has that the forge does not. Said on the row itself
         rather than only inside the fold, so a reader scrolling past can see
         which changes they have work sitting on without opening anything. -->
    {#if drifted && drift}
      <span class="tag local" title="This branch has work the forge does not have">
        {drift}
      </span>
    {/if}
  </div>

  <!--
    Who and when, on a line of their own.

    Not a wrap that happens once there are enough pills: a row that keeps its
    author beside the tags until a fourth tag arrives and then moves it is a
    list whose shape depends on how much has happened to each change, and
    nothing lines up down the column. A break that is always there can be read
    down.
  -->
  <div class="line who">
    <!-- A face is recognised before a name is read, and the question this list
         answers most often is "whose is this". Inlined by the host, because a
         webview will not fetch a remote image; a login with no picture keeps
         its initial, which is still faster to scan than a word. -->
    {#if pr.avatarUrl}
      <img class="face" src={pr.avatarUrl} alt={pr.author || "?"} />
    {:else}
      <span class="face letter">{initial}</span>
    {/if}
    <span class="author">{pr.author}</span>
    <!-- When it last moved, not when it was opened: the list is ordered by
         activity, and a column that disagreed with the order would read as a
         sorting bug. -->
    <span class="when" title="opened {pull.opened}">{pull.when}</span>
  </div>

  <!--
    The two readings of a diverged change, indented under the one that names it
    and marked down the edge, so they read as belonging to the row above rather
    than as two more pull requests. The forge's reading is listed second and
    described by its commit, so that picking it is a deliberate act rather than
    the thing that happens when you aim badly.
  -->
  {#if drifted && pull.local}
    <div class="pull-body">
      <!--
        The old renderer hung a warning off this title for uncommitted work
        living in some other checkout, and it could never appear: uncommitted
        files are only ever counted for a branch that some working tree holds,
        so the "has edits but no tree to keep them in" it was guarded by was
        never true. Left out rather than carried across as a condition nobody
        can reach. Saying which tree the work is in would mean the host telling
        this list which one it is reading from, and it does not.
      -->
      <div
        class="choice"
        data-where="local"
        title="Review this branch as it is on this machine"
      >
        <span class="where">Local</span>
        <span class="detail">{drift || "as it is here"}</span>
      </div>
      <div
        class="choice"
        data-where="origin"
        title="Review the pull request as the forge has it, without changing this checkout"
      >
        <span class="where">Origin</span>
        <span class="detail">{sha ? `at ${sha}` : "as pushed"}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .pull {
    padding: 5px 8px 5px 10px;
    border-left: 3px solid transparent;
    cursor: pointer;
    border-radius: 2px;
  }
  .pull:hover { background: var(--vscode-list-hoverBackground); }
  /* The branch that is checked out, marked down the edge rather than by colour
     alone, so it survives being scrolled past at a glance. */
  .pull.current {
    border-left-color: var(--vscode-button-background, #0a84ff);
    background: var(--vscode-list-inactiveSelectionBackground);
  }

  .line { display: flex; align-items: baseline; gap: 6px; }
  .num { color: var(--muted); flex: 0 0 auto; }
  /* Baseline-aligned like everything else on the line would put the chevron a
     pixel below its neighbours, so it is centred against them instead. */
  .pull :global(.twisty) {
    align-self: center;
    margin-left: -4px;
  }

  .pull-body { display: none; margin: 4px 0 2px 14px; }
  .pull.open .pull-body { display: block; }

  .choice {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 3px 8px;
    border-left: 2px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
    cursor: pointer;
    font-size: 0.9em;
  }
  .choice:hover {
    background: var(--vscode-list-hoverBackground);
    border-left-color: var(--vscode-button-background, #0a84ff);
  }
  .choice .where { flex: 0 0 auto; }
  .choice .detail {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta, .who {
    margin-top: 2px;
    font-size: 0.85em;
    color: var(--muted);
  }
  /* Further from the pills than they are from the title. The pills belong to
     the change named above them; who wrote it and when is a second fact about
     the same row, and without the gap the three lines read as one block of
     small grey text with no shape to it. */
  .who { margin-top: 5px; }
  .meta { flex-wrap: wrap; row-gap: 3px; }
  /* The name still has to fit the bar on its own once it has wrapped onto a
     line of its own, and some logins are longer than the sidebar is wide. */
  .author {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .when { white-space: nowrap; }

  .tag {
    flex: 0 0 auto;
    /* A pill wider than the bar is the one thing wrapping cannot rescue: it has
       no break in it to wrap at. Clipped rather than allowed to hang over the
       edge, which is what "changes requested" did in a narrow sidebar. */
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0 6px;
    font-size: 0.9em;
  }
  .tag.open { color: var(--status-added); }
  /* Pushed to since this reader last opened it. Filled rather than outlined
     like the others: it is the one thing in the row that is news. */
  .tag.fresh {
    color: var(--vscode-editor-background);
    background: var(--warning);
    border-color: var(--warning);
    font-weight: 600;
  }
  .tag.draft { color: var(--muted); }
  .tag.ok { color: var(--status-added); }
  .tag.warn { color: var(--warning); }
  .tag.muted { color: var(--muted); }
  .tag.merged { color: var(--merged); }
  .tag.closed { color: var(--status-deleted); }
  /* Work this machine has and the forge does not. Modified's colour rather than
     added's: nothing has been contributed yet, the two copies simply disagree. */
  .tag.local { color: var(--status-modified); }

  .face {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    object-fit: cover;
    margin-right: -2px;
  }
  .face.letter {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75em;
    font-weight: 700;
    color: var(--muted);
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
</style>
