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
          themeVariables: { fontFamily: "var(--sans)", fontSize: "12px" },
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
  }: { code: string; liftable?: boolean } = $props();

  let box = $state<HTMLElement | null>(null);
  let drawn = $state(false);
  let failed = $state(false);

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
        await draw(mermaid, element);
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

    A type of our own on the transfer, so the canvas can tell this from any
    other thing a reader might drag over it and refuse the rest.
  -->
  <div
    class="diagram"
    class:drawing={!drawn}
    class:liftable
    draggable={liftable}
    title={liftable ? "Drag onto the change to keep it there" : undefined}
    ondragstart={(event) => {
      if (!liftable) return;
      event.dataTransfer?.setData("application/odin-diagram", code);
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
     like one. */
  .diagram.liftable {
    cursor: grab;
  }

  .diagram.drawing {
    color: transparent;
    min-height: 40px;
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
