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
  /** What a suggestion written here would replace, and where those lines live. */
  export interface Suggestion {
    before: string[];
    startLine: number;
    language: string;
  }

  export type Inline =
    | { kind: "text"; text: string }
    | { kind: "code"; text: string }
    | { kind: "strong"; text: string }
    | { kind: "em"; text: string }
    | { kind: "del"; text: string };

  export type Block =
    | { kind: "paragraph"; content: Inline[] }
    | { kind: "quote"; content: Inline[] }
    | { kind: "heading"; level: number; content: Inline[] }
    | { kind: "rule" }
    | { kind: "list"; ordered: boolean; items: { box: string; content: Inline[] }[] }
    | { kind: "code"; lang: string; code: string; id: number }
    | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
    | {
        kind: "suggestion";
        before: string[];
        after: string[];
        startLine: number;
        language: string;
        beforeId: number;
        afterId: number;
      };

  /** One line of code as the host colours it. */
  export interface Token {
    text: string;
    color?: string;
  }

  /**
   * Names for the blocks the host is asked to colour.
   *
   * Unique across the page rather than per box: the answer comes back on the
   * one message channel every panel shares, and two editors that both called
   * their first block 1 would paint each other's code.
   */
  let counter = 0;

  /**
   * Inline marks, found in one pass.
   *
   * Deliberately flat: a bold sentence with code inside it renders as bold and
   * then as code, not as one nested in the other. The old renderer got the
   * nesting by running substitutions over escaped HTML, which is the trick this
   * is here to avoid — the text is a person's, and it is rendered as text.
   */
  const INLINE =
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s]+)/g;

  export function parseInline(text: string): Inline[] {
    const parts: Inline[] = [];
    let at = 0;
    INLINE.lastIndex = 0;
    let found: RegExpExecArray | null;

    while ((found = INLINE.exec(text)) !== null) {
      if (found.index > at) {
        parts.push({ kind: "text", text: text.slice(at, found.index) });
      }
      if (found[1] !== undefined) parts.push({ kind: "code", text: found[1] });
      else if (found[2] !== undefined) parts.push({ kind: "strong", text: found[2] });
      else if (found[3] !== undefined) parts.push({ kind: "em", text: found[3] });
      else if (found[4] !== undefined) parts.push({ kind: "em", text: found[4] });
      else if (found[5] !== undefined) parts.push({ kind: "del", text: found[5] });
      else if (found[6] !== undefined) {
        // A link is its text and its target, never an anchor: a comment box is
        // not a place to put something a reader has not looked at one click
        // away.
        parts.push({ kind: "text", text: found[6] + " (" });
        parts.push({ kind: "code", text: found[7] });
        parts.push({ kind: "text", text: ")" });
      } else if (found[8] !== undefined) {
        parts.push({ kind: "code", text: found[8] });
      }
      at = found.index + found[0].length;
    }

    if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
    return parts;
  }

  /**
   * Markdown, as far as a comment box needs it.
   *
   * A deliberately small subset, parsed into blocks the template draws as real
   * elements. Anything unrecognised stays the characters that were typed, which
   * is what the forge will store; a plain line is a better answer than a
   * confident wrong rendering of one — and a person's sentence never becomes
   * markup on its way to the screen, because it is never turned into markup at
   * all.
   */
  export function parseMarkdown(source: string, context?: Suggestion | null): Block[] {
    const lines = source.split("\n");
    const out: Block[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced blocks first: nothing inside one is markdown.
      const fence = /^\s*(`{3,})(.*)$/.exec(line);
      if (fence) {
        const lang = fence[2].trim();
        const body: string[] = [];
        i++;
        while (i < lines.length && !new RegExp("^\\s*" + fence[1]).test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        i++;

        // A suggestion is a change, so it is drawn as one: what it replaces
        // above what it puts there, numbered, the way the forge draws it. A
        // block of green with no idea what it is replacing is half the story.
        if (lang === "suggestion") {
          out.push({
            kind: "suggestion",
            before: context?.before ?? [],
            after: body,
            startLine: context?.startLine ?? 0,
            language: context?.language ?? "",
            beforeId: ++counter,
            afterId: ++counter,
          });
          continue;
        }

        out.push({ kind: "code", lang, code: body.join("\n"), id: ++counter });
        continue;
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        out.push({
          kind: "heading",
          level: Math.min(3, heading[1].length),
          content: parseInline(heading[2]),
        });
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoted: string[] = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoted.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out.push({ kind: "quote", content: parseInline(quoted.join(" ")) });
        continue;
      }

      // A rule, which the forge draws and which otherwise reads as a heading.
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
        out.push({ kind: "rule" });
        i++;
        continue;
      }

      // A table: a header row, a row of dashes, then the body. Recognised by
      // the dashes, because a line with pipes in it is usually just a line.
      if (
        line.indexOf("|") >= 0 && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])
      ) {
        const cells = (row: string): Inline[][] =>
          row
            .replace(/^\s*\|/, "")
            .replace(/\|\s*$/, "")
            .split("|")
            .map((cell) => parseInline(cell.trim()));

        const head = cells(line);
        i += 2;
        const rows: Inline[][][] = [];
        while (i < lines.length && lines[i].indexOf("|") >= 0 && lines[i].trim() !== "") {
          rows.push(cells(lines[i]));
          i++;
        }
        out.push({ kind: "table", head, rows });
        continue;
      }

      if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items: { box: string; content: Inline[] }[] = [];
        while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
          let item = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
          const task = /^\[([ xX])\]\s*/.exec(item);
          if (task) {
            item = item.slice(task[0].length);
            items.push({
              box: task[1] === " " ? "☐ " : "☑ ",
              content: parseInline(item),
            });
          } else {
            items.push({ box: "", content: parseInline(item) });
          }
          i++;
        }
        out.push({ kind: "list", ordered, items });
        continue;
      }

      if (line.trim() === "") {
        i++;
        continue;
      }

      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) &&
        !/^\s*>/.test(lines[i]) &&
        !/^\s*`{3,}/.test(lines[i]) &&
        !/^#{1,6}\s/.test(lines[i])
      ) {
        para.push(lines[i]);
        i++;
      }
      out.push({ kind: "paragraph", content: parseInline(para.join(" ")) });
    }

    return out;
  }

  /**
   * The markdown buttons, in the order the forge puts them.
   *
   * Drawn here rather than fetched, like every other glyph in the page. Rules
   * fall between the groups — the suggestion stands alone, then the marks, then
   * the lists — because ten of one thing would be a wall.
   */
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
  import { notify, host } from "../state.svelte.js";

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
   * who has selected three lines and pressed the list button means. The text
   * goes through the binding rather than onto the element, so the draft that is
   * filed on the next keystroke is the text the button actually produced.
   */
  async function apply(kind: string): Promise<void> {
    const box = field;
    if (!box) return;

    const start = box.selectionStart;
    const end = box.selectionEnd;
    const text = value;
    const selected = text.slice(start, end);

    const place = async (next: string, from: number, to: number) => {
      value = next;
      await tick();
      box.focus();
      box.selectionStart = from;
      box.selectionEnd = to;
    };

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

{#snippet inline(parts: Inline[])}{#each parts as part}{#if part.kind === "code"}<code>{part.text}</code>{:else if part.kind === "strong"}<strong>{part.text}</strong>{:else if part.kind === "em"}<em>{part.text}</em>{:else if part.kind === "del"}<del>{part.text}</del>{:else}{part.text}{/if}{/each}{/snippet}

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
    <textarea
      class="editor-body"
      bind:this={field}
      bind:value
      {rows}
      {placeholder}
      hidden={tab !== "write"}
    ></textarea>
    <div class="editor-preview" hidden={tab === "write"}>
      {#if value.trim()}
        {@render rendered()}
      {:else}
        <span class="empty">Nothing to preview</span>
      {/if}
    </div>
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
