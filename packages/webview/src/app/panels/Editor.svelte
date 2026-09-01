<!--
  One box for writing markdown, wherever markdown is written.

  A line comment, a reply and a review summary are the same act with different
  destinations, and giving two of them a bare textarea while the third had tabs
  and a toolbar meant the tool was teaching two habits for one job. Reading
  markdown is the same act again, so a posted remark is this box with nothing to
  type in: one renderer, and a comment can never look like one thing in the
  preview and another once it is sent.

  The suggestion button is the exception to "the same everywhere": it fills
  itself with the lines being commented on, so it only appears where there are
  lines under the cursor.
-->
<script module lang="ts">
  export {
    parseInline,
    parseMarkdown,
    type Block,
    type Inline,
    type Suggestion,
    type Token,
  } from "./markdown.js";
  import { parseMarkdown } from "./markdown.js";

  const TOOLS = [
    { kind: "heading", label: "Heading", path: "M4 3v10M12 3v10M4 8h8" },
    { kind: "bold", label: "Bold", path: "M5 3h4a2.5 2.5 0 0 1 0 5H5zM5 8h4.5a2.5 2.5 0 0 1 0 5H5z" },
    { kind: "italic", label: "Italic", path: "M10 3H6.5M9.5 13H6M9 3l-2 10" },
    { kind: "quote", label: "Quote", path: "M3 4v8M6 5h7M6 8h7M6 11h4" },
    { kind: "code", label: "Code", path: "M6 4L2.5 8 6 12M10 4l3.5 4-3.5 4" },
    {
      kind: "link",
      label: "Link",
      path: "M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.7.7M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.7-.7",
    },
    { kind: "ul", label: "Bulleted list", path: "M6 4h8M6 8h8M6 12h8M3 4h.01M3 8h.01M3 12h.01" },
    { kind: "ol", label: "Numbered list", path: "M6 4h8M6 8h8M6 12h8M2 3h1v3M2 12h2M2 10h2v.01" },
    {
      kind: "task",
      label: "Task list",
      path: "M7 4h7M7 8h7M7 12h7M2 3.5l1 1 1.5-1.5M2 7.5l1 1 1.5-1.5M2 11.5l1 1 1.5-1.5",
    },
  ];

  /**
   * A colour from the host, reduced to what a colour can be.
   *
   * The theme is the host's own and nothing a reviewer typed reaches this, but
   * it arrives over the same channel as everything else, and a style property
   * is the one place in this component where a string still means something to
   * the browser. Anything that is not a colour is dropped rather than trusted.
   */
  function safeColour(colour: string | undefined): string {
    return String(colour ?? "").replace(/[^#\w(),.% ]/g, "");
  }
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { model, notify, host } from "../state.svelte.js";
  import { showPicture } from "../hud/picture.svelte.js";
  import { markOf } from "@odin/core/agents/marks.js";
  import {
    matching,
    mentioned,
    splitMentions,
    typingMention,
    withMention,
    type Named,
  } from "../mentions.js";
  import { pictured } from "../pictured.svelte.js";
  import Diagram from "./Diagram.svelte";

  let {
    value = $bindable(""),
    placeholder = "",
    rows = 5,
    /** Present where a suggestion makes sense, absent where it does not. */
    context = null,
    /** A remark already posted: the same rendering, with nothing to type in. */
    readonly = false,
    autofocus = false,
  }: {
    value?: string;
    placeholder?: string;
    rows?: number;
    context?: Suggestion | null;
    readonly?: boolean;
    autofocus?: boolean;
  } = $props();

  let tab = $state<"write" | "preview">("write");
  let field = $state<HTMLTextAreaElement | null>(null);

  /**
   * The agents this page can name, in the order the host found them.
   *
   * Whatever is installed: naming one that is switched off still routes — the
   * host starts it — so a menu that hid it would be hiding a working answer.
   */
  const agents = $derived<Named[]>(
    (model.current.agents ?? []).map((agent) => ({ id: agent.id, name: agent.name })),
  );

  /**
   * The name being typed, and what it could be.
   *
   * Held rather than derived from the field, because it is about the caret as
   * well as the text: the same remark with the caret somewhere else is a
   * different question.
   */
  let typing = $state<{ from: number; to: number; query: string } | null>(null);
  const choices = $derived(typing ? matching(typing.query, agents) : []);
  let chosen = $state(0);

  /**
   * Where the line being written is, so the menu opens under it.
   *
   * A menu pinned to the foot of the box is a menu the eye has to go and find,
   * and on a short comment it lands over the buttons. This follows the caret's
   * line — measured by counting newlines rather than by mirroring the field,
   * which is the usual trick and needs a second hidden copy of the box kept in
   * step with the first. The column is left alone: a menu that also slid
   * sideways with every keystroke would be harder to read than one that does
   * not.
   */
  let under = $state(0);

  /**
   * Who the remark as it stands will reach, drawn under the field.
   *
   * A `<textarea>` is one colour of text all the way through — it will not
   * paint part of what it holds, and the only ways round that are to put a
   * mirrored copy of the box behind it or to give up the textarea for a
   * `contenteditable`, both of which buy a coloured name at the price of the
   * caret, the undo stack and the selection arithmetic the toolbar above does.
   * So the name in the field stays plain and the answer goes beside it: the
   * agents this remark names, each in its own colour, which is the question the
   * colour was being asked to answer.
   */
  const reaching = $derived(mentioned(value, agents));

  function look(): void {
    const box = field;
    if (!box) return;
    const caret = box.selectionStart ?? box.value.length;
    const found = typingMention(box.value, caret);
    typing = found ?? null;
    chosen = 0;
    if (!found) return;

    const style = getComputedStyle(box);
    const line = Number.parseFloat(style.lineHeight) || 18;
    const lines = box.value.slice(0, caret).split("\n").length;
    // Under the line, not over it, and never above the top of the field when
    // the box has been scrolled.
    under = Math.max(0, box.offsetTop + lines * line - box.scrollTop + 4);
  }

  /**
   * New text in the field, and the caret put where it belongs afterwards.
   *
   * Shared by the toolbar and by the mention menu rather than written twice,
   * and at the top level rather than inside the one that happened to need it
   * first. It used to be a local of `apply`, so `take` — which is not inside
   * `apply` — referred to a name that did not exist there: choosing a name
   * from the menu threw `place is not defined` before it could rewrite
   * anything, and because the handlers call `take` through `void` the throw
   * never reached `window.onerror` either. The menu closed, the remark was
   * untouched, and nothing anywhere said why.
   *
   * The text goes through the binding rather than onto the element, so the
   * draft filed on the next keystroke is the text that was actually written;
   * and the caret is set after a `tick`, because a selection set on a textarea
   * Svelte has not re-rendered yet is thrown away along with the old value.
   */
  async function place(next: string, from: number, to: number): Promise<void> {
    const box = field;
    if (!box) return;
    value = next;
    await tick();
    box.focus();
    box.selectionStart = from;
    box.selectionEnd = to;
  }

  async function take(who: Named): Promise<void> {
    const box = field;
    if (!box || !typing) return;
    const done = withMention(box.value, typing, who);
    typing = null;
    await place(done.text, done.caret, done.caret);
  }

  /**
   * The four keys the menu owns while it is open, and only while it is open.
   *
   * Everything else belongs to the field: a box that swallowed Enter with
   * nothing to choose would be a comment nobody can finish writing.
   */
  function menuKeys(event: KeyboardEvent): boolean {
    if (!typing || choices.length === 0) return false;
    if (event.key === "ArrowDown") {
      chosen = (chosen + 1) % choices.length;
      return true;
    }
    if (event.key === "ArrowUp") {
      chosen = (chosen - 1 + choices.length) % choices.length;
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      void take(choices[chosen] ?? choices[0]!);
      return true;
    }
    if (event.key === "Escape") {
      typing = null;
      return true;
    }
    return false;
  }


  /**
   * Only parsed where it is shown.
   *
   * `$derived` is not computed until something reads it, and while the reader is
   * typing nothing does: the preview is a tab away, and re-parsing a comment on
   * every keystroke to draw something nobody is looking at is work the host
   * needs for the graph.
   */
  const blocks = $derived(parseMarkdown(value, context));
  const showing = $derived(readonly || tab === "preview");

  /** Tokens the host has sent back, by the name the block was asked under. */
  let painted = $state<Record<number, Token[][]>>({});

  /**
   * The grammars and the theme live with the host — the same ones the cards are
   * drawn with, which is the point: a Kotlin snippet in a comment should look
   * like Kotlin in the file above it. So this is a round trip, and a page with
   * no host simply keeps the plain text it already has.
   */
  $effect(() => {
    if (!showing || !host) return;
    painted = {};
    for (const block of blocks) {
      if (block.kind === "code" && block.lang) {
        notify("highlight", { id: block.id, lang: block.lang, code: block.code });
      }
      if (block.kind === "suggestion" && block.language) {
        notify("highlight", {
          id: block.beforeId,
          lang: block.language,
          code: block.before.join("\n"),
        });
        notify("highlight", {
          id: block.afterId,
          lang: block.language,
          code: block.after.join("\n"),
        });
      }
    }
  });

  $effect(() => {
    const answer = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== "highlighted") return;
      if (!Array.isArray(message.lines) || message.lines.length === 0) return;
      painted = { ...painted, [message.id]: message.lines as Token[][] };
    };
    window.addEventListener("message", answer);
    return () => window.removeEventListener("message", answer);
  });

  $effect(() => {
    if (autofocus && field) field.focus();
  });

  /**
   * What each markdown button does to the field.
   *
   * Wrapping styles keep the selection selected afterwards, and prefixing ones
   * apply to every line the selection touches, because that is what somebody
   * who has selected three lines and pressed the list button means. The writing
   * itself is `place`, which the mention menu uses too.
   */
  async function apply(kind: string): Promise<void> {
    const box = field;
    if (!box) return;

    const start = box.selectionStart;
    const end = box.selectionEnd;
    const text = value;
    const selected = text.slice(start, end);

    const wrap = (before: string, after: string) =>
      place(
        text.slice(0, start) + before + selected + after + text.slice(end),
        start + before.length,
        start + before.length + selected.length,
      );

    const prefix = (make: (line: string) => string) => {
      const from = text.lastIndexOf("\n", start - 1) + 1;
      let to = text.indexOf("\n", end);
      if (to === -1) to = text.length;
      const marked = (text.slice(from, to) || "").split("\n").map(make).join("\n");
      return place(text.slice(0, from) + marked + text.slice(to), from, from + marked.length);
    };

    const tick3 = "```";

    if (kind === "bold") await wrap("**", "**");
    else if (kind === "italic") await wrap("_", "_");
    else if (kind === "code") {
      if (selected.indexOf("\n") >= 0) await wrap(tick3 + "\n", "\n" + tick3);
      else await wrap("`", "`");
    } else if (kind === "link") await wrap("[", "](url)");
    else if (kind === "heading") await prefix((line) => "### " + line);
    else if (kind === "quote") await prefix((line) => "> " + line);
    else if (kind === "ul") await prefix((line) => "- " + line);
    else if (kind === "task") await prefix((line) => "- [ ] " + line);
    else if (kind === "ol") {
      let n = 0;
      await prefix((line) => {
        n++;
        return n + ". " + line;
      });
    } else if (kind === "suggest") {
      // Filled with the lines being commented on. A suggestion has to be the
      // whole replacement for the span it covers, and retyping it from memory
      // is how the wrong indentation gets in. A box with no lines behind it
      // gets an empty fence: better empty than full of the wrong file.
      const lines = context && context.before.length > 0 ? context.before : [""];
      const block = tick3 + "suggestion\n" + lines.join("\n") + "\n" + tick3;
      const body = value.trim();
      const next = body ? body + "\n\n" + block : block;
      // Inside the fence, where the replacement is written.
      const caret = next.length - (tick3.length + 1);
      await place(next, caret, caret);
    }

    tab = "write";
  }
