<!--
  The Tour tab in an agent's console: asking for a tour, watching one being
  made, and the lessons once it is.

  In the console rather than in a panel of its own, because an agent is what
  makes it — the same agent whose log is a tab away, and whose log is where the
  reader looks when making one takes longer than they expected.
-->
<script lang="ts">
  import { clock, frameSeconds, topicSeconds, type Topic } from "@odin/core/tour/tour.js";

  import { notify, settings } from "../state.svelte.js";
  import { startTour } from "./player.svelte.js";
  import { tour } from "./state.svelte.js";

  let { onReflect }: { onReflect?: () => void } = $props();

  const topics = $derived(tour.data?.topics ?? []);

  /** Where a topic left off: frame shown of all of them, and how far through by time. */
  function resumeOf(topic: Topic): { frame: number; of: number; percent: number } | null {
    const at = tour.frames[topic.id];
    if (!at || at <= 0 || at >= topic.frames.length) return null;
    const done = topic.frames.slice(0, at).reduce((sum, frame) => sum + frameSeconds(frame), 0);
    const percent = Math.round((done / Math.max(1, topicSeconds(topic))) * 100);
    if (percent >= 100) return null;
    return { frame: at + 1, of: topic.frames.length, percent };
  }
  const watched = $derived(new Set(tour.watched));
  const total = $derived(topics.reduce((sum, topic) => sum + topicSeconds(topic), 0));

  /** Somewhere into it already, so pressing play carries on rather than starts over. */
  const begun = $derived(tour.watched.length > 0 || tour.topic > 0 || tour.frame > 0);

  /** What the reader wants changed about the tour, for the agent correcting it. */
  let correction = $state("");

  function revise(): void {
    notify("tourRevise", { note: correction.trim() });
    correction = "";
  }

  function narrate(on: boolean): void {
    settings.tourNarration = on;
    tour.narrated = on;
  }
</script>

