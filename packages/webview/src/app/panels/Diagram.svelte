<!--
  A picture an agent drew, in the fence it drew it in.

  Asked how something is put together, these tools answer in mermaid — a graph
  written down as text. Printed as a code block it is readable and it is not the
  thing that was communicated; the whole point of drawing a shape is that the
  shape can be seen.

  Two things make this safe to do with text an agent wrote. The renderer is
  never handed the page: it is given one detached element, draws into it, and
  what comes back is moved across as an element rather than assembled out of a
  string — there is no `@html` here, which is the rule this page keeps
  everywhere. And it runs in mermaid's strict mode, which is the setting where
  labels are escaped and click handlers in the source are refused.

  The renderer itself is fetched once per window, the first time anybody draws
  anything. It is three and a half megabytes, and a reading with no diagrams in
  it never pays for it.
-->
<script module lang="ts">
  import { model } from "../state.svelte.js";

  interface Mermaid {
    initialize(config: Record<string, unknown>): void;
    run(options: { nodes: HTMLElement[]; suppressErrors?: boolean }): Promise<void>;
  }

  /**
   * The one fetch, shared by every diagram on the page.
   *
   * A module-level promise rather than a flag: three diagrams in one answer
   * arrive in the same beat, and three of them each starting the download is
   * three downloads. Whoever asks first starts it; the rest wait on the same
   * one.
   */
  let loading: Promise<Mermaid | null> | undefined;

  /**
   * Every drawing that arrives together is drawn together, in one call.
   *
   * Mermaid mints the id for the picture it makes from the clock, and three
   * calls in the same beat mint the same one. It then looks that id up in the
   * document, finds the first box wearing it, and draws everything there: an
   * answer with three diagrams put all three into the first frame, one over
   * another, and left the other two holding an empty shell. Measured — same id
   * on all three, thirty-nine children in the first and two in the rest.
   *
   * Handed the whole batch, it numbers them itself and they land where they
   * belong. So calls are gathered for a beat and made as one, and every caller
   * waits on the batch that carries it.
   */
  const waiting = new Set<HTMLElement>();
  let batch: Promise<void> | null = null;

  export function draw(mermaid: Mermaid, element: HTMLElement): Promise<void> {
    waiting.add(element);
    batch ??= new Promise<void>((done) => {
      setTimeout(() => {
        const nodes = [...waiting];
        waiting.clear();
        batch = null;
        void (async () => {
          /*
           * One at a time, with a beat between them.
           *
           * Mermaid names the picture it makes after the clock — `mermaid-` and
           * the millisecond — and then finds that name in the document to fill
           * it in. Two drawings made inside the same millisecond are two boxes
           * wearing one name, and everything lands in whichever the browser
           * finds first: measured as three diagrams in the first frame and two
           * empty frames after it.
           *
           * Handing it the batch at once is enough on a real machine, where a
           * diagram takes longer than a millisecond to draw. This is for the
           * case where it does not — a trivial graph, a fast machine, a clock
           * that reports in whole milliseconds. Two idle milliseconds per
           * diagram against a render that takes tens.
           */
          for (const node of nodes) {
            try {
              await mermaid.run({ nodes: [node], suppressErrors: true });
            } catch {
              /* a diagram that will not draw leaves its source showing */
            }
            await new Promise((tick) => setTimeout(tick, 2));
          }
          done();
        })();
      }, 0);
    });
    return batch;
  }

  /** Whether this page has a renderer to fetch at all. */
  export function drawable(): boolean {
    return typeof (model.current as { mermaid?: string }).mermaid === "string";
  }

  function load(): Promise<Mermaid | null> {
    if (loading) return loading;
    loading = new Promise<Mermaid | null>((settle) => {
      const from = (model.current as { mermaid?: string }).mermaid;
      if (!from) {
        settle(null);
        return;
      }

      const script = document.createElement("script");
      script.src = from;
      script.onload = () => {
        const found = (window as unknown as { mermaid?: Mermaid }).mermaid;
        if (!found) {
          settle(null);
          return;
        }
        found.initialize({
          startOnLoad: false,
          /*
           * Strict, which is the setting this decision rests on: labels are
           * escaped, and a `click` directive in the source — mermaid's own way
           * of making a node run something — is refused.
           */
          securityLevel: "strict",
          // The drawing's own palette rather than mermaid's, so a diagram in a
          // log does not arrive as a white card in a dark window.
          theme: "dark",
          /*
           * A typeface this page actually has a name for, which is the other
           * half of why pinned drawings had their labels cut off.
           *
           * This asked for `var(--sans)`, and there is no `--sans`: the page's
           * vocabulary names one family, `--mono`, and every surface in the
           * drawing is set in it. An unresolvable `var()` is not ignored — the
           * declaration becomes unset, and an unset font-family inherits. So
           * the label was *painted* in whatever the box around it was in, which
           * everywhere here is the monospace, while mermaid had *measured* it
           * moments earlier in its own fallback, which is Trebuchet. Measured:
           * the same label 146.5 wide when it was sized and 180.6 wide when it
           * was drawn, so every box was twenty-three per cent too narrow for
           * the words in it.
           *
           * In the panel that mostly hid, because a label wide enough to reach
           * mermaid's wrapping threshold gets an explicit width and wraps to it,
           * and text that wraps cannot overflow — which is why the copy in the
           * log wrapped its long names onto two lines and looked perfectly
           * correct. The shorter ones, and every label in a drawing measured
           * inside the canvas, stayed on the path that does not wrap and simply
           * ran out of the box.
           *
           * Naming a font the page defines makes the two measurements the same
           * measurement. It has to be a name that resolves where mermaid does
           * its measuring, which is inside this document — a family invented
           * here would put us straight back where we were.
           */
          themeVariables: { fontFamily: "var(--mono)", fontSize: "12px" },
        });
        settle(found);
      };
      // A renderer that will not load is a code block, which is what this was
      // before and is still perfectly readable.
      script.onerror = () => settle(null);
      document.head.appendChild(script);
    });
    return loading;
  }
