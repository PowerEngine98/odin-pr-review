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

  .failed .verdict { color: var(--removed, #f85149); }
  .passed .verdict { color: var(--added, #3fb950); }
  /* Amber, as the forge draws a run still going. Grey is what this page uses
     for things that are merely quiet — a skipped check, a workflow name — and a
     run that is still working is the opposite of quiet: it is the reason
     somebody opened this panel. */
  .running .verdict { color: var(--warning, #e2b341); }
  .skipped .verdict { color: var(--muted); }
</style>