<div class="lessons">
  {#if tour.status === "making"}
    <div class="making" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <span class="making-note">{tour.note || "Reading the change…"}</span>
      <button class="quiet" onclick={() => notify("tourCancel", {})}>Cancel</button>
    </div>
  {:else if tour.status === "failed"}
    <div class="failed" role="alert">
      <span class="failed-note">{tour.note || "The tour could not be made."}</span>
      <button class="quiet" onclick={() => notify("tourMake", { fresh: true })}>Try again</button>
    </div>
  {/if}

  {#if tour.data}
    <div class="heading">
      <span class="title" title={tour.data.title}>{tour.data.title}</span>
      <span class="length">{topics.length} {topics.length === 1 ? "topic" : "topics"} · {clock(total)}</span>
    </div>

    {#if tour.stale}
      <p class="stale">
        The change has moved on since this tour was made. Some places in it may no longer be found.
        {#if tour.status !== "making"}
          <button class="quiet" onclick={revise}>Update it</button>
        {/if}
      </p>
    {/if}

    <ol class="topics">
      {#each topics as topic, at (topic.id)}
        {@const resume = resumeOf(topic)}
        <li class="topic" class:current={tour.active && tour.topic === at} class:resumable={resume}>
          <button
            class="play-topic"
            title="Play “{topic.title}”"
            aria-label="Play {topic.title}"
            onclick={() => startTour(at, tour.frames[topic.id] ?? 0)}
          >
            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
              <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" />
            </svg>
          </button>
          <span class="topic-text">
            <span class="topic-title">{topic.title}</span>
            <span class="topic-summary">{topic.summary}</span>
            {#if resume}
              <button class="resume-at" onclick={() => startTour(at, tour.frames[topic.id] ?? 0)}>
                Resume at {resume.frame}/{resume.of} · {resume.percent}%
              </button>
            {/if}
          </span>
          <span class="topic-time">
            {#if watched.has(topic.id)}
              <span class="watched" title="Watched to the end" aria-label="Watched">
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                  <path d="M3.5 8.4l3 3 6-6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            {/if}
            {clock(topicSeconds(topic))}
          </span>
          {#if resume}
            <span class="progress" aria-hidden="true">
              <span class="progress-fill" style:width="{resume.percent}%"></span>
            </span>
          {/if}
        </li>
      {/each}
    </ol>

    <div class="actions">
      <button class="primary" onclick={() => startTour()}>{begun ? "Resume" : "Play tour"}</button>
      {#if tour.status !== "making"}
        <button class="quiet" onclick={() => notify("tourMake", { fresh: true })}>Make a new tour</button>
        {#if onReflect}
          <button
            class="quiet"
            title="The agent critiques its own change through the tour and proposes a plan, without editing anything until you approve it"
            onclick={onReflect}
          >Reflect on the changes</button>
        {/if}
      {/if}
    </div>

    {#if tour.status !== "making"}
      <form
        class="revise"
        onsubmit={(event) => {
          event.preventDefault();
          revise();
        }}
      >
        <textarea
          rows="2"
          placeholder="Correct the tour: reorder topics, fix a place, explain something more…"
          bind:value={correction}
          onkeydown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              revise();
            }
          }}
        ></textarea>
        <button class="quiet" type="submit">Update the tour</button>
      </form>
    {/if}

    <label class="narrate">
      <input
        type="checkbox"
        checked={settings.tourNarration}
        onchange={(event) => narrate(event.currentTarget.checked)}
      />
      Narrate the tour
    </label>
  {:else if tour.status === "none"}
    <div class="empty">
      <p class="pitch">An agent reads the whole change and walks you through it, one flow at a time, flying between the files as it explains them.</p>
      <button class="primary" onclick={() => notify("tourMake", {})}>Give me a tour</button>
    </div>
  {/if}
</div>

<style>
  .lessons {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 8px;
    color: var(--text);
    font-size: 11px;
    line-height: 1.45;
  }

  .revise {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    margin-top: 8px;
  }
  .revise textarea {
    box-sizing: border-box;
    width: 100%;
    resize: vertical;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 4px 6px;
  }
  .revise textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  .making,
  .failed {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }
  .making-note,
  .failed-note {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .making-note { color: var(--muted); }
  .failed {
    background: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 12%, transparent);
  }
  .failed-note { color: var(--vscode-errorForeground, #f14c4c); }

  .spinner {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--text) 24%, transparent);
    border-top-color: var(--vscode-focusBorder, #0a84ff);
    animation: turn 0.8s linear infinite;
  }
  @keyframes turn { to { transform: rotate(360deg); } }

  .heading {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
  }
  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .length {
    flex: 0 0 auto;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .stale {
    margin: 0 0 8px;
    padding: 4px 6px;
    border-left: 2px solid var(--warning, #e2b341);
    color: var(--muted);
  }

  .topics {
    margin: 0 0 10px;
    padding: 0;
    list-style: none;
  }
  .topic {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 4px;
    border-radius: 4px;
  }
  .topic + .topic { border-top: 1px solid color-mix(in srgb, var(--text) 8%, transparent); }
  .topic.resumable {
    position: relative;
    padding-bottom: 8px;
  }
  .resume-at {
    align-self: flex-start;
    margin-top: 2px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: 600;
    color: var(--status-renamed);
    cursor: pointer;
  }
  .resume-at:hover { text-decoration: underline; }
  .progress {
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: 2px;
    height: 3px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text) 14%, transparent);
    overflow: hidden;
  }
  .progress-fill {
    display: block;
    height: 100%;
    background: var(--status-renamed);
  }
  .topic.current { background: color-mix(in srgb, var(--status-renamed) 18%, transparent); }

  .play-topic {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .play-topic:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .play-topic:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

  .topic-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .topic-title { font-weight: 600; }
  .topic-summary { color: var(--muted); }

  .topic-time {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .watched {
    display: inline-flex;
    color: var(--status-renamed);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .primary,
  .quiet {
    padding: 3px 10px;
    border-radius: 4px;
    font: inherit;
    cursor: pointer;
  }
  .primary {
    border: 0;
    background: var(--vscode-button-background, #0a84ff);
    color: var(--vscode-button-foreground, #fff);
  }
  .primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background, #0a84ff)); }
  .quiet {
    flex: 0 0 auto;
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    background: transparent;
    color: var(--text);
  }
  .quiet:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
  .primary:focus-visible,
  .quiet:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }

  .narrate {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    cursor: pointer;
  }
  .narrate input { margin: 0; accent-color: var(--vscode-focusBorder, #0a84ff); }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .pitch {
    margin: 0;
    color: var(--muted);
  }
</style>