</script>

<script lang="ts">
  import { saySize, sizeFromViewBox, wandered, zoomOf } from "../canvas/drawn.js";
  import { showDrawing } from "../hud/picture.svelte.js";

  let {
    code,
    /**
     * Whether this drawing can be dragged onto the change.
     *
     * True in a log, where a drawing is an answer that scrolls away, and false
     * for one already pinned to the canvas — dragging that would be dragging a
     * copy of a thing out of itself.
     */
    liftable = false,
    /**
     * Whether pressing it opens it full size.
     *
     * True everywhere a drawing is small, which is everywhere except inside the
     * viewer itself: a press on the thing already open would open it again.
     */
    openable = true,
  }: { code: string; liftable?: boolean; openable?: boolean } = $props();

  let box = $state<HTMLElement | null>(null);
  let drawn = $state(false);
  let failed = $state(false);

  /**
   * Whether mermaid is measuring in there at this instant.
   *
   * The box is counter-scaled while it draws — see below — and a counter-scaled
   * box is the wrong size on the screen for as long as it takes the batch to
   * finish, which on three diagrams in one answer is long enough to see. Hidden
   * rather than moved out of the way, because it still has to be laid out: an
   * element with no layout measures nothing, and measuring is the whole of what
   * is going on in there.
   */
  let measuring = $state(false);

  /**
   * The source this box is currently showing a picture of.
   *
   * A log is re-parsed as it streams and its blocks are keyed by position, so
   * the third block of an answer is the same component from one chunk to the
   * next while being a different thing to draw. Guarding on "have I drawn
   * anything" meant the first diagram in an answer kept whatever it drew first
   * and every later one was handed to a box that had already finished — which
   * looked like two diagrams in one frame and an empty frame beside it.
   *
   * So what is remembered is *what* was drawn, not that something was.
   */
  let showing = $state("");

  $effect(() => {
    const source = code;
    const element = box;
    if (!element) return;
    if (showing === source && (drawn || failed)) return;

    let gone = false;
    void load().then(async (mermaid) => {
      if (gone || !mermaid) {
        if (!gone && !mermaid) failed = true;
        return;
      }
      try {
        showing = source;
        /*
         * Mermaid draws into the element it is given. `run` takes nodes rather
         * than returning markup, which is the difference between this and the
         * `render` call that hands back a string: nothing here has to decide
         * whether an agent's SVG is safe to insert, because nothing here
         * inserts anything.
         */
        element.textContent = source;
        element.removeAttribute("data-processed");
        await drawUnscaled(mermaid, element);
        drawn = element.querySelector("svg") !== null;
        failed = !drawn;
      } catch {
        // A diagram that will not parse is a diagram the agent got wrong, and
        // the text it wrote is the useful thing to show.
        failed = true;
      }
    });

    return () => {
      gone = true;
    };
  });

  /**
   * Drawn with the zoom taken off the box first, and put back afterwards.
   *
   * This is the fault the pinned copies were showing. Mermaid does not know how
   * wide a label is until it has put it in the document and asked — it appends
   * the text into a `foreignObject` inside the SVG it is building and takes
   * `getBoundingClientRect`, and the width that comes back is what it makes the
   * node box. `getBoundingClientRect` reports the screen, with every transform
   * between the element and the window already applied, while the box it then
   * writes is in the SVG's own user units. Inside the panel the two are the
   * same thing and everything is correct, which is why the copy beside the
   * pinned one looked right in the same instant.
   *
   * A pinned drawing is inside the canvas layer, which is scaled. A reader
   * pinned one at a fifth of life size and every label was measured at a fifth
   * of its width, so mermaid built each node a fifth as wide as its own text —
   * and then the text was painted at its proper size inside it and ran out of
   * the box, which is the `Notificati`, `LaborNotific`, `labor_r` in the
   * screenshot. Nothing had gone wrong with the fonts; a length measured in
   * screen pixels had been used as a length in canvas units, which is the
   * mistake this page has made in three other places.
   *
   * So the scale of whatever the box is sitting in is worked out — the ratio of
   * what is on the screen to what was laid out — and the inverse of it is put
   * on the box for the length of the render. Every transform above it then
   * multiplies out to one, `getBoundingClientRect` answers in canvas units,
   * and mermaid lays the diagram out at the size it would have had in a panel.
   * It is measured rather than taken from the camera because this component
   * belongs to the panels and is only a guest on the canvas: it should not have
   * to know which of its ancestors are transformed, and this way it is right
   * inside the picture viewer's own zoom as well.
   */
  async function drawUnscaled(mermaid: Mermaid, element: HTMLElement): Promise<void> {
    const zoom = zoomOf(element.getBoundingClientRect().width, element.offsetWidth);
    if (zoom === 1) {
      await draw(mermaid, element);
      return;
    }
    measuring = true;
    element.style.transformOrigin = "top left";
    element.style.transform = `scale(${1 / zoom})`;
    try {
      await draw(mermaid, element);
    } finally {
      element.style.transform = "";
      element.style.transformOrigin = "";
      measuring = false;
    }
  }

  /**
   * How big the drawing on the screen is, for whoever is about to take it away.
   *
   * The `viewBox` rather than the element, because the element is as wide as
   * the panel let it be — the rule here is `max-width: 100%`, so a wide diagram
   * in a narrow console reports the console's width — while the `viewBox` is
   * the size mermaid laid the picture out at and is the drawing's own. Nothing
   * at the other end of a drop can work this out for itself: what is dropped is
   * the source, and the picture does not exist there until it has been drawn.
   */
  function sizeOnScreen(): string {
    const svg = box?.querySelector("svg");
    return saySize(sizeFromViewBox(svg?.getAttribute("viewBox")));
  }

  /**
   * Telling a press apart from a drag, which begin identically.
   *
   * Dragging a drawing pins it to the change; pressing it opens it full size,
   * the way pressing a screenshot does. The browser will not decide this for
   * us — a drag that the reader gives up on still ends in a press — so where
   * the pointer went down is remembered and how far it had travelled by the
   * time it came up is what answers.
   *
   * The release is listened for on the window rather than on the box. A pinned
   * drawing sits inside the canvas, and a press there bubbles to the viewport,
   * which captures the pointer — after which no release and no click is ever
   * delivered to this element. That is the same capture the folder controls had
   * to be excused from, and this is the other way round the problem.
   */
  let pressed: { x: number; y: number } | null = null;
  let lifted = false;

  function press(event: PointerEvent): void {
    if (!openable || event.button !== 0) return;
    const from = { x: event.clientX, y: event.clientY };
    pressed = from;
    lifted = false;

    const release = (up: PointerEvent) => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      if (pressed !== from) return;
      pressed = null;
      // A drag that the browser took over is a drag whatever the distance says,
      // and a hand on a trackpad moves a pixel or two while pressing.
      if (lifted || wandered(from, { x: up.clientX, y: up.clientY })) return;
      showDrawing(code);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }

  /** The keyboard's way to the same thing, since a drag has no keyboard. */
  function opened(event: KeyboardEvent): void {
    if (!openable) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    showDrawing(code);
  }
