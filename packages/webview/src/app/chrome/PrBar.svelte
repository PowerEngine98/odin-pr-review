<!--
  The header a pull request has on the forge.

  Reviewing here and reviewing in the browser should not feel like two different
  jobs, and the browser's answer to "what am I looking at" is this bar: the
  state, the title, who is merging what into where, and how much of it has been
  read. Repeating its shape costs a few rules and saves the reader from having
  to learn a second one.

  It renders with or without a pull request. A branch compared against another
  branch still has an author, a commit count and two ref names, and losing the
  whole header because no forge is involved would be a strange way to treat the
  offline case.
-->
<script lang="ts">
  import Refreshing from "../Refreshing.svelte";
  import Settings from "./Settings.svelte";
  import { model, notify, ui } from "../state.svelte.js";
  import { CARET, COPY_ICON, PR_ICON, RING } from "./icons.js";

  /**
   * Repeated from Chrome rather than shared, because there is nowhere to share
   * it from: none of this is in the view model yet. One interface goes when the
   * contract grows a field for the pull request; so does this one.
   */
  interface PrMeta {
    baseRef: string;
    headRef: string;
    authors?: { name: string; commits: number }[];
    pullRequest?: {
      number: number;
      title: string;
      url: string;
      draft?: boolean;
      reviewDecision?: string;
    };
  }

  let {
    meta,
    hasSchema = false,
    notes,
    pending = 0,
    onReview,
  }: {
    meta?: PrMeta;
    hasSchema?: boolean;
    notes?: { gaps?: string; unpainted?: string[] };
    pending?: number;
    onReview?: () => void;
  } = $props();

  const pull = $derived(meta?.pullRequest);
  const authors = $derived(meta?.authors ?? []);
  const commits = $derived(authors.reduce((n, a) => n + a.commits, 0));

  /**
   * How much of the change has been read, said the way the forge says it.
   *
   * Counted from the files and the marks rather than kept in a number beside
   * them: the old page had a tally to update from six places, and any one of
   * them forgetting left the bar quietly wrong. A file nothing changed has no
   * box, so counting it would leave the tally short of full however much was
   * read and make finishing look impossible.
   */
  const read = $derived.by(() => {
    let done = 0;
    let total = 0;
    for (const node of model.current.nodes) {
      if (node.untouched) continue;
      total += 1;
      if (ui.viewed.has(node.path)) done += 1;
    }
    return { done, total };
  });

  /** Whether the state menu is open, and the span to measure clicks against. */
  let stateOpen = $state(false);
  let stateMenu: HTMLElement | undefined = $state();

  /**
   * Anywhere else puts the menu away, which is what every menu does.
   *
   * Asked as "did the click land inside", not answered by stopping the opening
   * click from travelling: this page has listeners on the document for picking
   * lines and clearing selections, and a menu that swallows its own click to
   * stay open swallows theirs too.
   */
  function dismiss(event: MouseEvent) {
    if (!stateOpen) return;
    if (stateMenu?.contains(event.target as Node)) return;
    stateOpen = false;
  }

  /** The host confirms and reports. Taking a pull request out of draft asks the
      whole team to look, so nothing about it happens on one click here. */
  function setDraft(draft: boolean) {
    stateOpen = false;
    notify("setDraft", { draft });
  }

  let copied = $state(false);
  let copyTimer = 0;

  /**
   * Copying the branch name is what the forge's header is for half the time —
   * it is how a reviewer gets from reading the change to checking it out.
   */
  function copyRef() {
    const ref = meta?.headRef ?? "";
    const done = () => {
      copied = true;
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => (copied = false), 1200);
    };

    // Webviews do not always grant the clipboard API. A hidden field and the
    // old command work where it is refused, and saying nothing at all would
    // leave the reviewer pasting whatever was there before.
    const fallback = () => {
      const field = document.createElement("textarea");
      field.value = ref;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        if (document.execCommand("copy")) done();
      } catch {
        /* nothing left to try; the name is on screen to be read */
      }
      field.remove();
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(ref).then(done, fallback);
    } else {
      fallback();
    }
  }
</script>

<svelte:window onclick={dismiss} />