</script>

{#snippet said(text: string)}{#each splitMentions(text, agents) as piece}{#if piece.who}<span class="mention" style="--who:{markOf(piece.who.id).color}">{piece.text}</span>{:else}{piece.text}{/if}{/each}{/snippet}

{#snippet inline(parts: Inline[])}{#each parts as part}{#if part.kind === "code"}<code>{part.text}</code>{:else if part.kind === "strong"}<strong>{part.text}</strong>{:else if part.kind === "em"}<em>{part.text}</em>{:else if part.kind === "del"}<del>{part.text}</del>{:else if part.kind === "image"}{#if pictured(part.src)}<button class="pictured-open" type="button" title="{part.src} — press to see it full size" onclick={() => showPicture(pictured(part.src)!, part.alt || part.src)}><img class="pictured" src={pictured(part.src)} alt={part.alt} /></button>{:else}<span class="pictured-waiting" title={part.src}>{part.alt || "picture"}</span>{/if}{:else}{@render said(part.text)}{/if}{/each}{/snippet}

{#snippet code(id: number, plain: string)}{#if painted[id]}{#each painted[id] as line, at}{#if at > 0}{"\n"}{/if}{#each line as token}<span style="color:{safeColour(token.color)}">{token.text}</span>{/each}{/each}{:else}{plain}{/if}{/snippet}

{#snippet cell(id: number, lines: string[], at: number)}{#if painted[id] && painted[id][at]}{#each painted[id][at] as token}<span style="color:{safeColour(token.color)}">{token.text}</span>{/each}{:else}{lines[at]}{/if}{/snippet}

{#snippet rendered()}
  {#each blocks as block}
    {#if block.kind === "paragraph"}
      <p>{@render inline(block.content)}</p>
    {:else if block.kind === "heading"}
      {#if block.level === 1}
        <h1>{@render inline(block.content)}</h1>
      {:else if block.level === 2}
        <h2>{@render inline(block.content)}</h2>
      {:else}
        <h3>{@render inline(block.content)}</h3>
      {/if}
    {:else if block.kind === "quote"}
      <blockquote>{@render inline(block.content)}</blockquote>
    {:else if block.kind === "rule"}
      <hr />
    {:else if block.kind === "list"}
      {#if block.ordered}
        <ol>
          {#each block.items as item}<li>{item.box}{@render inline(item.content)}</li>{/each}
        </ol>
      {:else}
        <ul>
          {#each block.items as item}<li>{item.box}{@render inline(item.content)}</li>{/each}
        </ul>
      {/if}
    {:else if block.kind === "table"}
      <table>
        <thead>
          <tr>{#each block.head as head}<th>{@render inline(head)}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each block.rows as row}
            <tr>{#each row as column}<td>{@render inline(column)}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    {:else if block.kind === "diagram"}
      <!-- Liftable only where it is an answer that scrolls away. A drawing
           already pinned to the change is drawn by the canvas, which passes
           nothing. -->
      <Diagram code={block.code} liftable />
    {:else if block.kind === "code"}
      <pre>{#if block.lang}<span class="lang">{block.lang}</span>{/if}<code>{@render code(block.id, block.code)}</code></pre>
    {:else if block.kind === "suggestion"}
      <div class="suggestion">
        <div class="suggestion-head">Suggested change</div>
        <table>
          <tbody>
            {#each block.before as line, at}
              <tr class="del"><td class="n">{block.startLine ? block.startLine + at : ""}</td><td class="m">−</td><td class="code">{@render cell(block.beforeId, block.before, at)}</td></tr>
            {/each}
            {#each block.after as line, at}
              <tr class="add"><td class="n">{block.startLine ? block.startLine + at : ""}</td><td class="m">+</td><td class="code">{@render cell(block.afterId, block.after, at)}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/each}
{/snippet}

{#if readonly}
  <div class="rendered">{@render rendered()}</div>
{:else}
  <div class="editor">
    <div class="editor-tabs">
      <button class="tab" class:is-on={tab === "write"} onclick={(event) => { event.preventDefault(); tab = "write"; }}>Write</button>
      <button class="tab" class:is-on={tab === "preview"} onclick={(event) => { event.preventDefault(); tab = "preview"; }}>Preview</button>
      <span class="md-tools">
        {#if context}
          <!-- First and set apart, as the forge places it: a page with a plus
               and a minus on it, because a reviewer who has seen the glyph
               there should not have to work out what it is here. -->
          <button class="md" data-md="suggest" title="Suggest a replacement" aria-label="Suggest a replacement" onclick={(event) => { event.preventDefault(); apply("suggest"); }}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d="M4 2.75h5.2L12 5.4v7.85a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
              <path d="M9.2 2.9V5.4H11.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
              <path d="M7.5 7.1v2.3M6.35 8.25h2.3M6.35 11.5h2.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
          </button>
        {/if}
        {#each TOOLS as item}
          <button class="md" data-md={item.kind} title={item.label} aria-label={item.label} onclick={(event) => { event.preventDefault(); apply(item.kind); }}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d={item.path} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        {/each}
      </span>
    </div>
    <!-- Hidden rather than removed: a reader who looks at the preview and comes
         back is in the middle of a sentence, and a field that was thrown away
         and rebuilt loses their cursor along with their scroll. -->
    <!--
      The field, and the names it can offer.

      The menu is a sibling rather than a child: a textarea holds text and
      nothing else, so anything drawn "inside" one is drawn over it, and it is
      placed against the box rather than against the caret because a textarea
      will not say where its caret is on screen without a second hidden copy of
      itself to measure.
    -->
    <div class="editor-field">
      <textarea
        class="editor-body"
        bind:this={field}
        bind:value
        {rows}
        {placeholder}
        hidden={tab !== "write"}
        oninput={look}
        onclick={look}
        onkeyup={(event) => {
          // Arrows and Home move the caret without changing the text, which is
          // half of what decides whether a name is being typed.
          if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") look();
        }}
        onkeydown={(event) => {
          if (menuKeys(event)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onblur={() => {
          // A beat, so that pressing a name in the menu is not a blur that
          // closes the menu before the press lands.
          setTimeout(() => (typing = null), 120);
        }}
      ></textarea>

      {#if typing && choices.length > 0 && tab === "write"}
        <ul class="mentions" role="listbox" aria-label="Agents" style="top:{under}px">
          {#each choices as who, at (who.id)}
            {@const mark = markOf(who.id)}
            <li>
              <button
                type="button"
                class="mention-choice"
                class:on={at === chosen}
                role="option"
                aria-selected={at === chosen}
                onmousedown={(event) => {
                  // Before the blur, or the menu is gone by the time the click
                  // would have arrived.
                  event.preventDefault();
                  void take(who);
                }}
                onclick={(event) => {
                  // A press that arrives as a click rather than as a
                  // mousedown — a touch, a keyboard's own activation — means
                  // the same thing and must not fall through to the field.
                  event.preventDefault();
                  event.stopPropagation();
                  void take(who);
                }}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <rect width="24" height="24" rx="12" fill={mark.color} />
                  {#if mark.stroke}
                    <path d={mark.path} fill="none" stroke={mark.ink} stroke-width="2" stroke-linecap="round" />
                  {:else}
                    <path d={mark.path} fill={mark.ink} />
                  {/if}
                </svg>
                <span class="mention-name">{who.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class="editor-preview" hidden={tab === "write"}>
      {#if value.trim()}
        {@render rendered()}
      {:else}
        <span class="empty">Nothing to preview</span>
      {/if}
    </div>
    <!-- Under both tabs, because who a remark reaches is a fact about the
         remark rather than about which way it is being looked at — and under
         the field rather than in it, since a textarea cannot colour part of
         its own text. -->
    {#if reaching.length > 0}
      <div class="reaching">
        <span class="reaching-what">Reaches</span>
        {#each reaching as who (who.id)}
          <span class="reaching-who" style="--who:{markOf(who.id).color}">{who.name}</span>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* One frame around the tabs, the tools and the field, so they read as a
     single control rather than three stacked ones.

     Every mix below adds to a hundred, and has to. A `color-mix` whose
     percentages fall short comes back with the remainder as transparency —
     `var(--bg) 80%, var(--text) 4%` is 84% opaque, not a shade of the
     background — so the same declared surface paints one colour over the tab
     bar and another over the page. That was the seam under the chosen tab:
     not a stray border but a translucent fill picking up what was behind it. */
  .editor {
    border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-radius: 7px;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg) 96%, var(--text) 4%);
  }

  /* One line, always. It used to wrap, so that a toolbar too wide for the box
     did not lose its last buttons off the edge — but in a reply beside a file
     the box is narrow every time, and what wrapping actually did was put the
     tools on a row of their own underneath the tabs, which reads as two
     controls rather than one and costs a line of the reply. The tools scroll
     instead: nothing is lost and nothing is silently unreachable. */
  .editor-tabs {
    display: flex;
    align-items: stretch;
    flex-wrap: nowrap;
    /* No gap. Each tab already draws the divider as its own right edge, and a
       gap on top of that leaves a strip of the bar showing beside the line —
       so the chosen tab's fill starts two pixels late and the seam reads as a
       misplaced tab rather than as a divider. */
    border-bottom: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    background: color-mix(in srgb, var(--bg) 95%, var(--text) 5%);
  }

  /* Every tab carries the bottom edge and the overhang, chosen or not. Giving
     them only to the chosen one made it a pixel taller than its neighbour and
     sat it a pixel lower, so pressing a tab nudged the pair — the transparent
     edge keeps the box identical and lets the bar's own line show through. */
  .tab {
    border: 0;
    border-right: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    border-bottom: 1px solid transparent;
    margin-bottom: -1px;
    border-radius: 0;
    padding: 7px 11px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }

  .tab.is-on {
    color: var(--text);
    background: color-mix(in srgb, var(--bg) 96%, var(--text) 4%);
    border-bottom-color: color-mix(in srgb, var(--bg) 96%, var(--text) 4%);
  }

  .md-tools {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    justify-content: flex-end;
    gap: 0;
    margin-left: auto;
    padding: 0 4px;
    /* Takes what is left and no more, and scrolls inside it. `min-width` is the
       half that is easy to forget: a flex item will not shrink below its
       content without it, so the row would still be too wide and the tabs would
       be pushed out instead. */
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .md-tools::-webkit-scrollbar {
    display: none;
  }

  /* The buttons keep their size while the strip they sit in narrows. */
  .md-tools > :global(*) {
    flex: 0 0 auto;
  }

  .md {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .md:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  /* Rules between the groups, as the forge has them: the suggestion stands
     alone, then the marks, then the lists. */
  .md[data-md="heading"],
  .md[data-md="ol"] {
    margin-left: 6px;
    border-left: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    border-radius: 0 5px 5px 0;
    padding-left: 6px;
    width: 30px;
  }

  .md :global(svg) {
    display: block;
  }

  .editor-body {
    display: block;
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    font-family: var(--mono);
    color: var(--text);
    background: color-mix(in srgb, var(--bg) 96%, var(--text) 4%);
    border: 0;
    border-radius: 0;
    padding: 9px 10px;
    min-height: 96px;
    resize: vertical;
  }

  .editor-body:focus {
    outline: none;
  }

  .editor-body[hidden],
  .editor-preview[hidden] {
    display: none;
  }

  /* The preview draws a deliberately small subset. Whatever it does not know
     how to draw stays the text that was typed, which is what the forge will
     store anyway. */
  .editor-preview {
    padding: 10px;
    min-height: 96px;
  }

  .editor-preview,
  /* Bounded here rather than around the whole box, so the tabs and the tools
     above it stay put while a long preview scrolls under them. */
  .rendered {
    max-height: var(--preview-room, 46vh);
    overflow-y: auto;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .empty {
    color: var(--muted);
  }

  .editor-preview p,
  .rendered p {
    margin: 0 0 8px;
  }

  .editor-preview ul,
  .editor-preview ol,
  .rendered ul,
  .rendered ol {
    margin: 0 0 8px;
    padding-left: 20px;
  }

  .editor-preview blockquote,
  .rendered blockquote {
    margin: 0 0 8px;
    padding-left: 10px;
    border-left: 3px solid color-mix(in srgb, var(--text) 20%, transparent);
    color: var(--muted);
  }

  /*
   * A name that reaches somebody, in that somebody's colour.
   *
   * A remark addressed to an agent used to look exactly like a remark addressed
   * to nobody, so the only way to find out whether the name had been recognised
   * was to send it and see who answered. The colour is the same one the agent
   * wears in its console and on its mark, which is what makes it an answer to
   * "who is that" rather than decoration.
   */
  .mention {
    color: var(--who, var(--action));
    background: color-mix(in srgb, var(--who, var(--action)) 16%, transparent);
    border-radius: 4px;
    padding: 0 3px;
    font-weight: 600;
  }

  /*
   * Who the remark reaches, said in each agent's own colour.
   *
   * The same colour and the same tint as `.mention` above, deliberately: the
   * name highlighted in the preview and the name listed here are one fact told
   * twice, and two different-looking answers to "who is that" would be worse
   * than one. It sits on the tab bar's fill so that it reads as part of the
   * frame rather than as the first line of somebody's reply.
   */
  .reaching {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-top: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
    background: color-mix(in srgb, var(--bg) 95%, var(--text) 5%);
    font-size: 11px;
  }

  .reaching-what {
    color: var(--muted);
  }

  .reaching-who {
    color: var(--who, var(--action));
    background: color-mix(in srgb, var(--who, var(--action)) 16%, transparent);
    border-radius: 4px;
    padding: 0 5px;
    font-weight: 600;
  }

  .editor-field {
    position: relative;
    display: contents;
  }

  /* Over the field, at its foot, where a menu opened from the bottom of a box
     goes. Not at the caret: a textarea will not say where its caret is without
     a second hidden copy of itself to measure, and a menu that is merely near
     the right place is not worth that. */
  .mentions {
    position: absolute;
    left: 12px;
    z-index: var(--z-menu, 45);
    margin: 0;
    padding: 4px;
    list-style: none;
    min-width: 180px;
    max-height: 190px;
    overflow-y: auto;
    border-radius: 8px;
    border: 1px solid var(--panel-edge);
    background: var(--panel);
    box-shadow: 0 10px 30px color-mix(in srgb, #000 45%, transparent);
  }

  .mention-choice {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .mention-choice:hover,
  .mention-choice.on {
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }

  .mention-name { font-size: 12px; }

  /* A picture in a remark, at a size that is a picture rather than a document.
     Big enough to see what was pasted, small enough that a screenshot does not
     take the whole panel and push the words out of it. */
  .pictured {
    display: block;
    max-width: 100%;
    max-height: 220px;
    margin: 4px 0;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
    /* A screenshot of a dark window on a dark panel needs an edge to be a
       thing rather than a hole. */
    background: color-mix(in srgb, var(--text) 6%, transparent);
    object-fit: contain;
  }

  /* The picture is the button. A screenshot in a panel is unreadable at panel
     size, so pressing it is the obvious thing to try — and it has to be a
     button rather than a picture with a handler, or it cannot be reached from
     a keyboard and says nothing to anything reading the page aloud. */
  .pictured-open {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }

  .pictured-open:hover .pictured {
    border-color: color-mix(in srgb, var(--text) 45%, transparent);
  }

  .pictured-open:focus-visible {
    outline: 2px solid var(--action, #007C36);
    outline-offset: 2px;
  }

  /* Named while the bytes are on their way, and if they never come. The path
     is on the title, since that is the one useful thing about a picture that
     will not draw. */
  .pictured-waiting {
    color: var(--muted);
    font-style: italic;
  }

  .editor-preview pre,
  .rendered pre {
    margin: 0 0 8px;
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    overflow-x: auto;
  }

  .editor-preview code,
  .rendered code {
    font-family: var(--mono);
    font-size: 11px;
  }

  .editor-preview p > code,
  .editor-preview li > code,
  .editor-preview td > code,
  .rendered p > code,
  .rendered li > code,
  .rendered td > code {
    padding: 1px 5px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .editor-preview h1,
  .editor-preview h2,
  .editor-preview h3,
  .rendered h1,
  .rendered h2,
  .rendered h3 {
    margin: 0 0 8px;
    font-size: 14px;
  }

  /* The language a block declares, so an uncoloured one still says what it is. */
  .editor-preview pre .lang,
  .rendered pre .lang {
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .editor-preview table,
  .rendered table {
    border-collapse: collapse;
    margin: 0 0 8px;
    font-size: 11px;
  }

  .editor-preview th,
  .editor-preview td,
  .rendered th,
  .rendered td {
    border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    padding: 3px 8px;
    text-align: left;
  }

  .editor-preview th,
  .rendered th {
    background: color-mix(in srgb, var(--text) 7%, transparent);
    font-weight: 600;
  }

  .editor-preview hr,
  .rendered hr {
    border: 0;
    border-top: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    margin: 8px 0;
  }

  .editor-preview del,
  .rendered del {
    color: var(--muted);
  }

  /* A suggestion is drawn as the change it is: the lines it replaces numbered
     from where they sit in the file, and the replacement carrying the same
     numbers, because that is where it will land. */
  .suggestion {
    /* The lines keep their own width; the box is what moves. */
    overflow-x: auto;
    margin: 0 0 8px;
    border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    border-radius: 6px;
    overflow: hidden;
  }

  .suggestion-head {
    padding: 4px 8px;
    color: var(--muted);
    font-size: 11px;
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }

  .suggestion table {
    width: max-content;
    min-width: 100%;
    margin: 0;
    border-collapse: collapse;
    font-family: var(--mono);
  }

  .suggestion td {
    border: 0;
    padding: 1px 6px;
    /* Read the way the file reads. A suggestion is a change to source, and
       source does not reflow — wrapping it puts one line on three rows, throws
       the numbers out beside it, and makes a four-line change unreadable. Long
       lines run off to the right and the box scrolls to them, exactly as the
       card behind it does. */
    white-space: pre;
  }

  .suggestion .n,
  .suggestion .m {
    width: 1%;
    color: var(--muted);
    text-align: right;
    user-select: none;
    /* The code wraps; a line number is not prose and must not. The rule above
       sets `pre-wrap` on every cell, which squeezed the number column to its
       one per cent and then broke three digits across two rows. */
    white-space: nowrap;
  }

  .suggestion .del {
    background: color-mix(in srgb, var(--removed) 16%, transparent);
  }

  .suggestion .add {
    background: color-mix(in srgb, var(--added) 16%, transparent);
  }
</style>
