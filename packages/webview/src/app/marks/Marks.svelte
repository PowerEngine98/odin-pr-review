<!--
  The marks in the margin: one face beside every line somebody has commented on.

  A layer over the canvas rather than part of it. The cards live inside a single
  transformed element, so anything drawn in there is drawn at the reader's zoom —
  which is right for code and wrong for a face, and wrong for anything meant to
  be pressed. The marks are placed in screen coordinates instead: they follow the
  cards as the camera moves and keep their own size while doing it.

  Following costs a measurement. Where a line ends up on the screen is the card's
  answer, not this component's — a row can be folded into a band, held below the
  card's height cap, or hidden with the reading it belongs to — so the layer asks
  the document where the row is and places the mark against it. That is the whole
  reason this is one layer and not a mark per card: the measuring happens once
  per frame, for every mark, in one pass.

  Nothing is measured on the server. Placements start empty and are only ever
  written by an effect, which the server renderer never runs, so a page rendered
  by Node emits the empty layer and no marks at all rather than reaching for a
  document that is not there.
-->
<script lang="ts">
  import { motion } from "../canvas/camera.svelte.js";
  import type { CommentView } from "../model.js";
  import { threadsOf, type Conversation } from "../panels/Thread.svelte";
  import { model, settings, ui, view } from "../state.svelte.js";
  import Mark from "./Mark.svelte";
  import { markSize, placeMark, seenSize, sideOf, type Side } from "./marks.js";

  /** A conversation and where on the screen its mark has ended up. */
  interface Placed {
    /** The remark the conversation is filed under. */
    id: string;
    thread: Conversation;
    left: number;
    top: number;
    size: number;
    /** Its file has been read, so it draws itself smaller and fainter. */
    seen: boolean;
  }

  const threads = $derived(threadsOf(model.current.comments ?? []));

  let layer = $state<HTMLElement | null>(null);
  let placed = $state<Placed[]>([]);

  /**
   * Where an arrow about a whole file meets a card, when nobody has measured a
   * title. The same fallback the arrows use, for the same reason: a remark on
   * the file belongs to its name, and half a title's height is right often
   * enough to be better than the middle of the card.
   */
  const TITLE_MID = 17;

  /* ------------------------------------------------------------- measuring */

  /**
   * The visible band or bar standing in for a row that is not on screen.
   *
   * A band between two hunks has no rows behind it — those lines were never
   * read — so there is nothing in the document to walk back from. Each band
   * carries the range it hides instead, which is the only way to find the one
   * covering a line that was never rendered. Without it a mark on such a line
   * fell through to the middle of the card and claimed a position it had no
   * reason to claim.
   */
  function foldFor(
    body: HTMLElement,
    row: HTMLElement | null,
    side: Side,
    line: number,
  ): HTMLElement | null {
    const from = side === "base" ? "data-base-from" : "data-head-from";
    const to = side === "base" ? "data-base-to" : "data-head-to";

    for (const band of body.querySelectorAll<HTMLElement>(`.row.gap[${from}]`)) {
      if (band.offsetParent === null) continue;
      if (line >= Number(band.getAttribute(from)) && line <= Number(band.getAttribute(to))) {
        return band;
      }
    }

    // Held back by the card's height rather than by a fold. The bar at the foot
    // is the honest place to point: it says there is more below and opens it.
    // The nearest band above would say "in this stretch of unchanged code",
    // which is a different claim, and a false one.
    if (row?.classList.contains("beyond-cap")) {
      const bar = body.querySelector<HTMLElement>(".row.more");
      if (bar) return bar;
    }

    // A row that exists but is folded away: the band above it is the one.
    for (let previous = row?.previousElementSibling; previous; previous = previous.previousElementSibling) {
      const band = previous as HTMLElement;
      if (band.classList.contains("gap") && band.offsetParent !== null) return band;
    }

    return body.querySelector<HTMLElement>(".row.more");
  }

  /**
   * The height on the screen of the line a remark is about.
   *
   * Read from the row's own rectangle rather than from its offset inside the
   * card, so the canvas transform is already applied and there is no second
   * place keeping a copy of the zoom.
   */
  function heightOf(card: HTMLElement, root: CommentView): number {
    const box = card.getBoundingClientRect();

    // A remark about the file belongs to the file, so it sits by its title.
    if (root.wholeFile) {
      const title = card.querySelector<HTMLElement>(".card-title");
      const at = title?.getBoundingClientRect();
      return at ? at.top + at.height / 2 : box.top + TITLE_MID * view.scale;
    }

    const side = sideOf(root.side);
    // Only one reading of the change is in the document at a time, so the
    // question is asked of the body that is showing.
    const body = card.querySelector<HTMLElement>(".card-body") ?? card;
    const attribute = side === "base" ? "data-old" : "data-new";
    const row = body.querySelector<HTMLElement>(`.row[${attribute}="${root.line}"]`);
    const shown =
      row && row.offsetParent !== null ? row : foldFor(body, row, side, root.line);

    // Nothing on screen stands for the line — a card too small to have drawn
    // its rows yet, or one showing the other side of the change. The middle of
    // the card is the one position that is never wrong about which file the
    // remark is on, which is what the reader reads first.
    if (!shown) return box.top + box.height / 2;
    const at = shown.getBoundingClientRect();
    return at.top + at.height / 2;
  }

  /**
   * Every mark, placed, in one pass over the document.
   *
   * The cards are gathered into a map first because a change carries hundreds
   * of remarks and a search of the document per remark is that many walks of
   * the same tree. A card is preferred to the slot it fills — both carry the
   * id, and only the card has rows — but a slot will do while the canvas is
   * still putting cards into them, which keeps the marks on the drawing rather
   * than having them appear late.
   */
  function measure(): Placed[] {
    const bar = document.querySelector(".chrome");
    const room = {
      ceiling: bar ? bar.getBoundingClientRect().height : 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const size = markSize(view.scale);

    const cards = new Map<string, HTMLElement>();
    for (const element of document.querySelectorAll<HTMLElement>(
      ".card[data-id], .card-slot[data-id]",
    )) {
      const id = element.dataset.id;
      if (!id) continue;
      if (!cards.has(id) || element.classList.contains("card")) cards.set(id, element);
    }

    const out: Placed[] = [];
    for (const thread of threads) {
      const root = thread.root;
      const node = model.current.nodes.find((one) => one.path === root.path);
      if (!node) continue;

      // No card on the canvas: filtered away, in another part, or marked read
      // and hidden. The old renderer drew the mark anyway and then hid it,
      // which is the same picture at the cost of laying out and loading a face
      // for every remark in a change the reader has filtered down to four
      // files.
      const card = cards.get(node.id);
      if (!card) continue;

      const box = card.getBoundingClientRect();
      /*
       * A conversation on a file already read stands back.
       *
       * Measured at the smaller size rather than drawn small afterwards: the
       * mark is placed against the card's edge with room for its own tail, and
       * a mark shrunk by a transform after that would sit with a gap where the
       * tail used to reach.
       */
      const seen = ui.viewed.has(root.path);
      const own = seenSize(size, seen);
      const spot = placeMark(box, heightOf(card, root), own, room);
      if (!spot) continue;

      out.push({ id: root.id, thread, left: spot.left, top: spot.top, size: own, seen });
    }
    return out;
  }

  /**
   * One measurement per frame however many things asked for one.
   *
   * A pan fires on every pointer move and the observer below fires on every
   * class the cards touch; measuring for each of those would be measuring the
   * same document several times before the browser had a chance to paint it
   * once.
   */
  let frame = 0;
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      placed = measure();
    });
  }

  /**
   * Everything that can move a mark.
   *
   * Gathered into one value so that reading it is visibly the subscription:
   * the camera, the reading of the change, the part on screen, what has been
   * marked read, and the conversations themselves. The measuring proper runs
   * outside the effect, where it reads the document without any of it being
   * mistaken for a dependency.
   */
  const cue = $derived([
    view.x,
    view.y,
    view.scale,
    // The end of a flight, which moves every mark on the screen without moving
    // a single number here. The camera's numbers reach their destination when
    // the flight is booked and the drawing takes half a second of animation to
    // catch up, so the measurement taken on the change is a measurement of a
    // canvas still in transit. This is the one signal that says it has arrived.
    motion.flying,
    threads,
    settings.unified,
    settings.showTests,
    settings.hideViewed,
    ui.part,
    ui.viewed,
  ]);

  $effect(() => {
    cue;
    schedule();
  });

  // A frame asked for and never spent: the layer is gone by the time it comes
  // round, and its callback would place marks into a component nobody is
  // rendering any more.
  $effect(() => () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  });

  /**
   * A card folding, unfolding, or arriving.
   *
   * None of that is in the shared state — a band opens because a reader pressed
   * it, and the only trace is a class on a row inside a component this layer
   * does not own. Watching for it is the only way a mark on a line inside that
   * band can move with the lines. Mutations the layer itself caused are ignored,
   * or placing the marks would ask for the marks to be placed again.
   */
  $effect(() => {
    const watch = new MutationObserver((records) => {
      if (records.every((record) => layer?.contains(record.target))) return;
      schedule();
    });
    watch.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("resize", schedule);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", schedule);
    };
  });

  /* ------------------------------------------------------- opening a thread */

  /** The mark's own rectangle on the screen, which is what a thread hangs off. */
  function rectOf(mark: Placed): DOMRect {
    return new DOMRect(mark.left, mark.top, mark.size, mark.size);
  }

  function open(mark: Placed): void {
    ui.thread = { id: mark.id, anchor: rectOf(mark) };
  }

  /**
   * The same conversation, opened at what the agent said.
   *
   * A thread on a working agent grows from the bottom, and by the time there is
   * a badge to press there is usually a question, a plan and an answer above it.
   * Opening at the top shows the reader the thing they wrote.
   */
  function openAtAgent(mark: Placed): void {
    ui.thread = { id: mark.id, anchor: rectOf(mark), at: "agent" };
  }

  /**
   * The open conversation's anchor, kept in step with the mark it hangs off.
   *
   * The thread derives its position from this rectangle, so the rectangle has
   * to be the mark's current one rather than the one it had when it was
   * pressed. Under the old renderer the thread was placed by a call made
   * before the mark had moved, which left it a frame behind — enough, after a
   * flight across the canvas, to land on the wrong side of the file it belongs
   * to. Here the placement and the anchor are the same measurement: a mark
   * cannot move without this following it in the same update.
   *
   * A mark that has gone off screen keeps its last anchor rather than losing
   * it. A reader who pans away from an open conversation is not asking for it
   * to leap into the corner.
   *
   * A conversation opened with no anchor at all was opened from somewhere that
   * could not know where its mark is — the list of threads, which asks the
   * camera to fly there in the same breath. It waits for the flight to land
   * before taking one. The alternative is the box appearing over whatever the
   * mark's position happened to be as the drawing set off, and then jumping;
   * the first place it lands is the one the reader reads.
   */
  $effect(() => {
    const thread = ui.thread;
    if (!thread) return;
    if (motion.flying && !thread.anchor) return;
    const mark = placed.find((one) => one.id === thread.id);
    if (!mark) return;
    const at = thread.anchor;
    if (at && at.left === mark.left && at.top === mark.top && at.width === mark.size) {
      return;
    }
    thread.anchor = rectOf(mark);
  });
  /**
   * What an agent is doing in this conversation, if one is.
   *
   * Read off the thread rather than asked for: which agent claimed it is
   * already the first agent to have spoken in it, and how its turn is going is
   * on the remark it is answering. Nothing here needs the host to say anything
   * it has not already said.
   *
   * Only for conversations Odin holds. A thread on the forge has no agent in it
   * and never will, and a badge that could never appear is a branch nobody can
   * check.
   */
  function stateOf(
    thread: { root: CommentView; comments: CommentView[] },
  ): { agent?: string; task: string } | null {
    if (!thread.root.local) return null;

    // The turn most recently asked about, which is the one worth reporting: an
    // older finished one says nothing a reader wants at a glance.
    const asked = [...thread.comments]
      .filter((comment) => comment.task && !comment.agent)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .pop();
    if (!asked?.task) return null;

    /*
     * Who has it, when anybody has.
     *
     * Not a condition of saying anything, which it used to be. A message that
     * has been written and not yet taken is `queued`, and one taken a moment
     * ago has an owner the page has not been told about yet — so a reader who
     * had just asked for something saw nothing at all in the margin until the
     * agent's first word came back. The state is the news; whose it is is a
     * detail that arrives with it or shortly after.
     */
    const owner =
      ui.owners[String(thread.root.id)] ??
      thread.comments.find((comment) => comment.agent)?.agent;
    return { ...(owner ? { agent: owner } : {}), task: asked.task };
  }
</script>

<div class="marks" bind:this={layer}>
  {#each placed as mark (mark.id)}
    {@const going = stateOf(mark.thread)}
    <Mark
      root={mark.thread.root}
      count={mark.thread.comments.length}
      left={mark.left}
      top={mark.top}
      size={mark.size}
      seen={mark.seen}
      open={ui.thread?.id === mark.id}
      onopen={() => open(mark)}
      working={going}
      onagent={() => openAtAgent(mark)}
    />
  {/each}
</div>

<style>
  /*
    Over the canvas rather than in it, so the faces keep their size and stay
    clear of the arrows they would otherwise be buried under. Transparent to the
    pointer along its whole extent — it covers the entire window, and a layer
    that took clicks would take every click meant for the drawing underneath it.
    The marks themselves take theirs back.
  */
  .marks {
    position: fixed;
    inset: 0;
    z-index: var(--z-marks, 22);
    pointer-events: none;
  }
</style>