<div class="prbar">
  <!-- The state is a button where it can be changed and a label where it
       cannot. A control that looks pressable and is not is worse than a plain
       word. -->
  {#if pull && model.current.canReview}
    <span class="state-menu" bind:this={stateMenu}>
      <button
        class="state pressable {pull.draft ? 'draft' : 'open'}"
        title={pull.draft
          ? "Mark this pull request ready for review"
          : "Change the state of this pull request"}
        onclick={() => (stateOpen = !stateOpen)}
      >
        {@html PR_ICON}{pull.draft ? "Draft" : "Open"}{@html CARET}
      </button>
      {#if stateOpen}
        <span class="state-list">
          {#if pull.draft}
            <button class="state-item" onclick={() => setDraft(false)}>
              Ready for review
              <span class="why">Asks the team to look. Reviewers are notified.</span>
            </button>
          {:else}
            <button class="state-item" onclick={() => setDraft(true)}>
              Convert to draft
              <span class="why">Takes it back out of the review queue.</span>
            </button>
          {/if}
        </span>
      {/if}
    </span>
  {:else if pull}
    <span class="state {pull.draft ? 'draft' : 'open'}">
      {@html PR_ICON}{pull.draft ? "Draft" : "Open"}
    </span>
  {:else}
    <span class="state local">{@html PR_ICON}Local</span>
  {/if}

  <span class="about">
    <span class="head-line">
      {#if pull}
        <span class="pr-title" title={pull.title}>{pull.title}</span>
        <a
          class="pr-number"
          href={pull.url}
          target="_blank"
          rel="noreferrer"
          title="Open #{pull.number} in the browser"
        >#{pull.number}</a>
        {#if pull.reviewDecision === "APPROVED"}
          <span class="tag ok">approved</span>
        {:else if pull.reviewDecision === "CHANGES_REQUESTED"}
          <span class="tag warn">changes requested</span>
        {:else if pull.reviewDecision === "REVIEW_REQUIRED"}
          <span class="tag muted">review required</span>
        {/if}
      {:else}
        <span class="pr-title">{meta?.headRef ?? ""}</span>
      {/if}
    </span>
    <!-- "wants to merge" is the forge's phrasing, and it is worth borrowing: it
         names the direction, which two ref names side by side never quite do. -->
    <!-- The whole sentence lives in the tooltip as well, so the words the bar
         drops when it narrows are still somewhere a reader can get at them. -->
    <span
      class="merge-line"
      title="{authors[0] ? `${authors[0].name} wants to merge` : 'merging'}{commits
        ? ` ${commits === 1 ? '1 commit' : `${commits} commits`}`
        : ''} into {meta?.baseRef ?? ''} from {meta?.headRef ?? ''}"
    >
      {#if authors[0]}
        <span class="who">{authors[0].name}</span><span class="prose">wants to merge</span>
      {:else}
        <span class="prose">merging</span>
      {/if}
      {#if commits}<span class="commits">{commits === 1 ? "1 commit" : `${commits} commits`}</span>{/if}
      <span class="prose">into</span> <span class="ref base">{meta?.baseRef ?? ""}</span>
      <span class="prose">from</span> <span class="ref head">{meta?.headRef ?? ""}</span>
      <button
        class="copy-ref"
        class:done={copied}
        title="Copy the branch name"
        onclick={copyRef}
      >{@html COPY_ICON}</button>
    </span>
  </span>

  <span class="spacer"></span>

  <Refreshing on={ui.refreshing} note={ui.note} />

  <span class="viewed-count" title="Files you have marked as reviewed">
    {@html RING(read.total ? read.done / read.total : 0)}
    <span class="tally">{read.done} / {read.total}</span><span class="label">viewed</span>
  </span>

  <!-- Present from the start, the way the forge's own button is: hiding it
       until something is drafted keeps the one thing a reviewer came to do out
       of sight until they have already worked out how to do it. -->
  {#if model.current.canReview}
    <button class="submit" onclick={() => onReview?.()}>
      Submit review{#if pending > 0}<span class="count">{pending}</span>{/if}
    </button>
  {/if}

  <Settings {hasSchema} {notes} />
</div>

<style>
  /*
   * What the bar gives up first, and what it never gives up.
   *
   * The panel is usually beside an editor rather than filling the window, so
   * the width that matters is this element's own — a window query would keep
   * every control at full size in a panel a third as wide, which is how the
   * title came to be printed across the checks.
   *
   * The order things go in is the order they answer questions nobody is asking
   * yet. The prose around the refs goes before the refs; the refs go before the
   * counts; a word beside a ring goes before the ring, because the ring still
   * says how far along it is. What survives to the narrowest bar is the state,
   * the title, and the way to submit — which is the change, what it is called,
   * and the only thing here that cannot be done from anywhere else.
   */
  .prbar {
    container-type: inline-size;
    container-name: prbar;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    font-size: 12px;
    /* Nothing here may push a neighbour out of the bar: every child that can
       grow is told it may also shrink, and the one that holds text truncates
       rather than overflowing. A flex item defaults to refusing to go below
       its content's width, which is what made the two lines collide. */
    min-width: 0;
  }

  .about {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
  }

  .head-line,
  .merge-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  /* The one thing on the left that is allowed to lose characters. Everything
     beside it is a fixed-width badge, so it is the only place a long title can
     be taken out of. */
  .pr-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* The controls on the right never shrink: they are targets, and a button
     that has been squeezed to eight pixels is a button nobody can press. */
  .prbar > :not(.about):not(.spacer) {
    flex: 0 0 auto;
  }

  @container prbar (max-width: 820px) {
    /* The sentence around the refs. The refs themselves stay: "into main from
       feat/x" is the fact, and "wants to merge 10 commits" is the telling of
       it. Kept in the element's own tooltip rather than deleted. */
    .merge-line .who,
    .merge-line .commits,
    .merge-line .prose {
      display: none;
    }
  }

  @container prbar (max-width: 680px) {
    /* Both refs are in the tab strip and the window title. This line is the
       first whole thing worth losing. */
    .merge-line {
      display: none;
    }
  }

  @container prbar (max-width: 560px) {
    /* The word, not the number: "0 / 118" is the answer, "viewed" is the
       label on an answer the ring beside it already explains. */
    .viewed-count .label {
      display: none;
    }
  }

  @container prbar (max-width: 460px) {
    /* A verdict becomes its colour. The tag's text is three words and its
       meaning is one bit, which a dot carries. */
    .head-line .tag {
      width: 9px;
      height: 9px;
      padding: 0;
      border-radius: 50%;
      overflow: hidden;
      text-indent: -999px;
      background: currentColor;
    }
  }

  @container prbar (max-width: 380px) {
    /* Last of all, the number of files read. The ring stays: it is the same
       fact drawn rather than counted, and it costs nothing. */
    .viewed-count .tally {
      display: none;
    }
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 4px 11px 4px 9px;
    border-radius: 999px;
    font-weight: 600;
    color: #fff;
    background: var(--muted);
  }
  /* The same green the actions use, for the same reason: white on the diff's
     own green is the weakest pairing in the page. */
  .state.open { background: var(--action); color: #fff; }
  .state.draft { background: color-mix(in srgb, var(--muted) 80%, var(--text)); }
  .state.local { background: color-mix(in srgb, var(--muted) 70%, transparent); }

  /* The state is where a draft stops being a draft, so it is a button — with a
     caret, because a control that acts on the pull request should say that it
     opens something rather than doing it on the first click. */
  .state-menu { position: relative; flex: 0 0 auto; }
  .state.pressable {
    border: 0;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    padding-right: 8px;
  }
  .state.pressable:hover { filter: brightness(1.12); }
  /* The icons arrive as markup, which the scoping never touches. */
  .state :global(.caret) { opacity: 0.8; margin-left: 1px; }

  .state-list {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 45;
    min-width: 260px;
    padding: 4px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    border: 1px solid var(--panel-edge);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
  }
  .state-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    font: inherit;
    color: var(--text);
    background: transparent;
    border: 0;
    border-radius: 6px;
    padding: 7px 9px;
    cursor: pointer;
  }
  .state-item:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }
  /* What it will do, said before it is done rather than in a dialog after. */
  .state-item .why { color: var(--muted); font-size: 11px; }

  .about {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 0 1 auto;
  }
  .head-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .pr-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pr-number { color: var(--muted); text-decoration: none; flex: 0 0 auto; }
  .pr-number:hover { color: var(--status-renamed); text-decoration: underline; }

  .merge-line {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--muted);
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
  }
  .who { color: var(--status-renamed); }

  /* The refs as chips, because the two names are the part of this sentence the
     eye is looking for. */
  .ref {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--status-renamed);
    background: color-mix(in srgb, var(--status-renamed) 14%, transparent);
    border-radius: 999px;
    padding: 1px 8px;
    max-width: 34ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy-ref {
    display: inline-flex;
    align-items: center;
    padding: 2px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .copy-ref:hover { color: var(--text); background: color-mix(in srgb, var(--text) 10%, transparent); }
  /* It went. Said for a moment and then taken back, because a clipboard is not
     a state the page has anything more to say about. */
  .copy-ref.done { color: var(--added); }

  .spacer { flex: 1 1 auto; }

  .viewed-count {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    color: var(--muted);
  }
  .viewed-count .tally { color: var(--text); font-weight: 600; }
  .viewed-count :global(.ring) { color: var(--status-renamed); }

  /* Filled rather than outlined, like every other state in this page: an
     outline in the tag's own colour drew a ring brighter than the words
     inside it. */
  .tag {
    border: 0;
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 11px;
    flex: 0 0 auto;
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .tag.ok { color: var(--added); }
  .tag.warn { color: var(--warning); }
  .tag.muted { color: var(--muted); }

  /* Sending a review is the one irreversible thing this page can do, so it is
     the one control drawn as a filled button. White on the diff's own green was
     the weakest contrast in the page — that green is chosen to sit behind code,
     not under text — so the action takes a colour of its own. */
  .submit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    font: inherit;
    font-weight: 600;
    color: var(--action-ink);
    background: var(--action);
    border: 1px solid color-mix(in srgb, #000 22%, var(--action));
    border-radius: 6px;
    padding: 5px 12px;
    cursor: pointer;
  }
  .submit:hover { filter: brightness(1.08); }
  .submit .count {
    background: color-mix(in srgb, var(--action-ink) 22%, transparent);
    border-radius: 999px;
    padding: 0 6px;
    font-size: 11px;
  }
</style>
