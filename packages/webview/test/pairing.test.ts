import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) =>
  readFileSync(new URL(`../src/app/${name}`, import.meta.url), "utf8");

/**
 * The rules the pairing surfaces have to keep, stated where they can be broken.
 *
 * Each of these is a decision that looks like a detail from inside the
 * component and is the whole point from outside it. A source check is a weak
 * test in general; it is the right one here, because what is being pinned is
 * that a particular thing is *absent*, and a thing that is absent cannot be
 * driven.
 */
describe("pairing with an agent", () => {
  const terminal = source("hud/Terminal.svelte");
  const pairing = source("hud/Pairing.svelte");
  const composer = source("panels/Composer.svelte");

  it("puts everything an agent is told into the record first", () => {
    /*
     * The rule this started as was "a terminal cannot instruct an agent", and
     * it was the wrong shape. What it was protecting is that every instruction
     * an agent was ever given sits in a thread somebody can audit — and a
     * question about the change ("should these two files be one?") has no line
     * to hang off, so under the old rule it could not be asked at all. It got
     * smuggled into a remark on a line that had nothing to do with it, which is
     * a worse record than none.
     *
     * So the rule is stated as what it defends: nothing reaches an agent from
     * here except through `askAgents`, which the host writes into the
     * conversation as a remark before any agent is handed it. There is no
     * second channel; there is one channel with two doors.
     */
    const asks = terminal.match(/notify\("askAgents", \{[\s\S]{0,400}?\}\);/g) ?? [];
    expect(asks.length).toBeGreaterThan(0);
    for (const ask of asks) {
      // Either a remark already in the thread, said again, or the box below the
      // log — and nothing else.
      expect(ask).toMatch(/body: root\.body|body: said/);
    }
    // And the box's own text goes nowhere until it is sent as one of those.
    // Matched by what it carries rather than by how it is laid out: the call
    // grew a second line when pictures could be attached, and the rule this
    // defends has nothing to say about line breaks.
    const box = terminal.slice(terminal.indexOf("function send(): void {"));
    expect(box).toMatch(/notify\("askAgents", \{[\s\S]{0,200}?body: said,[\s\S]{0,200}?to: id,/);

    // Two boxes now, and both are accounted for: the name of a conversation,
    // which never leaves this side, and the question, which becomes a remark.
    expect(terminal).toMatch(/class="rename-box"/);
    expect(terminal).toMatch(/class="ask-box"/);
    expect(terminal).not.toMatch(/contenteditable/);
  });

  it("grows the box with what is written in it", () => {
    /*
     * One row with a cap is two failures at once: a question of three lines is
     * read through a slot two lines high, and the slot scrolls — so the line
     * being typed sits half behind the top edge.
     *
     * The border is the part that is easy to get wrong. `scrollHeight` stops at
     * the border, the box is `border-box`, so a height taken straight from it
     * is two pixels short of holding what it was measured from — and two pixels
     * short is a scrolling box. Measured: `clipped` was 2 at every size before
     * counting the edges and 0 after, at 26px for one line, 74px for four, and
     * 132px with a scrollbar for twelve.
     */
    expect(terminal).toMatch(/const edges = box\.offsetHeight - box\.clientHeight/);
    expect(terminal).toMatch(/const needed = Math\.ceil\(box\.scrollHeight\) \+ edges/);
    // Reset before measuring, or `scrollHeight` answers with the height it was
    // already given and the box grows and never shrinks.
    expect(terminal).toMatch(/box\.style\.height = "auto"/);
    // It scrolls past the cap and only past it.
    expect(terminal).toMatch(/box\.style\.overflowY = needed > TALLEST \? "auto" : "hidden"/);
    // And comes back down when a message is sent, rather than sitting three
    // lines tall with nothing in it.
    expect(terminal).toMatch(/\$effect\(\(\) => \{\s*\n\s*prompt;\s*\n\s*grow\(\);/);
  });

  it("offers to end a turn while there is one to end", () => {
    /*
     * Driven: no stop button on an idle agent, one beside the send the moment
     * the host says that agent is busy — same size, to its left, in the colour
     * of a thing that interrupts — pressing it sent `stopAgent {agent:
     * "claude"}`, and it went away when the turn ended.
     */
    expect(terminal).toMatch(/\{#if working\}[\s\S]{0,600}?class="ask-stop"/);
    expect(terminal).toMatch(/notify\("stopAgent", \{ agent: id \}\)/);
    // Before the send in the row, which is where it was asked for and where a
    // control that undoes the last press belongs.
    expect(terminal).toMatch(/class="ask-stop"[\s\S]{0,900}?class="ask-send"/);
  });

  it("asks about the change with no file and no line", () => {
    /*
     * Driven from the page: typing in an agent's terminal and pressing Enter
     * sent `{ body: "should NotificationsRelation and NotificationsProjection
     * be one file?", to: "claude" }` — no path, no line — and cleared the box.
     * The host records it as a remark on the change itself, which is measured
     * on its own side.
     */
    expect(terminal).toMatch(/placeholder="Ask \{name\} about the change…"/);
    // Enter sends, shift+enter is still a newline for somebody laying out a
    // list.
    expect(terminal).toMatch(/event\.key === "Enter" && !event\.shiftKey/);
    // Out of the log's own scroll, or a long turn would carry the box away.
    expect(terminal).toMatch(/\.terminal-ask \{[\s\S]{0,200}?flex: 0 0 auto/);

    // A conversation with no file has no mark, and would otherwise be one that
    // exists, holds an agent's answers and cannot be opened anywhere.
    const thread = source("panels/Thread.svelte");
    expect(thread).toMatch(/const anchorless = \$derived\(thread !== null && !thread\.root\.path\)/);
    expect(thread).toMatch(/if \(!root\.path\) return "the change"/);
    // And it belongs to every view of the change rather than to a part of it.
    expect(source("panels/Reviewers.svelte")).toMatch(/!thread\.root\.path \|\|/);
  });

  it("never lets an agent's output become markup", () => {
    /*
     * The guarantee, restated after the box stopped being a `pre`.
     *
     * It is drawn by the same component that draws a comment, which parses
     * markdown into elements and prints every leaf as text — so an agent
     * quoting markup out of the branch it is reading stays quoted. What must
     * never appear is the one construct that would change that.
     */
    // The construct, not the word: this file discusses it in a comment, and a
    // test that cannot tell those apart fails for the wrong reason.
    expect(terminal).not.toMatch(/\{@html/);
    expect(source("panels/Editor.svelte")).not.toMatch(/\{@html/);
    /*
     * Including the diagrams, which is where this rule was most at risk.
     *
     * A renderer that hands back an SVG string would have this page deciding
     * whether markup an agent produced is safe to insert. Mermaid is given a
     * detached element and draws into it instead, so what crosses into the page
     * is an element rather than a string.
     */
    expect(source("panels/Diagram.svelte")).not.toMatch(/\{@html/);
    // Nodes, not markup: `run` is handed the element and draws into it, unlike
    // `render`, which hands back a string somebody then has to insert.
    expect(source("panels/Diagram.svelte")).toMatch(/mermaid\.run\(\{ nodes: \[node\], suppressErrors: true \}\)/);
    expect(source("panels/Diagram.svelte")).not.toMatch(/mermaid\.render\(/);
    expect(source("panels/Diagram.svelte")).toMatch(/securityLevel: "strict"/);
  });

  it("draws each diagram in its own frame", () => {
    /*
     * An answer with two diagrams put both in the first frame, one over the
     * other, and left the second empty.
     *
     * Two faults, both mine. Mermaid names the picture it makes after the clock
     * — `mermaid-` and the millisecond — and then looks that name up in the
     * document to fill it in, so two drawings made inside one millisecond are
     * two boxes wearing one name and everything lands in whichever is found
     * first. And a log is re-parsed as it streams with its blocks keyed by
     * position, so a box that had already drawn something kept it when it was
     * handed a different diagram to draw.
     *
     * Measured before: one id across all three frames, thirty-nine children in
     * the first, two in the rest. After: three ids, and each frame holding its
     * own — Kafka/LaborService, Consumer/Postgres, Alpha/Beta — both when they
     * arrive together and when they stream in a block at a time.
     */
    const diagram = source("panels/Diagram.svelte");
    // What was drawn, rather than that something was.
    expect(diagram).toMatch(/let showing = \$state\(""\)/);
    expect(diagram).toMatch(/if \(showing === source && \(drawn \|\| failed\)\) return/);
    // And a beat between drawings, so the clock they are named after moves.
    expect(diagram).toMatch(/for \(const node of nodes\)[\s\S]{0,400}?setTimeout\(tick, 2\)/);
  });

  it("puts pinned drawings on the map, and greys them out of reading range", () => {
    /*
     * The map answers "what is here and where". A picture somebody deliberately
     * put beside a card is as much a part of that as the card — and left out of
     * the map's own extent it is also a piece of the drawing the window frame
     * can wander off the edge of.
     *
     * The greying is the cut a card already makes, from the same number rather
     * than a second copy of it: past it a card stops building rows and stands
     * as a block, and a diagram whose every node is a word is in exactly that
     * position — a picture nobody can read, laid out and painted on every frame
     * of every pan.
     *
     * Driven on a change whose cut is 0.403: fitted at 0.04 the pin drew a grey
     * shape and no diagram while the cards drew no rows; closed in to 0.80 the
     * diagram was there and the shape gone, with 676 rows on the cards. The map
     * carried the pin at both.
     */
    const pinned = source("canvas/Pinned.svelte");
    expect(pinned).toMatch(/const legible = \$derived\(legibleAt\(model\.current\.charWidth\)\)/);
    expect(pinned).toMatch(/const far = \$derived\(view\.scale < legible\)/);
    expect(pinned).toMatch(/\{#if far\}\s*\n\s*<div class="pin-shape"/);
    // One answer, shared: the card asks the same question at the same moment.
    expect(source("canvas/Card.svelte")).toMatch(/legibleAt\(model\.current\.charWidth\)/);
    expect(source("canvas/Card.svelte")).not.toMatch(/const GLYPH = 3/);

    const minimap = source("hud/Minimap.svelte");
    expect(minimap).toMatch(/bounds\(\[\.\.\.visible, \.\.\.pinned\]/);
    expect(minimap).toMatch(/<rect class="map-pin"/);
    // Neutral, because the file rectangles carry the statuses and a fifth
    // colour among them reads as a fifth thing that can happen to a file.
    expect(minimap).toMatch(/\.map-pin \{[\s\S]{0,160}?fill: color-mix\(in srgb, var\(--text\)/);
  });

  it("hands the markdown for a drawing to the editor's clipboard", () => {
    /*
     * What comes off the button is meant to be pasted somewhere — a pull
     * request description, an issue, a document — and all of those render a
     * fenced block while none render a loose `graph TD`.
     *
     * Through the host, because a webview's own clipboard is refused often
     * enough, and silently enough, that the button would do nothing more often
     * than it worked. Driven: the click sent the source wrapped in a mermaid
     * fence, and the bar said "copied".
     */
    const pinned = source("canvas/Pinned.svelte");
    expect(pinned).toMatch(/notify\("copyText", \{/);
    expect(pinned).toMatch(/mermaid\\n\$\{one\.code\}/);
    const host = readFileSync(
      new URL("../../vscode-ext/src/panel.ts", import.meta.url),
      "utf8",
    );
    expect(host).toMatch(
      /message\.type === "copyText"[\s\S]{0,300}?vscode\.env\.clipboard\.writeText\(text\)/,
    );
  });

  it("keeps a drawing on the change when one is dropped there", () => {
    /*
     * A picture answers "how is this put together", and the answer belongs
     * beside the code it is about rather than at the bottom of a log that
     * scrolls away. Dragging one out of a terminal pins it to the drawing in the
     * drawing's own coordinates, so it stays with the cards it was put next to
     * however the camera moves, and stays until it is thrown away.
     *
     * Driven end to end: the block came out of the log carrying its source, the
     * canvas accepted the drop, the pin landed at 520,335 and drew its own SVG,
     * dragging its bar moved it by exactly the drag (80,60), the corner grew it
     * by exactly (100,100), the host was sent one diagram to remember, and the
     * cross took it away. A page opened with one already in its settings drew it
     * at 140,90 at 380x240.
     */
    const canvas = source("canvas/Canvas.svelte");
    const pinned = source("canvas/Pinned.svelte");
    const camera = source("canvas/camera.svelte.ts");

    // What travels is the source, not the picture: the drop redraws it at the
    // size it lands at, which is what lets it be resized without going fuzzy.
    expect(source("panels/Diagram.svelte")).toMatch(/setData\("application\/odin-diagram", code\)/);
    expect(canvas).toMatch(/getData\("application\/odin-diagram"\)/);
    // Refusing the default is what makes the canvas a place a thing can land.
    expect(canvas).toMatch(/ondragover[\s\S]{0,400}?event\.preventDefault\(\)/);

    // The camera does the conversion, because the camera is what knows the
    // transform: a drop at a window point is a place in the drawing.
    expect(camera).toMatch(/export function pin\(code: string, clientX: number, clientY: number\)/);
    expect(camera).toMatch(/const x = Math\.round\(\(clientX - view\.x\) \/ view\.scale\)/);

    // Moving and stretching are in canvas units too, or a drag at a tenth of
    // life size would move it a tenth as far as the pointer went.
    expect(pinned).toMatch(/const dx = \(event\.clientX - holding\.x\) \/ view\.scale/);
    // Inside the transformed layer, or it would stand still while the drawing
    // moved under it.
    expect(canvas).toMatch(/<EdgeLayer[\s\S]{0,400}?<Pinned \/>/);
    // Kept with the reader's other choices, which is what the host stores —
    // filed under the reading, because a picture dropped beside a card is about
    // the change it was dropped on. Kept in one list, the diagrams from one
    // pull request turned up over the cards of the next.
    expect(pinned).toMatch(/pinHere\(pinnedHere\(\)\.filter/);
    const pins = source("canvas/pins.ts");
    expect(pins).toMatch(/return all\[model\.current\.review\] \?\? \[\]/);
    expect(pins).toMatch(/settings\.diagrams = \{ \.\.\.held, \[model\.current\.review\]: diagrams \}/);
    // The old shape is exactly the mis-filed data, so it is dropped rather than
    // handed to whichever reading opens first.
    expect(pins).toMatch(/Array\.isArray\(all\) \? \{\} : all/);

    /*
     * And written down once, when the drag ends.
     *
     * Every write to the reader's settings is posted to the host and put in the
     * editor's storage, so moving this by writing the position on each pointer
     * event was a message and a disk write per frame — for a number that is
     * wrong a sixtieth of a second later. Driven with twenty moves: nothing
     * saved during the drag, one save after it, and the box followed the
     * pointer exactly (100, 60).
     */
    expect(pinned).toMatch(/let live = \$state<\{ x: number; y: number; width: number; height: number \} \| null>/);
    expect(pinned).toMatch(/if \(live\) change\(holding\.id, live\)/);
  });

  it("draws what an agent draws, and only when there is something to draw it with", () => {
    /*
     * Asked how something is put together, these tools answer in mermaid — a
     * graph written down as text. Printed as a fence it is readable and it is
     * not the thing that was communicated.
     *
     * Driven in the console: a `graph TD` block came back as a 328x210 drawing
     * carrying its four labels, with the prose either side of it untouched, and
     * one script fetched for the whole page. With the renderer's address absent
     * — the file `odin view` writes, which has no extension beside it — the same
     * block stayed the text it was.
     */
    // The rule lives in the parser rather than in the component that draws it:
    // the markdown a review is written in is the same markdown everywhere, and
    // it is worth being able to test without a browser to render it in.
    expect(source("panels/markdown.ts")).toMatch(/if \(lang === "mermaid"\)/);
    expect(source("panels/Diagram.svelte")).toMatch(/if \(loading\) return loading/);
    expect(source("panels/Diagram.svelte")).toMatch(/class="diagram-source"/);
    // Named in the document, fetched only when a diagram appears: three and a
    // half megabytes that most readings never use.
    const html = readFileSync(new URL("../src/html.ts", import.meta.url), "utf8");
    expect(html).toMatch(/mermaid\?: string/);
    expect(html).toMatch(/script-src 'nonce-\$\{csp\.nonce\}' \$\{csp\.source\}/);
  });

  it("keeps Odin's own notes out of the agent's prose", () => {
    /*
     * The invocation and the could-not-resume line are Odin talking about the
     * agent, not the agent talking. They went through the markdown renderer
     * with everything else — and markdown joins adjacent lines into one
     * paragraph, so a note landed mid-sentence in the agent's text, in the
     * same weight and colour, reading as something it had said.
     */
    expect(terminal).toMatch(/startsWith\("\[odin\]"\)/);
    expect(terminal).toMatch(/<p class="note">/);
    // And the prose still goes through the renderer, per block.
    expect(terminal).toMatch(/<Editor readonly value=\{block\.text\}/);
  });

  it("puts the reader's own question in the log, with their face on it", () => {
    /*
     * A terminal that opens with an invocation and runs to eight paragraphs of
     * answer is missing the question — and the question is the one thing in it
     * the reader wrote.
     */
    expect(terminal).toMatch(/\[odin:ask \(-\?\\d\+\)\\\]/);
    expect(terminal).toMatch(/class="asked"/);
    expect(terminal).toMatch(/asked-face/);
  });

  it("takes the reader back to the conversation, the way the list does", () => {
    /*
     * Two halves, and the first was missing. Naming the thread opens it where
     * its mark already is; the camera has to be asked separately to go there.
     * Without the flight, pressing a question in a log about a file on the far
     * side of the drawing opened a conversation nobody could see.
     *
     * Checked against the list of threads rather than in the abstract: they
     * should do the same thing, and the day one of them changes the other
     * should have to change with it.
     */
    const list = source("panels/Reviewers.svelte");
    for (const side of [terminal, list]) {
      expect(side).toMatch(/showRemark\(\s*[\w.]+\.path,\s*[\w.]+\.line,\s*sideOf\(/);
    }
    // The flight first, so the panel waits for it to land and appears where
    // the mark finally is rather than where it was as the drawing set off.
    expect(terminal).toMatch(
      /showRemark\([\s\S]{0,160}?ui\.thread = \{ id: root\.id, anchor: null \}/,
    );
  });

  it("gives the log one thing to scroll", () => {
    /*
     * A comment renders each fenced block in its own horizontal scroller, which
     * is right there — a suggestion is code, and code read beside code has to
     * keep its columns. Stacked in a log those became independent sideways
     * contexts with unscrollable prose wedged between them: dragging one left
     * the next where it was, and reading one wide line meant finding and
     * dragging each in turn.
     */
    expect(terminal).toMatch(/\.rendered pre\)[\s\S]{0,200}?white-space: pre-wrap/);
    // And the box itself has no sideways axis. With one, dragging right moved
    // the prose and the notes while the code — which clips rather than scrolls
    // — stayed exactly where it was.
    expect(terminal).toMatch(/overflow-y: auto;\s*\n\s*overflow-x: hidden;/);
  });

  it("gives the log one scroller, not one per answer", () => {
    /*
     * Declaring `overflow-x: hidden` makes an element a scroll container — the
     * spec forces the other axis to `auto` alongside it. So the rules meant to
     * stop sideways scrolling gave every block in the log its own scrollable
     * box, clipped top and bottom, moving independently of the one above it.
     *
     * Wrapping is enough on its own: content that cannot exceed the width has
     * nothing to scroll, and an element with no overflow of its own is not a
     * container to begin with.
     */
    /*
     * The cap is the whole of it. A comment renders inside a box limited to a
     * fraction of the viewport with its own scrollbar — right there, where one
     * long remark must not swallow the thread around it. In a log every answer
     * became a scrollable window of its own.
     */
    expect(source("panels/Editor.svelte")).toMatch(/\.rendered \{[\s\S]{0,120}?max-height:/);
    expect(terminal).toMatch(
      /\.terminal-body :global\(\.rendered\) \{[\s\S]{0,120}?max-height: none;[\s\S]{0,60}?overflow: visible/,
    );
    expect(terminal).toMatch(/\.rendered pre\)[\s\S]{0,300}?white-space: pre-wrap/);
    // The body keeps its own, and it is the only one.
    expect(terminal).toMatch(/overflow-y: auto;\s*\n\s*overflow-x: hidden;/);
  });

  it("offers to ask again only where a turn never finished", () => {
    // `stopped` is something ending it from outside; `failed` is the tool
    // coming back with nothing. Both leave a question with no answer under it.
    expect(terminal).toMatch(/task === "stopped" \|\| task === "failed"/);
    expect(terminal).toMatch(/notify\("askAgents", \{[\s\S]{0,300}?inReplyTo: Number\(root\.id\)/);
  });

  it("marks a question whose turn never finished", () => {
    /*
     * Blue-green is this page's "you can press this" colour and it was the rail
     * on every question in the log, finished or not — so a turn stopped halfway
     * looked exactly like one that answered. Measured: a stopped question rails
     * red rgb(248, 113, 113), a finished one keeps green rgb(0, 124, 54).
     */
    expect(terminal).toMatch(/class:unfinished=\{unfinished\(block\.thread\)\}/);
    expect(terminal).toMatch(/\.asked\.unfinished \{[\s\S]{0,120}?border-left-color: var\(--removed/);
  });

  it("says retry with a mark rather than a sentence", () => {
    // A log is narrow and its questions are long: a button spelling "Ask again"
    // took a third of the row and pushed the question onto a second line. The
    // words move to the tooltip. Measured 22x22, and pressing it re-asks.
    expect(terminal).toMatch(/class="asked-again"[\s\S]{0,300}?aria-label="Ask again"/);
    expect(terminal).toMatch(/\.asked-again \{[\s\S]{0,300}?width: 22px;\s*\n\s*height: 22px/);
    // The mark and nothing else inside it.
    expect(terminal).toMatch(/<\/svg>\s*\n\s*<\/button>/);
  });

  it("keeps the retry on the question's own line", () => {
    /*
     * It used to hang under the quote as a row of its own, which read as a
     * third thing in the log rather than as part of the question — and left a
     * gap under every unfinished turn. Measured: same row, against the far end.
     */
    expect(terminal).toMatch(/<div class="ask-row">[\s\S]{0,600}?class="asked"/);
    expect(terminal).toMatch(/\.ask-row \{[\s\S]{0,140}?display: flex/);
    // The quote takes the room and the retry takes what it needs, or a long
    // question pushes the button off the end of the box.
    expect(terminal).toMatch(/\.asked \{[\s\S]{0,220}?flex: 1 1 auto;[\s\S]{0,60}?min-width: 0/);
    expect(terminal).toMatch(/\.asked-again \{[\s\S]{0,140}?flex: 0 0 auto/);
  });

  it("draws the working-out apart from the answer", () => {
    /*
     * A turn is two kinds of thing in one stream: what the agent was thinking
     * and what it ran, then what it says. Both were rendered as markdown in the
     * same face at the same size, so a page of a turn read as one long
     * statement in which `Bash(cd /Users/…)` was a sentence.
     *
     * Driven: four steps in the rail — two lines of one thought and two tool
     * calls — dim monospace at 10px; the answer beside them at 11px in the
     * text colour, with no tool call anywhere in it.
     */
    expect(terminal).toMatch(/const WORKING = \/\^\\s\*\(…\|→\) \//);
    expect(terminal).toMatch(/\{:else if block\.kind === "work"\}/);
    // Not through the markdown renderer: this is commands and half-formed
    // reasoning, and a parser turns an underscore in a path into emphasis.
    expect(terminal).toMatch(/<p class="step">\{line\.replace\(/);
    expect(terminal).toMatch(/\.step \{[\s\S]{0,200}?font-family: var\(--mono\)/);
    // Neutral, because this page's action colour is the green that means
    // "added", and a rail in it reads as a verdict on unfinished work.
    expect(terminal).toMatch(/\.work \{[\s\S]{0,300}?border-left: 2px dotted color-mix\(in srgb, var\(--text\)/);
  });

  it("marks every line of a thought, not only its first", () => {
    // A page of reasoning marked once at the top is one marked line followed by
    // a dozen that look exactly like the answer, and nothing reading it back
    // can tell where the thinking stopped.
    const stream = readFileSync(
      new URL("../../core/src/agents/stream.ts", import.meta.url),
      "utf8",
    );
    expect(stream).toMatch(/for \(const line of part\.thinking\.trim\(\)\.split\("\\n"\)\) \{\s*\n\s*said\.push\(`… \$\{line\}`\)/);
  });

  it("opens the conversation a line of the log came from, from any tab", () => {
    /*
     * Three separate reasons this did nothing, all of which looked the same
     * from outside: the camera flew to the line and no panel appeared.
     *
     * The id: a log writes `[odin:ask -1]`, so it arrives as a number, and the
     * mark in the margin holds whatever id the host sent. `one.id === thread.id`
     * was comparing across types, the mark never handed over its rectangle, and
     * a conversation without one does not open. Taken off the thread's own root
     * now, so it is the same value by construction — and the root, because a
     * log's message is often a reply to a thread that started further up.
     *
     * The click: the page puts an open thread away on any click that did not
     * land inside it, and it saw this one a moment after the thread opened. The
     * panel appeared and vanished inside one gesture.
     *
     * The tab: a part showing 21 of 54 files has no card for a file outside it,
     * so there was nothing to fly to. Driven from a sub-graph tab: the tab gave
     * way to the whole change, the host was told, and the conversation opened.
     */
    expect(terminal).toMatch(/const conversation = threadsOf\(model\.current\.comments \?\? \[\]\)/);
    expect(terminal).toMatch(/ui\.thread = \{ id: root\.id, anchor: null \}/);
    expect(terminal).toMatch(/onclick=\{\(event\) => \{[\s\S]{0,700}?event\.stopPropagation\(\);\s*\n\s*if \(block\.thread !== undefined\) goTo\(block\.thread\)/);

    const camera = source("canvas/camera.svelte.ts");
    expect(camera).toMatch(/if \(!card && ui\.part && model\.current\.nodes\.some\(\(node\) => node\.path === path\)\)/);
    // The list beside the canvas follows the canvas, or it goes on showing the
    // files of a part the drawing has just left.
    expect(camera).toMatch(/ui\.part = null;[\s\S]{0,200}?notify\("part", \{ paths: null \}\)/);
  });

  it("gives the logs the room that is actually free", () => {
    /*
     * The column was capped at `100vh - 140px`, which is a guess and wrong in
     * both directions: with nothing else on that side the logs ran to within a
     * few pixels of the bar, and with the list of threads open they grew
     * straight up into it.
     *
     * Measured against the furniture instead. Driven in an 813px viewport: with
     * the list of threads on screen the column was capped at 649px — it ends
     * where the list begins — and with the list gone it took 701px, the room
     * under the bar. Both leave the same margin at the foot.
     */
    const dock = source("hud/Terminals.svelte");
    expect(dock).toMatch(/const ABOVE = "\.reviewers, \.checks-panel, \.pairing-panel, \.chrome"/);
    // Only what stands over this column: the map and the file list are fixed to
    // the other side, and a page-wide maximum would have them pushing a column
    // they are nowhere near.
    expect(dock).toMatch(/if \(box\.right <= left \|\| box\.left >= right\) continue/);
    // A panel that grows where it stands moves its own bottom edge without the
    // document changing at all, so sizes are watched as well as existence.
    expect(dock).toMatch(/sizes\?\.disconnect\(\);\s*\n\s*for \(const panel of standing\) sizes\?\.observe\(panel\)/);
    expect(dock).toMatch(/new MutationObserver\(later\)/);
  });

  it("opens a folded log from anywhere on its bar", () => {
    /*
     * Folded, the bar is all that is left on screen — so asking a reader to
     * find a ten-pixel chevron on it is a target the size of the thing itself
     * minus everything else. And the chevron points up: it says where the press
     * goes, not where the box is, and pointing down at a strip with nothing
     * under it read as "there is more below".
     *
     * Driven: pressed the bar and the log came back, pressed the chevron and it
     * folded again, pressed the cross and it closed — the buttons on the bar
     * are still their own presses rather than being swallowed by it.
     */
    expect(terminal).toMatch(/class:pressable=\{folded\}/);
    expect(terminal).toMatch(/if \(!folded\) return;[\s\S]{0,300}?closest\?\.\("button, input"\)/);
    expect(terminal).toMatch(/d="M4 10 8 6 12 10"/);
    expect(terminal).toMatch(/\.terminal-head\.pressable \{\s*\n\s*cursor: pointer/);
  });

  it("does not re-parse the log for every chunk that arrives", () => {
    /*
     * Chunks arrive by the hundred. Feeding the stream straight to a markdown
     * renderer would re-parse the whole log and ask the host to colour every
     * fenced block in it again, per chunk — for the minutes a turn takes.
     */
    expect(terminal).toMatch(/let shown = \$state\(""\)/);
    expect(terminal).toMatch(/setTimeout\(/);
    expect(terminal).toMatch(/const blocks = \$derived\.by/);
  });

  it("keeps the terminals working when the panel is closed", () => {
    /*
     * Closing a panel is closing a panel, not switching the feature off — and
     * it was switching the feature off. Discovery waited for the panel to be on
     * screen, so a reader who closed it and reloaded got a window where nothing
     * had ever looked for an agent: the page knew of none, and every open
     * terminal is drawn for an agent the page knows about, so the terminals
     * went with it.
     *
     * Driven both ways, on a page with the panel closed and one terminal open:
     * with the old condition the page never asked (`discoverAgents` unsent);
     * with this one it asked, the answer arrived, and Claude's terminal drew
     * itself with the panel still shut.
     */
    expect(pairing).toMatch(/\$effect\(\(\) => \{\s*\n\s*if \(!live\) return;/);
    expect(pairing).not.toMatch(/if \(!live \|\| !settings\.hud\.agents\) return/);
    // And the terminals never depended on the panel to begin with: they are
    // drawn from what is open and what exists.
    expect(source("hud/Terminals.svelte")).toMatch(/\{#if live && open\.length > 0\}/);
    expect(source("hud/Terminals.svelte")).not.toMatch(/hud\.agents/);
  });

  it("says in green which reading is the live one", () => {
    /*
     * The tab carries the same word and cannot carry the colour — an editor tab
     * is plain text — so the bar is where it can be obvious. Green because this
     * is the reading that follows the reader's own typing, in the same green
     * everything added to the change is drawn in.
     *
     * Measured on a live reading: ink rgb(11, 42, 18) on rgb(74, 222, 128),
     * beside the title. On a reading of the forge's copy there is no badge.
     */
    const bar = source("chrome/PrBar.svelte");
    expect(bar).toMatch(/\{#if meta\?\.worktree\}[\s\S]{0,300}?class="tag live"/);
    expect(bar).toMatch(/\.tag\.live \{[\s\S]{0,200}?background: var\(--added/);
  });

  it("offers the agents only over a reading of the files on disk", () => {
    // An agent changes the working tree. Over a reading of the forge's copy it
    // would be editing a checkout the reader is not looking at.
    expect(pairing).toMatch(/model\.current\.meta\.worktree === true/);
    expect(composer).toMatch(/model\.current\.meta\.worktree === true/);
  });

  it("keeps asking an agent separate from writing a review", () => {
    // The same passage is worth both — a note for whoever reads this later,
    // and a message to somebody about to change it — and a box that guessed
    // would post half of them to the wrong place.
    expect(composer).toMatch(/notify\("askAgents"/);
    expect(composer).toMatch(/class="composer-add primary"/);
  });

  it("gives the rung tags room around the word", () => {
    /*
     * Same fault as the labels in a thread: at `0 4px` the letters sat against
     * the ends and it read as a highlight over the text rather than a label.
     * The right side is a pixel short of the left on purpose — the
     * letter-spacing leaves a gap after the last letter that the padding then
     * doubles. Measured: 8px before the word, 7px after, 14px tall.
     */
    const panel = source("hud/Pairing.svelte");
    expect(panel).toMatch(/\.agent-agency \{[\s\S]{0,700}?padding: 2px 7px 2px 8px/);
    // An inline box takes no vertical padding at all, and this one is only a
    // block because of the row it happens to sit in.
    expect(panel).toMatch(/\.agent-agency \{[\s\S]{0,900}?display: inline-block/);
  });

  it("will not offer to ask nobody", () => {
    expect(composer).toMatch(/settings\.pairing \?\? \[\]\)\.length > 0/);
  });
});

/**
 * A reply in a conversation the forge has never heard of.
 *
 * These threads carry ids of our own, and the forge refuses an id it never
 * issued — but only after the reader has written the reply and pressed the
 * button. What came back was "Parent comment not found (HTTP 404)" with the
 * text gone.
 */
describe("answering a local thread", () => {
  const thread = source("panels/Thread.svelte");

  it("shows a remark whole, however long it is", () => {
    /*
     * The renderer caps its box at a fraction of the viewport and scrolls
     * inside it — one answer to a long comment, and the wrong one here. It puts
     * a second scrollbar inside a panel that already scrolls, so a reader
     * dragging down the thread stops dead in the middle of a remark and has to
     * find the inner one.
     */
    expect(thread).toMatch(
      /\.text :global\(\.rendered\) \{[\s\S]{0,120}?max-height: none;[\s\S]{0,60}?overflow: visible/,
    );
  });

  it("offers to ask again where the turn never finished", () => {
    // Here as well as in the terminal: a reader looking at a remark marked
    // "stopped" is already looking at the thing they would retry.
    expect(thread).toMatch(/comment\.task === "stopped" \|\| comment\.task === "failed"/);
    // And it quotes the remark rather than anything typed here, same as the
    // terminal — the question was recorded when it was first written.
    expect(thread).toMatch(/function askAgain[\s\S]{0,400}?body: root\.body/);
  });

  it("sets the retry like the labels it sits under", () => {
    // It belongs to the same row of small facts about this remark — "local",
    // "stopped" — and a lowercase pill among uppercase ones reads as a
    // different kind of thing. Measured: uppercase, 78x17.
    expect(thread).toMatch(/\.again \{[\s\S]{0,600}?text-transform: uppercase/);
  });

  it("puts it under the question rather than in the row of labels", () => {
    /*
     * The head is author, time, "local", "stopped" — a row that says what this
     * remark is, and a thing you press is not one of those. It also shoved the
     * labels sideways as it came and went. Under the text it reads in order:
     * the question, then the one thing to do about it.
     */
    expect(thread).toMatch(/<div class="after">\s*\n\s*<button\s*\n\s*class="again"/);
    // Ordering rather than adjacency: what matters is that the button comes
    // after the remark's text and not in the head above it.
    const head = thread.indexOf('<div class="head">');
    const text = thread.indexOf('<div class="text">');
    const after = thread.indexOf('<div class="after">');
    expect(head).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(text);
    expect(text).toBeGreaterThan(head);
  });

  it("opens at what the agent said when its face is pressed", () => {
    /*
     * The badge on a mark reports what an agent is doing, and readers press
     * faces. Pressing it opens the same conversation the mark does — there is
     * only one — but at the end of it: somebody pressing an agent's face is
     * asking what it said, and the top of the thread is their own question.
     *
     * Measured: opened from the mark the box sits at 0 with 799 to scroll;
     * opened from the face it sits at 505, with the agent's last remark 6px
     * below the top edge. Not simply the bottom — there was a longer remark of
     * the reader's under it.
     */
    const mark = source("marks/Mark.svelte");
    expect(mark).toMatch(/class="agent"[\s\S]{0,400}?onclick=\{pressAgent\}/);
    // The word beside it stays a report, and the row stays transparent to the
    // pointer, or the badge swallows clicks meant for the drawing under it.
    expect(mark).toMatch(/\.doing \{[\s\S]{0,400}?pointer-events: none/);
    expect(mark).toMatch(/\.doing \.agent \{[\s\S]{0,700}?pointer-events: auto/);
    // The mark's own press must not fire as well, or the thread opens twice
    // and the second one wins — at the top.
    expect(mark).toMatch(/function pressAgent[\s\S]{0,120}?event\.stopPropagation\(\)/);

    expect(source("marks/Marks.svelte")).toMatch(/at: "agent"/);
    expect(thread).toMatch(/const said = \[\.\.\.thread\.comments\]\.reverse\(\)\.find\(\(comment\) => comment\.agent\)/);
    /*
     * Measured against the box rather than handed to `scrollIntoView`, which
     * may scroll every scrollable ancestor: this box floats over a canvas that
     * is itself pannable, and the drawing sliding out from under the thread is
     * not what was asked for.
     */
    expect(thread).not.toMatch(/scrollIntoView\(/);
    expect(thread).toMatch(/box\.scrollTop \+= found\.getBoundingClientRect\(\)\.top/);
    // And when there is nothing of the agent's drawn yet, the newest thing in
    // the conversation is still the right place to be.
    expect(thread).toMatch(/box\.scrollTop = box\.scrollHeight/);
  });

  it("says a turn is running by turning, not by saying so", () => {
    /*
     * The word is set in a fraction of the mark's size, which is unreadable on
     * a drawing fitted to the window — exactly when a reader is scanning to see
     * what is happening. A ring around the face reads at any zoom.
     *
     * Driven over three conversations at once: `working` drew a ring 23px
     * across a 17px face with the rotation running and no word; `asking you`
     * and `failed` kept their words and drew no ring — neither is motion, and
     * both are things to read.
     */
    const mark = source("marks/Mark.svelte");
    expect(mark).toMatch(/const turning = \$derived\([\s\S]{0,140}?"working" \|\| working\?\.task === "queued"/);
    expect(mark).toMatch(/\{#if !turning\}\s*\n\s*<span class="says">/);
    expect(mark).toMatch(/\{#if turning\}[\s\S]{0,300}?<svg class="ring"/);
    // The badge no longer breathes underneath it: one fact, said once.
    expect(mark).not.toMatch(/\.doing\.working,\s*\n\s*\.doing\.queued \{\s*\n\s*animation: mark-breathing/);
    // Rotating one node, not animating a dash — nothing recomputes a path per
    // frame, and the whole thing is one transform the compositor can carry.
    expect(mark).toMatch(/@keyframes agent-turning \{[\s\S]{0,120}?rotate\(360deg\)/);
    expect(mark).toMatch(/stroke-dasharray: 22 66/);
    // Less motion is not less information: the ring stops and stays broken.
    expect(mark).toMatch(/prefers-reduced-motion: reduce\) \{\s*\n\s*\.doing \.ring \{\s*\n\s*animation: none/);
  });

  it("marks a task the moment it is placed, before anybody has taken it", () => {
    /*
     * The badge used to need an owner, and an owner is the last thing to
     * arrive: a message that has been written and not yet taken is `queued`,
     * and one taken a moment ago has an owner the page has not been told about
     * yet. So a reader who had just asked for something saw nothing at all in
     * the margin until the agent's first word came back — measured: badge
     * count 0 with the task marked `working` and no owner known, 1 once the
     * owner arrived.
     *
     * The state is the news. Whose it is arrives with it or shortly after, and
     * until then the badge wears a plain ring rather than a face.
     */
    const marks = source("marks/Marks.svelte");
    expect(marks).toMatch(/\{ agent\?: string; task: string \} \| null/);
    expect(marks).toMatch(/return \{ \.\.\.\(owner \? \{ agent: owner \} : \{\}\), task: asked\.task \}/);
    expect(marks).not.toMatch(/if \(!owner\) return null/);

    const mark = source("marks/Mark.svelte");
    expect(mark).toMatch(/\{#if working\.agent\}[\s\S]{0,200}?\{:else\}[\s\S]{0,200}?class="nobody"/);
    // And it says so in words, for the reader who hovers rather than decodes.
    expect(mark).toMatch(/"Waiting for an agent to take this"/);
  });

  it("turns in the colour of the state it is reporting", () => {
    /*
     * A button does not inherit `color` — it takes the browser's own, which
     * here is near-white — and everything inside this one is drawn in
     * `currentColor`: the turning ring, and the ring the face wears once the
     * turn is over. So the badge said amber in its word and drew a white circle
     * beside it, and "done" and "asking you" wore white rings too.
     *
     * Measured across three conversations at once: working amber
     * rgb(226, 179, 65) on both the badge and its ring, done green
     * rgb(74, 222, 128), asking blue rgb(74, 163, 255).
     */
    const mark = source("marks/Mark.svelte");
    expect(mark).toMatch(/\.doing \.agent \{[\s\S]{0,600}?color: inherit/);
    expect(mark).toMatch(/\.doing \.ring \.run \{[\s\S]{0,120}?stroke: currentColor/);
  });

  it("does not send a local reply to the forge", () => {
    // The two ways out of `send` are chosen by whether the thread is local,
    // which is a fact about its root rather than about any remark in it.
    expect(thread).toMatch(/const local = \$derived\(thread\?\.root\.local === true\)/);
    expect(thread).toMatch(/if \(local\)/);
  });

  it("sends it to the agent working in that thread", () => {
    // Not merely "post it locally": a reply here is the next thing said to the
    // agent that claimed the conversation, which is what asking does.
    expect(thread).toMatch(/notify\("askAgents", \{/);
    expect(thread).toMatch(/inReplyTo: thread\.root\.id/);
  });

  it("keeps the forge's actions off a local remark", () => {
    expect(thread).toMatch(/notify\(local \? "deleteLocal" : "deleteComment"/);
    expect(thread).toMatch(/notify\(local \? "editLocal" : "editComment"/);
    // Reactions live on a comment the forge issued an id for. There is nowhere
    // to put one on a remark it has never seen.
    expect(thread).toMatch(/class:none=\{local\}/);
  });
});

/**
 * One slot, two tenants.
 *
 * A webview keeps exactly one piece of state across a reload. Two things want
 * it: the camera, so a reader comes back to the cards they were reading, and
 * the reading itself, so the host can tell one restored frame from another.
 *
 * Written whole by both, each quietly replaced the other — the camera lost its
 * place every time an agent changed a file and the graph was rebuilt, throwing
 * the reader across the drawing, and the frame lost the note saying which
 * change it held. Neither failure said anything.
 */
describe("what a frame remembers across a reload", () => {
  const state = source("state.svelte.ts");
  const camera = source("canvas/camera.svelte.ts");

  it("merges into the slot rather than replacing it", () => {
    expect(state).toMatch(/export function keep\(part: Record<string, unknown>\)/);
    expect(state).toMatch(/host\.setState\(\{ \.\.\.held, \.\.\.part \}\)/);
  });

  it("lets nobody but the shared keeper write the slot", () => {
    // The whole failure was two callers each writing the whole thing.
    const writers = [state, camera, source("hud/Terminal.svelte")];
    for (const who of writers) {
      const direct = who.match(/host[?.]*\.setState\(/g) ?? [];
      // The one inside `keep` is the exception, and it lives in state.
      expect(direct.length).toBeLessThanOrEqual(who === state ? 1 : 0);
    }
  });

  it("gives each tenant its own name", () => {
    expect(state).toMatch(/keep\(\{ reading: /);
    expect(camera).toMatch(/keep\(\{\s*\n?\s*camera:/);
    expect(camera).toMatch(/held<Partial<SavedCamera>>\("camera"\)/);
  });

  it("comes back to the card rather than to the coordinates", () => {
    /*
     * The camera was thrown away whenever the drawing changed size, which is
     * every rebuild that adds a file or makes a card taller — so an agent
     * finishing its work refitted the whole change and left the reader looking
     * at the picture from ten per cent. Driven, with the old refusal put back:
     * scale 0.102 collapsed to 0.04 and the view jumped from (1798, -5127) to
     * (704, -1351). With the card remembered alongside the numbers, the same
     * rebuild moved the drawing 1200 units under the reader and left the card
     * they were on within a pixel of where it was.
     */
    expect(camera).toMatch(/on\?: Held\[\]/);
    expect(camera).toMatch(/const on = middle\(\)/);
    // The scale is theirs and survives a change of shape; only the position has
    // to be worked out again.
    expect(camera).toMatch(/view\.scale = saved\.scale/);
    expect(camera).toMatch(/if \(!\(moved && saved\.on && putBack\(saved\.on\)\)\)/);
  });

  it("keeps their numbers when there is no card left to go back to", () => {
    /*
     * A file an agent renames is a card with a new id, and one it deletes is no
     * card at all — so the card the reader was on is exactly the thing most
     * likely to be missing. Several are kept, nearest first, and the reader
     * falls back to their own coordinates rather than being refitted: a few
     * hundred pixels out is a different order of error from four per cent
     * looking at a change they have read half of.
     *
     * Driven, with the card under the middle deleted from the rebuild: scale
     * stayed at 3 and a neighbour landed where it had been.
     */
    expect(camera).toMatch(/\.slice\(0, 4\)/);
    expect(camera).toMatch(/for \(const held of anchors\)[\s\S]{0,200}?if \(!card\) continue/);
    expect(camera).toMatch(/view\.x = saved\.x \?\? 0/);
  });

  it("follows the settling on a timer rather than by watching the cards", () => {
    /*
     * Reading the placements from an effect that moves the camera is a cycle —
     * which cards are drawn depends on the camera, their measured heights on
     * which were drawn, the placements on those heights. Svelte gave up after a
     * hundred passes and the page stopped answering anything: no wheel, no
     * messages, no rebuilds. Measured before it was believed:
     * `effect_update_depth_exceeded` at boot, on a page that looked fine.
     */
    expect(camera).toMatch(/const AGAIN = \[0, 120, 320, 700, 1200, 2000, 3200\]/);
    expect(camera).toMatch(/following = AGAIN\.map\(\(wait\) => window\.setTimeout\(keepPlace, wait\)\)/);
    expect(source("canvas/Canvas.svelte")).toMatch(/untrack\(\(\) => camera\.start\(element\)\)/);
    expect(source("canvas/Canvas.svelte")).not.toMatch(/untrack\(\(\) => camera\.keepPlace\(\)\)/);
  });

  it("holds that place across a rebuild the page applies to itself", () => {
    // The other half: a model swapped in place, or a card's rows patched, moves
    // every card under it. Taken before the model is assigned, because where
    // the reader is has to be read against the arrangement they were in.
    expect(state).toMatch(/rebuilding\.before\?\.\(\);\s*\n\s*model\.current = next/);
    expect(state).toMatch(/if \(patches\.length > 0\) rebuilding\.before\?\.\(\)/);
    expect(camera).toMatch(/rebuilding\.before = holdPlace/);
    // And let go the moment the reader moves the drawing themselves.
    expect(camera).toMatch(/export function letGo/);
    for (const move of ["beginPan", "wheel"]) {
      expect(camera).toMatch(new RegExp(`export function ${move}[\\s\\S]{0,400}?letGo\\(\\)`));
    }
  });
});

/**
 * Where the box for a new remark opens.
 *
 * A split card is two checkouts side by side. The box hung off the card's left
 * edge whichever side the remark was about, so writing about a line on the
 * right began under the other pane entirely — pointing, as far as the eye is
 * concerned, at the code it is not about.
 */
describe("writing about a line on the right", () => {
  const composer = source("panels/Composer.svelte");

  it("hangs off the pane the remark is about", () => {
    /*
     * Driven: picked a head-side line on a split card and the box opened at
     * 764, which is the head pane's own left edge — 2394px in from the card's.
     */
    expect(composer).toMatch(/row\.classList\.contains\("split"\)[\s\S]{0,200}?\.side\.\$\{sideOf\(where\.side\)\}/);
    expect(composer).toMatch(/Math\.round\(placed\.pane\?\.left \?\? placed\.card\.left\)/);
    // As wide as what it hangs from, so a box on one pane does not run across
    // the other.
    expect(composer).toMatch(/Math\.min\(placed\.pane\?\.width \?\? placed\.card\.width, 680\)/);
  });

  it("marks the one button that does not go to the forge", () => {
    /*
     * Everything else on this box posts to the pull request. "Ask agents" sends
     * the passage to a tool on this machine and what comes back stays there, so
     * it is purple and carries a mark — read before any label is.
     *
     * Scoped under `.composer-actions`, because the shared rule for the row is
     * two classes deep and quietly won: measured, the button came out the same
     * grey as "Cancel" until the selector matched it. With it, ink
     * rgb(163, 113, 247) and a 55% edge of the same.
     */
    expect(composer).toMatch(/class="composer-ask"[\s\S]{0,600}?<svg class="sparks"/);
    expect(composer).toMatch(/\.composer-actions \.composer-ask \{[\s\S]{0,200}?var\(--ai, #a371f7\)/);
  });

  it("draws the three buttons at one height", () => {
    // Sized by their text, "Ask agents" and "Start a review" wrapped onto two
    // lines on a narrow card and grew, leaving "Cancel" short beside them.
    // Measured after: 26, 26, 26.
    expect(composer).toMatch(/\.composer-actions \{[\s\S]{0,300}?align-items: stretch/);
    expect(composer).toMatch(/\.composer-actions button \{[\s\S]{0,400}?min-height: 26px/);
    expect(composer).toMatch(/\.composer-actions button \{[\s\S]{0,400}?white-space: nowrap/);
  });

  it("leaves a card with one column where it was", () => {
    // A unified reading has one column carrying both numberings, and a
    // one-sided file has a single pane at the card's own edge. Neither is
    // `.row.split`, so neither is moved.
    expect(composer).toMatch(/\? row\.querySelector<HTMLElement>\(/);
    expect(composer).toMatch(/: null;/);
  });
});

/**
 * The queue, where somebody watching an agent work is actually looking.
 *
 * The terminal said what was running and nothing about what was stacked behind
 * it, so four questions asked in a row looked exactly like one — and the only
 * way to take one back was to let it run.
 */
describe("the messages waiting behind the one being worked on", () => {
  const terminal = source("hud/Terminal.svelte");

  it("shows a message addressed to this agent, and one addressed to nobody", () => {
    // An unaddressed message goes to whoever is free first, which is not
    // knowable until it happens, so every terminal shows it: any of them may
    // be the one that takes it.
    expect(terminal).toMatch(
      /ui\.queued\.filter\(\(ask\) => ask\.addressee === undefined \|\| ask\.addressee === id\)/,
    );
  });

  it("wears the agent's own face, on the colour for work not started", () => {
    expect(terminal).toMatch(/queued-face[\s\S]{0,200}fill="var\(--warning\)"/);
    expect(terminal).toMatch(/d=\{mark\.path\}/);
  });

  it("offers to take back each one, by itself", () => {
    // Per row rather than per queue: four questions are four things a reader
    // may want back, and one control acting on all of them is a control
    // nobody presses twice.
    expect(terminal).toMatch(/notify\("cancelAsk", \{ id: ask\.id \}\)/);
  });

  it("stands at the foot of the log, under what is running", () => {
    const still = terminal.indexOf('class="still"');
    const render = terminal.indexOf("{@render queue()}", still);
    expect(still).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(still);
  });
});

/**
 * A screenshot pasted into an agent's console.
 *
 * The fastest way to say what is wrong with something drawn — a layout that is
 * off, a chart nobody can read, an error dialog — and every one of these tools
 * can look at one. Pasting did nothing at all before: a textarea takes the text
 * on the clipboard and drops the rest without a word, so the reader pasted, saw
 * an empty box, and could not tell a failure from an empty clipboard.
 */
describe("pasting a picture into the console", () => {
  const terminal = source("hud/Terminal.svelte");

  it("takes pictures off the clipboard", () => {
    expect(terminal).toMatch(/onpaste=\{paste\}/);
    expect(terminal).toMatch(/item\.type\.startsWith\("image\/"\)/);
  });

  it("still pastes text when the clipboard carries both", () => {
    // Copying from a browser gives you text as well as an image. Swallowing
    // the paste outright would have quietly eaten what was typed.
    expect(terminal).toMatch(
      /if \(items\.length === 0\) return;[\s\S]{0,240}event\.preventDefault\(\)/,
    );
  });

  it("shows the picture itself rather than its name", () => {
    // Half the time a clipboard holds the screenshot before last, and a chip
    // saying "pasted.png" cannot tell anybody that.
    expect(terminal).toMatch(/<img src=\{image\.url\} alt=\{image\.name\} \/>/);
  });

  it("offers to take one back before it is sent", () => {
    expect(terminal).toMatch(/onclick=\{\(\) => unpaste\(image\.id\)\}/);
  });

  it("sends the pictures with the words, and empties the strip", () => {
    expect(terminal).toMatch(/\.\.\.\(images\.length > 0 \? \{ images \} : \{\}\)/);
    expect(terminal).toMatch(/pasted = \[\];\s*\n\s*prompt = "";/);
  });

  it("lets a picture be the whole message", () => {
    // "Look at this" is most of what somebody means by pasting a screenshot,
    // and refusing to send without a sentence attached would ask them to type
    // it out.
    expect(terminal).toMatch(/if \(!said && pasted\.length === 0\) return;/);
  });
});

/**
 * A question quoted in a log, drawn as what it is.
 *
 * A question that carries a suggestion is mostly the suggestion, and in the
 * console it arrived as a fenced block with the backticks showing — the one
 * thing in the conversation a reader is most likely to be checking, printed as
 * source. The answer underneath it was already rendered; only the question was
 * not.
 */
describe("a suggestion quoted in the console", () => {
  const terminal = source("hud/Terminal.svelte");

  it("goes through the same renderer as the answer and the composer", () => {
    expect(terminal).toMatch(
      /class="asked-what"><Editor readonly value=\{block\.text\} \/>/,
    );
  });

  it("is no longer printed as the markdown it was written in", () => {
    expect(terminal).not.toMatch(/class="asked-what">\{block\.text\}</);
  });

  it("is still the way back to the conversation", () => {
    // It stopped being a button — a table cannot live inside one — so it has
    // to say what it is and answer a key the way a button would.
    const quoted = terminal.slice(terminal.indexOf('class="asked"\n'));
    expect(quoted).toMatch(/role="button"/);
    expect(quoted).toMatch(/tabindex="0"/);
    expect(quoted).toMatch(/event\.key !== "Enter" && event\.key !== " "/);
  });
});