</script>

{#if failed || !drawable()}
  <!-- What it wrote, unchanged. Printed as text by the same rule as everything
       else here: this is an agent's output and never markup. -->
  <pre class="diagram-source"><span class="lang">mermaid</span><code>{code}</code></pre>
{:else}
  <!--
    Draggable, so a picture can be taken out of the log and put beside the code
    it is about. What travels is the source rather than the drawing: the drop
    redraws it at the size it lands at, which is the only way it can be resized
    afterwards without going fuzzy.

    How big it is travels with it, in a type of its own. The canvas cannot work
    that out — what lands there is a few lines of mermaid, and the picture they
    become does not exist until something has drawn it — so every pinned drawing
    used to be given the same rectangle whatever it was a drawing of.

    A type of our own on both, so the canvas can tell this from any other thing
    a reader might drag over it and refuse the rest.
  -->
  <!-- The role and the stop on the tab ring are both `openable`'s, and the
       compiler cannot see that the two arrive together — it reads a `tabindex`
       on something it has decided is not interactive. It is a button wherever
       it is one, and neither attribute is there when it is not. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="diagram"
    class:drawing={!drawn}
    class:measuring
    class:liftable
    class:openable
    draggable={liftable}
    title={openable
      ? liftable
        ? "Press to see it full size, or drag it onto the change to keep it there"
        : "Press to see it full size"
      : undefined}
    role={openable ? "button" : undefined}
    tabindex={openable ? 0 : undefined}
    onkeydown={opened}
    onpointerdown={press}
    ondragstart={(event) => {
      // Whatever the pointer thought it was doing, it was a drag.
      lifted = true;
      if (!liftable) return;
      event.dataTransfer?.setData("application/odin-diagram", code);
      event.dataTransfer?.setData("application/odin-diagram-size", sizeOnScreen());
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    }}
    bind:this={box}
  >{code}</div>
{/if}

<style>
  .diagram {
    margin: 6px 0;
    padding: 6px;
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--text) 4%, transparent);
    /* A drawing is as wide as it is. Wide ones scroll inside their own box
       rather than making the panel around them scroll sideways. */
    overflow-x: auto;
    text-align: center;
  }

  /* Before it is drawn the box holds its own source, which would otherwise
     flash up as a wall of unwrapped text and then vanish. */
  /* Said with the cursor: a picture that can be taken somewhere should look
     like one. A drawing that only opens is pressed rather than carried, so it
     says so with the pointer instead. */
  .diagram.liftable {
    cursor: grab;
  }

  .diagram.openable:not(.liftable) {
    cursor: zoom-in;
  }

  .diagram.openable:focus-visible {
    outline: 2px solid var(--action, #007C36);
    outline-offset: 2px;
  }

  .diagram.drawing {
    color: transparent;
    min-height: 40px;
  }

  /* While mermaid is measuring in there the box is counter-scaled, which is the
     wrong size on the screen until it finishes. Out of sight but still laid
     out: an element with no layout measures nothing. */
  .diagram.measuring {
    visibility: hidden;
  }

  .diagram :global(svg) {
    max-width: 100%;
    height: auto;
  }

  .diagram-source {
    margin: 6px 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
