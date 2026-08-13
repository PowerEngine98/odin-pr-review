<!--
  What the forge made of the branch, in the bar and in a list under it.

  The tally counts what has finished against what exists, and the ring fills
  with the same fraction: a number says how many, a ring says how far, and
  somebody waiting on CI is asking the second question. The colour answers the
  one they will ask after that — green while nothing has failed, red the moment
  something has.
-->
<script lang="ts">
  import { model } from "../state.svelte.js";
  import { CHECK_RING } from "./icons.js";

  /**
   * The forge's verdicts, as the host sends them.
   *
   * Typed here because the view model calls this field `unknown`: it is passed
   * straight through from the git layer and the contract never gave it a shape.
   * Reading it as `unknown` and casting once is at least honest about which end
   * knows what.
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

  const VERDICT: Record<string, string> = {
    passed: "✓",
    failed: "✕",
    running: "●",
    skipped: "–",
  };

  const summary = $derived(model.current.checks as CheckSummary | undefined);

  // Failures first. A list in the forge's order buries the one row the reader
  // opened this for under the nine that passed.
  const RANK: Record<string, number> = { failed: 0, running: 1, passed: 2, skipped: 3 };
  const ordered = $derived(
    [...(summary?.checks ?? [])].sort(
      (a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || a.name.localeCompare(b.name),
    ),
  );

  let open = $state(false);
  let menu: HTMLElement | undefined = $state();

  /** Anywhere else puts it away. Asked by containment rather than by stopping
      the opening click, which the page's own listeners are also waiting for. */
  function dismiss(event: MouseEvent) {
    if (!open) return;
    if (menu?.contains(event.target as Node)) return;
    open = false;
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
</script>

<svelte:window onclick={dismiss} />

<!-- Nothing ran, or no forge answered: the bar says nothing rather than
     offering a menu of nothing. -->
{#if summary && summary.total > 0}
  <span class="checks-menu" bind:this={menu}>
    <button
      class="checks"
      class:bad={summary.failed > 0}
      class:ok={summary.failed === 0 && summary.running === 0}
      class:busy={summary.failed === 0 && summary.running > 0}
      title="What the forge made of this branch"
      onclick={() => (open = !open)}
    >
      <span class="checks-label">Checks</span>
      <span class="checks-tally">{summary.done}/{summary.total}</span>
      {@html CHECK_RING(summary.total ? summary.done / summary.total : 0)}
    </button>

    {#if open}
      <span class="checks-list">
        {#each ordered as check (check.name + (check.workflow ?? ""))}
          <!-- A run with a page on the forge is a link; one without is a row.
               Nothing that cannot be opened is drawn as though it could be. -->
          <svelte:element
            this={check.url ? "a" : "div"}
            class="check-row {check.state}"
            href={check.url}
            target={check.url ? "_blank" : undefined}
            rel={check.url ? "noreferrer" : undefined}
            title={check.url ? "Open this run on the forge" : undefined}
          >
            <span class="verdict">{VERDICT[check.state] ?? ""}</span>
            <!-- Two lines: what ran, and where it ran from. The job's name is
                 the thing being looked for; the workflow is how to find it
                 again on the forge. -->
            <span class="about">
              <span class="name">{check.name}</span>
              {#if check.workflow}<span class="flow">{check.workflow}</span>{/if}
            </span>
            {#if check.elapsedMs !== undefined}
              <span class="took">{elapsed(check.elapsedMs)}</span>
            {/if}
          </svelte:element>
        {/each}
      </span>
    {/if}
  </span>
{/if}

<style>
  .checks-menu { position: relative; flex: 0 0 auto; }
  .checks {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .checks:hover { color: var(--text); background: color-mix(in srgb, var(--text) 10%, transparent); }
  .checks-tally { font-variant-numeric: tabular-nums; }
  /* Green while everything that has finished has passed, red the moment one has
     not: a reviewer wants the bad news without opening anything. */
  .checks.ok { color: var(--action); }
  .checks.bad { color: var(--removed); }
  .checks.busy { color: var(--warning); }

  .checks-list {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 45;
    display: flex;
    flex-direction: column;
    width: 380px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    color: var(--text);
    text-decoration: none;
    font-size: 12px;
  }
  .check-row:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }
  /* The verdict in a chip of its own. A glyph in the page's own dark green was
     the least visible thing in a row it is the point of. */
  .verdict {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    font-size: 11px;
    line-height: 1;
    padding-top: 1px;
  }
  .check-row.passed .verdict {
    color: var(--added);
    background: color-mix(in srgb, var(--added) 18%, transparent);
  }
  .check-row.failed .verdict {
    color: var(--removed);
    background: color-mix(in srgb, var(--removed) 20%, transparent);
  }
  .check-row.running .verdict {
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 20%, transparent);
  }
  .check-row.skipped .verdict {
    color: var(--muted);
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  /* The job over the workflow it belongs to: two facts of different weight, and
     a row that reads in one pass instead of three columns competing. */
  .about {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .flow {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .took {
    flex: 0 0 auto;
    align-self: center;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
