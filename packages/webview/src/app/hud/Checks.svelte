<!--
  What the forge made of the branch, as a panel rather than a dropdown.

  It used to hang off its own button in the bar, which meant it closed the
  moment the reader touched anything — and what a failing check is for is
  reading the code beside it. Docked, it stays while they go and look, and it is
  dismissed the way the reviewers and the comments are: a cross of its own, and
  a line in the settings that brings it back.

  Top left, under the chrome. The map has the bottom of that corner, and these
  two never meet: one is anchored to the top and the other to the bottom.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import Viewed from "../shared/Viewed.svelte";
  import { model, notify, settings, ui } from "../state.svelte.js";

  /**
   * The forge's verdicts, as the host sends them.
   *
   * Typed here because the view model calls this field `unknown`: it is passed
   * straight through from the git layer and the contract never gave it a shape.
   */
  interface Check {
    name: string;
    workflow?: string;
    state: "passed" | "failed" | "running" | "skipped";
    url?: string;
    elapsedMs?: number;
  }

  interface CheckSummary {
    checks: Check[];
    passed: number;
    failed: number;
    running: number;
    skipped: number;
    done: number;
    total: number;
  }

  let { chromeHeight = 0 }: { chromeHeight?: number } = $props();

  const summary = $derived(model.current.checks as CheckSummary | undefined);

  /** What the forge would say if asked to merge this now. */
  interface Merging {
    mergeable: string;
    state: string;
    canBypass: boolean;
    methods?: ("squash" | "merge" | "rebase")[];
  }

  const merging = $derived(model.current.merging as Merging | undefined);
  const pull = $derived(model.current.meta.pullRequest);
  /** Over already: nothing here can be done to a change that has landed. */
  const settled = $derived(pull?.state === "MERGED" || pull?.state === "CLOSED");

  /** The base has moved on, which is its own thing to fix and its own button. */
  const behind = $derived(merging?.state === "BEHIND");
  /** Requirements not met — approvals, or checks that have to pass. */
  const blocked = $derived(merging?.state === "BLOCKED");
  /** Conflicts, which no button here can settle. */
  const conflicted = $derived(merging?.mergeable === "CONFLICTING");

  /** Whether the plain merge is worth offering at all. */
  const mergeable = $derived(
    !!pull && !settled && !conflicted && merging !== undefined && !blocked,
  );

  /**
   * What is standing between this change and the base branch.
   *
   * Assembled from what the page already knows rather than asked for: the
   * forge's verdict on the reviews, the checks it has reported, and its own
   * word for the merge state. Branch protection would say this exactly, and
   * reading it needs a permission most accounts on a repository do not have —
   * so the answer is put together from the three things everybody can see,
   * which between them cover what actually blocks a merge.
   *
   * Named rather than counted. "Waiting on requirements" is true and useless;
   * what a reader wants is which requirement, and whether it is theirs to fix.
   */
  const missing = $derived.by(() => {
    const why: string[] = [];
    if (!merging) return why;

    if (merging.mergeable === "CONFLICTING") {
      why.push(`Conflicts with ${model.current.meta.baseRef} that have to be resolved first.`);
    }
    if (merging.state === "BEHIND") {
      why.push(`Out of date with ${model.current.meta.baseRef}, which this repository requires.`);
    }

    const decision = pull?.reviewDecision;
    if (decision === "REVIEW_REQUIRED") {
      why.push("Waiting on approvals from the reviewers this repository requires.");
    } else if (decision === "CHANGES_REQUESTED") {
      const who = (pull?.reviewers ?? [])
        .filter((r) => r.state === "CHANGES_REQUESTED")
        .map((r) => r.login);
      why.push(
        who.length
          ? `Changes requested by ${who.join(", ")}.`
          : "Changes requested, and not yet resolved.",
      );
    }

    // The checks by name, because "a check is failing" sends a reader to the
    // forge to find out which one.
    const failing = ordered.filter((c) => c.state === "failed").map((c) => c.name);
    if (failing.length) {
      why.push(`Failing: ${[...new Set(failing)].join(", ")}.`);
    }
    const running = ordered.filter((c) => c.state === "running").map((c) => c.name);
    if (running.length) {
      why.push(`Still running: ${[...new Set(running)].join(", ")}.`);
    }

    if (why.length === 0 && blocked) {
      // The forge says blocked and none of the usual reasons applies — a rule
      // this page cannot see, which is worth saying plainly rather than
      // guessing at.
      why.push("The forge is holding this back for a rule Odin cannot see.");
    }
    return why;
  });

  /** The same, as one string a tooltip can carry. */
  const whyBlocked = $derived(
    missing.length
      ? `Cannot merge yet:\n• ${missing.join("\n• ")}`
      : "",
  );

  /**
   * Going past rules that have not been met.
   *
   * Offered only to an account the forge would actually allow it for, and only
   * when something is in fact blocking — otherwise it is a frightening button
   * that does nothing different from the one beside it.
   */
  const bypassable = $derived(
    !!pull && !settled && !conflicted && blocked && merging?.canBypass === true,
  );

  /**
   * How this repository allows a change to be landed.
   *
   * Read from the repository rather than assumed: plenty allow only a squash,
   * and offering a rebase there is a button that fails after it has been
   * pressed. Squash when nothing could be read, which is the forge's own
   * default and the commonest setting by a distance.
   */
  const methods = $derived(
    merging?.methods?.length ? merging.methods : (["squash"] as const),
  );

  const NAMED = {
    squash: "Squash and merge",
    merge: "Create a merge commit",
    rebase: "Rebase and merge",
  } as const;

  /** The one the button does; the rest live in the menu beside it. */
  let chosen = $state<"squash" | "merge" | "rebase" | null>(null);
  const method = $derived(
    chosen && methods.includes(chosen) ? chosen : methods[0]!,
  );

  /**
   * Whether the reader has said they mean to go past the rules.
   *
   * A checkbox and then a button, rather than one red button. Merging a change
   * whose requirements are not met is the most consequential thing this tool
   * can be asked to do, and a single control — however alarming its colour —
   * is one stray click. Two deliberate acts is the shape the forge itself uses
   * here, and for the same reason.
   *
   * Cleared whenever the forge says something new: a tick left standing across
   * a refresh is consent to something the reader has not looked at since.
   */
  let bypassing = $state(false);
  $effect(() => {
    void ui.checksAt;
    untrack(() => (bypassing = false));
  });

  /** Whether the update or the method menu is open. */
  let updating = $state(false);
  let updateMenu: HTMLElement | undefined = $state();
  let picking = $state(false);
  let methodMenu: HTMLElement | undefined = $state();

  function elsewhere(event: MouseEvent) {
    const at = event.target as Node;
    if (updating && !updateMenu?.contains(at)) updating = false;
    if (picking && !methodMenu?.contains(at)) picking = false;
  }

  /** The host confirms both of these; nothing here happens on one press. */
  function update(rebase: boolean) {
    updating = false;
    notify("updateBranch", { rebase });
  }

  function merge(admin: boolean) {
    picking = false;
    notify("mergePullRequest", { method, ...(admin ? { admin: true } : {}) });
  }

  /** Folded to its head, keeping the tally and giving the canvas the rest. */
  const folded = $derived(settings.hud.checksFolded);

  /**
   * How the branch stands as a whole, in one word.
   *
   * Failure first, even while other runs are still going. A branch with a
   * broken check is broken whatever the rest of the board does, and waiting for
   * the last job to finish before saying so is exactly the delay that gets a
   * failing branch merged. Amber only while there is still something to wait
   * for, green when everything that ran passed.
   *
   * Folded, the tally is the only thing left saying any of this — which is the
   * state this colour matters most in.
   */
  const verdict = $derived(
    !summary ? "none"
      : summary.failed > 0 ? "failed"
      : summary.running > 0 ? "running"
      : summary.passed > 0 ? "passed"
      : "none",
  );

  // Failures first, when a check is first seen. A list in the forge's own order
  // buries the one row the reader opened this for under the nine that passed.
  const RANK: Record<string, number> = { failed: 0, running: 1, passed: 2, skipped: 3 };

  /** What a check is called across refreshes; two jobs can share a name. */
  const nameOf = (check: Check) => `${check.name}\u0000${check.workflow ?? ""}`;

  /**
   * Where each check sits, decided once and then left alone.
   *
   * Sorting by state on every answer means a row moves whenever it changes —
   * and changing state is exactly when the reader is watching it. A rerun would
   * take the row out from under the cursor that just pressed it, and the two
   * jobs a reader is comparing swap places while they compare them.
   *
   * So the ranking decides where a check goes the first time it appears, and
   * nothing moves it after that. Deliberately not reactive state: it is a
   * memory of what has already been drawn, not something to redraw when it
   * changes, and making it reactive would mean writing to it while deriving
   * from it.
   */
  const placed = new Map<string, number>();

  const ordered = $derived.by(() => {
    const checks = summary?.checks ?? [];

    // Ones never seen before take their places now, ranked among themselves —
    // a check that appears mid-run joins the list rather than reshuffling it.
    const fresh = checks
      .filter((check) => !placed.has(nameOf(check)))
      .sort(
        (a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || a.name.localeCompare(b.name),
      );
    for (const check of fresh) placed.set(nameOf(check), placed.size);

    return [...checks].sort(
      (a, b) => (placed.get(nameOf(a)) ?? 0) - (placed.get(nameOf(b)) ?? 0),
    );
  });

  /**
   * Runs asked to start again, against the answer count at the time of asking.
   *
   * The forge takes a few seconds to admit a rerun has begun, and until it does
   * the row still reads "failed" — pressing again in that gap queues a second
   * run for nothing. Keyed by url, which is what identifies the run; the number
   * is how many answers the forge had given when it was asked, so the row knows
   * when it has been told something new.
   */
  let asked = $state(new Map<string, number>());

  /** Whether this row is waiting on a rerun it asked for. */
  function waiting(check: Check): boolean {
    const at = asked.get(check.url ?? "");
    return at !== undefined && ui.checksAt <= at;
  }

  /**
   * Whether this check is one we could start again.
   *
   * Only Actions runs. Plenty of things report a verdict — a coverage service,
   * a deploy preview, a bot — and offering to restart something that is not
   * ours to restart is a button that fails for reasons the reader cannot see.
   */
  function restartable(check: Check): boolean {
    return /\/actions\/runs\/\d+/.test(check.url ?? "");
  }

  /**
   * How many answers the forge had given when this was last asked.
   *
   * The waiting is derived from that rather than held as a flag, and the
   * difference matters: a flag has to be cleared by something watching for the
   * answer, and an effect that both reads and writes it re-runs the moment it
   * writes — so setting it true was itself the reason it went straight back to
   * false, and the control never turned for a single frame.
   *
   * `-1` is "not waiting on anything", which is where it starts and where the
   * ceiling puts it back.
   */
  let askedAt = $state(-1);

  /**
   * Turning while the forge has not answered since it was asked.
   *
   * Counted rather than compared: a refresh that comes back saying exactly what
   * it said before is still an answer, and an unchanged summary is
   * indistinguishable from no summary at all.
   */
  const asking = $derived(askedAt >= 0 && ui.checksAt <= askedAt);

  /**
   * A ceiling, because silence is a possible answer.
   *
   * No `gh`, no network, no pull request: the host reads nothing and sends
   * nothing, by design — every path to the forge here is best-effort. A control
   * left turning forever on that is a worse lie than one that stops having
   * achieved nothing.
   */
  let ceiling: ReturnType<typeof setTimeout> | undefined;

  /**
   * The whole list again.
   *
   * Also forgets which reruns are outstanding: the answer that comes back is
   * the forge's own, and a row it now calls running has plainly started. Rows
   * that are still failing become pressable again, which is the right offer —
   * a rerun the forge never took is one worth asking for twice.
   */
  function refresh(): void {
    asked = new Map();
    askedAt = ui.checksAt;
    clearTimeout(ceiling);
    ceiling = setTimeout(() => (askedAt = -1), 12_000);
    notify("refreshChecks");
  }

  function rerun(check: Check): void {
    if (!check.url || waiting(check)) return;
    asked = new Map(asked).set(check.url, ui.checksAt);
    notify("rerunCheck", { url: check.url, name: check.name });
  }

  /** How long a check ran, in the coarsest unit that still says something. */
  function elapsed(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  const VERDICT: Record<string, string> = {
    passed: "✓",
    failed: "✕",
    running: "●",
    skipped: "–",
  };
</script>

<svelte:window onclick={elsewhere} />

<!-- Nothing ran, or no forge answered: no panel rather than a panel of
     nothing. -->
{#if settings.hud.checks && summary && summary.total > 0}
  <div class="checks-panel" style="top:{chromeHeight + 14}px">
    <div class="checks-head">
      Checks
      <span class="checks-count {verdict}">{summary.done}/{summary.total}</span>
      <!-- The whole panel, on request. It used to ask the forge every five
           seconds for as long as the panel existed, which is a request every
           five seconds whether or not anybody is looking — for hours, on a
           review left open over lunch, against a rate limit shared with
           everything else here. What that bought was a tally that moved on its
           own, and a reader who wants to know whether CI has finished asks. -->
      <button
        class="hud-close"
        class:asking
        disabled={asking}
        title={asking ? "Asking the forge…" : "Ask the forge how the branch stands now"}
        aria-label="Refresh the checks"
        onclick={refresh}
      >
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M13.2 1.9v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <!-- Folded, not hidden. A reader who has read the list still wants the
           tally — how far the forge has got is the thing they came back for —
           and hiding the panel outright takes that away too. Folding leaves the
           one line that answers it and gives the canvas the rest. -->
      <button
        class="hud-close"
        title={folded ? "Show the checks" : "Fold the checks away"}
        aria-label={folded ? "Show the checks" : "Fold the checks away"}
        aria-expanded={!folded}
        onclick={() => (settings.hud.checksFolded = !folded)}
      >
        {#if folded}
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
            <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        {:else}
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
            <path d="M4 10h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
        {/if}
      </button>
      <button
        class="hud-close"
        title="Hide the checks"
        aria-label="Hide the checks"
        onclick={() => (settings.hud.checks = false)}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    {#if !folded}
    {#each ordered as check (check.name + (check.workflow ?? ""))}
      <div class="check-row {check.state}">
        <!-- First in the row, where the reader's eye already is: the verdict
             says what happened and this is the one thing to do about it. Only
             on a run that failed — restarting one that passed is somebody
             else's queue time for nothing. -->
        {#if check.state === "failed" && restartable(check)}
          <button
            class="rerun"
            class:asking={waiting(check)}
            title={waiting(check) ? "Asked the forge to run this again" : "Run this check again"}
            aria-label="Run {check.name} again"
            disabled={waiting(check)}
            onclick={() => rerun(check)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <path d="M13.2 1.9v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        {:else}
          <span class="verdict">{VERDICT[check.state] ?? ""}</span>
        {/if}

        <!-- Two lines: what ran, and where it ran from. The job's name is the
             thing being looked for; the workflow is how to find it again on the
             forge. A run with a page there is a link; one without is not drawn
             as though it could be opened. -->
        <svelte:element
          this={check.url ? "a" : "span"}
          class="about"
          href={check.url}
          target={check.url ? "_blank" : undefined}
          rel={check.url ? "noreferrer" : undefined}
          title={check.url ? "Open this run on the forge" : undefined}
        >
          <span class="name">{check.name}</span>
          {#if check.workflow}<span class="flow">{check.workflow}</span>{/if}
        </svelte:element>

        {#if check.elapsedMs !== undefined}
          <span class="took">{elapsed(check.elapsedMs)}</span>
        {/if}
      </div>
    {/each}

    <!-- What can be done about the change, under what the forge made of it.
         The same two questions the forge's own page asks in this order: is it
         up to date with what it is merging into, and may it go in. -->
    {#if pull && !settled && merging}
      <div class="merge-actions">
        {#if conflicted}
          <span class="merge-why">Conflicts with {model.current.meta.baseRef}.</span>
        {:else if behind}
          <span class="merge-menu" bind:this={updateMenu}>
            <button class="merge-do" onclick={() => update(false)}>Update branch</button>
            <button
              class="merge-more"
              title="Choose how to bring the base in"
              aria-label="Choose how to update"
              onclick={() => (updating = !updating)}
            >
              <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
                <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            {#if updating}
              <span class="merge-list">
                <button class="merge-item" onclick={() => update(false)}>
                  Update with merge commit
                  <span class="why">The merge commit will be yours.</span>
                </button>
                <button class="merge-item" onclick={() => update(true)}>
                  Update with rebase
                  <span class="why">Replayed on the latest base, then force-pushed.</span>
                </button>
              </span>
            {/if}
          </span>
        {/if}

        {#if mergeable}
          <span class="merge-menu go" bind:this={methodMenu}>
            <button class="merge-do go" onclick={() => merge(false)}>{NAMED[method]}</button>
            <!-- Only when there is a choice to make. A repository that allows
                 one way of landing a change has no menu; a caret over a list of
                 one is a control that teaches nothing. -->
            {#if methods.length > 1}
              <button
                class="merge-more go"
                title="Choose how to land this change"
                aria-label="Choose how to merge"
                onclick={() => (picking = !picking)}
              >
                <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
                  <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              {#if picking}
                <span class="merge-list right">
                  {#each methods as how (how)}
                    <button
                      class="merge-item"
                      onclick={() => { chosen = how; picking = false; }}
                    >{NAMED[how]}</button>
                  {/each}
                </span>
              {/if}
            {/if}
          </span>
        {:else if bypassable}
          <!-- A tick, and then a button. Merging a change whose requirements
               are not met is the most consequential thing this tool can be
               asked to do, and one red button — however alarming — is one
               stray click away from doing it. -->
          <!-- The warning lives here, in words, rather than in the colour of
               the button below. -->
          <label class="bypass-say" title={whyBlocked}>
            <Viewed bind:checked={bypassing} label="" />
            <span>Merge without waiting for requirements</span>
          </label>
          <button
            class="merge-do bypass"
            disabled={!bypassing}
            title={bypassing
              ? `Merge past these:\n• ${missing.join("\n• ")}`
              : `${whyBlocked}\n\nTick the box to merge anyway.`}
            onclick={() => merge(true)}
          >{NAMED[method]}</button>
        {:else if blocked}
          <span class="merge-why" title={whyBlocked}>Waiting on requirements.</span>
        {/if}
      </div>
    {/if}
    {/if}
  </div>
{/if}

<style>
  .checks-panel {
    position: fixed;
    /* One edge, said explicitly. A fixed element given both a left and a right
       is stretched between them rather than positioned twice. */
    left: 12px;
    right: auto;
    z-index: var(--z-hud, 25);
    width: 260px;
    max-height: 52vh;
    overflow-y: auto;
    padding: 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    font-size: 11px;
  }

  .checks-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px 6px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 10px;
  }

  .checks-count {
    margin-left: auto;
    letter-spacing: 0;
    /* The same three colours the rows use, for the same three meanings: one
       number saying what a reader would otherwise have to read six rows to
       work out. */
    font-variant-numeric: tabular-nums;
  }

  .checks-count.failed { color: var(--removed, #f85149); }
  .checks-count.running { color: var(--warning, #e2b341); }
  .checks-count.passed { color: var(--added, #3fb950); }

  .hud-close {
    display: inline-flex;
    padding: 2px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .hud-close:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  /* Turning while the forge is being waited on. On the glyph rather than the
     button, so the hit area and the hover fill stay where they were — a target
     that rotates under the cursor is a target that moves while being pressed. */
  .hud-close.asking svg {
    animation: turning 0.9s linear infinite;
  }

  .hud-close.asking {
    color: var(--text);
    cursor: default;
  }

  @keyframes turning {
    to { transform: rotate(360deg); }
  }

  .check-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 2px;
    border-radius: 4px;
    color: var(--text);
    text-decoration: none;
  }

  a.about {
    color: inherit;
    text-decoration: none;
  }

  /* The whole row opens the run, not just the words.
     A row is one thing — a check, and where to go and look at it — so the time
     it took and the space beside it lead to the same place the name does. The
     link keeps its own box for the text and lays a cover over the row for the
     press, which is what makes the target the row without nesting anything
     pressable inside anything else pressable. */
  a.about::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }

  /* Above the cover, so the one control that is not "go and look" still is. */
  .rerun {
    position: relative;
    z-index: 1;
  }

  .check-row:hover {
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }

  /* The same width as the verdict it replaces, so a row with a button in it
     does not step sideways from the rows above and below. */
  .verdict,
  .rerun {
    flex: 0 0 auto;
    width: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Red, because it stands where the verdict stood.
     The button takes the place of the ✕ on a failed row, and a row whose
     leading mark is the same grey as every other row no longer says at a glance
     that it failed — which is the whole reason the list is sorted the way it
     is. It is the action and the verdict at once. */
  .rerun {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--removed, #f85149);
    cursor: pointer;
  }

  .rerun:hover:not(:disabled) {
    color: var(--text);
  }

  .rerun:disabled {
    cursor: default;
  }

  /* Turning while the forge has not answered since this row asked. The same
     motion the panel's own refresh uses, because it is the same wait: something
     was asked for and nothing has come back yet. It keeps its colour rather
     than dimming — the row still says "failed", and a mark that fades while it
     works reads as one that has given up. */
  .rerun.asking svg {
    animation: turning 0.9s linear infinite;
  }

  .about {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }

  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .flow {
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .took {
    margin-left: auto;
    flex: 0 0 auto;
    color: var(--muted);
  }

  /* Under the rows and set apart from them, because these do something to the
     change rather than describe it. */
  .merge-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
    padding-top: 7px;
    border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  }

  .merge-why {
    color: var(--muted);
    font-size: 10px;
  }

  .merge-menu {
    position: relative;
    display: inline-flex;
  }

  .merge-menu.go {
    margin-left: auto;
  }

  .merge-menu.go .merge-do {
    margin-left: 0;
  }

  .merge-more.go {
    background: var(--action);
    border-color: transparent;
    color: #fff;
  }

  .merge-do {
    padding: 4px 9px;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .merge-do:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  /* The one that lands the change, in the colour everything else that commits
     to something uses. */
  .merge-do.go {
    margin-left: auto;
    background: var(--action);
    border-color: transparent;
    color: #fff;
  }

  /* And the one that goes past the rules, which is not that colour on purpose:
     it is the forge's warning red, so it can never be pressed by habit. */
  /* Under the tick it belongs to, at the same edge. Pushed to the right it read
     as the panel's main action rather than as the second half of one decision,
     which is the opposite of what a gated control should say.

     The same green as every other button that commits to something, and not
     red: the tick above it is what says this is the dangerous one, and the
     button only exists in a pressable state once that has been said. A red
     control that is disabled most of the time teaches a reader to read past the
     colour, which is the one thing it is there to do. */
  .merge-do.bypass {
    margin-right: auto;
    background: var(--action);
    border-color: transparent;
    color: #fff;
  }

  /* Plainly not pressable until the box is ticked. Dimmed rather than hidden,
     because what is on offer — and what it will cost — is the thing the reader
     is deciding about. */
  .merge-do:disabled {
    background: color-mix(in srgb, var(--text) 12%, transparent);
    color: var(--muted);
    opacity: 1;
    cursor: default;
  }

  /* The whole line is the label, so the words are as much a target as the box. */
  .bypass-say {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 100%;
    color: var(--removed, #f85149);
    font-size: 11px;
    cursor: pointer;
  }

  .merge-more {
    display: inline-flex;
    align-items: center;
    padding: 0 5px;
    margin-left: -1px;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-radius: 0 4px 4px 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .merge-do:first-child {
    border-radius: 4px 0 0 4px;
  }

  .merge-list.right {
    left: auto;
    right: 0;
  }

  .merge-list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    width: 230px;
    padding: 4px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg) 96%, var(--text) 4%);
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  }

  .merge-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 7px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .merge-item:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .merge-item .why {
    color: var(--muted);
    font-size: 10px;
  }

  .failed .verdict { color: var(--removed, #f85149); }
  .passed .verdict { color: var(--added, #3fb950); }
  /* Amber, as the forge draws a run still going. Grey is what this page uses
     for things that are merely quiet — a skipped check, a workflow name — and a
     run that is still working is the opposite of quiet: it is the reason
     somebody opened this panel. */
  .running .verdict { color: var(--warning, #e2b341); }
  .skipped .verdict { color: var(--muted); }
</style>
