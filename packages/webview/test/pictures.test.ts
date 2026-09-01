import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { nameOf, picturesNamed, saidOf } from "../src/app/pictures.js";

const source = (name: string) =>
  readFileSync(new URL(`../src/app/${name}`, import.meta.url), "utf8");

/**
 * A picture Odin can serve, named in a line nobody can act on.
 *
 * A screenshot pasted into a question becomes a file in a temporary folder, and
 * from then on the path is what everything writes down: the remark carries it
 * so an agent can open it, and the agent's log writes it again every time it
 * does. The reader is the one party to that exchange who cannot use a path —
 * they pasted the picture a minute ago and now have a directory name where it
 * used to be.
 */
describe("finding the pictures a line of a log names", () => {
  it("takes the path out of a tool call", () => {
    expect(picturesNamed("→ Read(/var/folders/qz/T/odin-pasted-3f/pasted-1.png)")).toEqual([
      "/var/folders/qz/T/odin-pasted-3f/pasted-1.png",
    ]);
  });

  it("takes it out of a quoted argument", () => {
    expect(picturesNamed('→ Bash(open "/tmp/odin-pasted-a/shot.jpeg")')).toEqual([
      "/tmp/odin-pasted-a/shot.jpeg",
    ]);
  });

  it("takes it out of the markdown a remark carries it as", () => {
    expect(picturesNamed("![pasted image](/tmp/odin-pasted-a/pasted-1.png)")).toEqual([
      "/tmp/odin-pasted-a/pasted-1.png",
    ]);
  });

  it("stops at the sentence a path is written into", () => {
    // A full stop after a filename is punctuation, not part of the name.
    expect(picturesNamed("… wrote it to /tmp/odin-pasted-a/b.png.")).toEqual([
      "/tmp/odin-pasted-a/b.png",
    ]);
  });

  it("names each picture once, however often the line does", () => {
    const line = "→ Read(/tmp/odin-pasted-a/b.png) → Read(/tmp/odin-pasted-a/b.png)";
    expect(picturesNamed(line)).toEqual(["/tmp/odin-pasted-a/b.png"]);
  });

  it("keeps the order they were named in", () => {
    const line = "→ compared /tmp/odin-pasted-a/second.png against /tmp/odin-pasted-a/first.png";
    expect(picturesNamed(line)).toEqual([
      "/tmp/odin-pasted-a/second.png",
      "/tmp/odin-pasted-a/first.png",
    ]);
  });

  it("leaves alone anything that is not a picture", () => {
    expect(picturesNamed("→ Read(/src/main.ts)")).toEqual([]);
    // Greedy matching must not shorten a name until it happens to end in one.
    expect(picturesNamed("→ Read(/src/main.pngx)")).toEqual([]);
  });

  it("leaves alone a path the host could not resolve anyway", () => {
    /*
     * The host is handed the path as written. A relative one would resolve
     * against the editor's own working directory rather than against the
     * checkout the agent is standing in, so asking for it means asking for a
     * file that is absent or, worse, a different one.
     */
    expect(picturesNamed("→ Read(docs/odin.svg)")).toEqual([]);
  });

  it("gives up on a path with a space in it rather than guessing", () => {
    // A path followed by a sentence looks exactly like a path with spaces, and
    // half a path asked for is a refusal with a message sent for it.
    expect(picturesNamed('→ Read("/tmp/odin-pasted-a/my shot.png")')).toEqual([]);
  });

  it("is the file's own name that is shown, not the folder it landed in", () => {
    expect(nameOf("/var/folders/qz/T/odin-pasted-3f/pasted-1.png")).toBe("pasted-1.png");
    expect(nameOf("pasted-1.png")).toBe("pasted-1.png");
  });
});

/**
 * A remark summarised somewhere a picture cannot be drawn.
 *
 * A queued question, a row in the list of threads, a mark's tooltip: each takes
 * the first line of a remark and prints it. A question that is nothing but a
 * pasted screenshot has the markdown for that picture as its only line, so what
 * those places showed was a temporary directory — and for a picture-only
 * question, nothing else at all.
 */
describe("saying what a remark says", () => {
  it("says the picture instead of spelling out where it is", () => {
    expect(saidOf("![pasted image](/var/folders/qz/T/odin-pasted-3f/pasted-1.png)")).toBe(
      "pasted image",
    );
  });

  it("has a word for a picture that was never described", () => {
    expect(saidOf("![](/tmp/odin-pasted-a/b.png)")).toBe("picture");
  });

  it("keeps the words that were written around it", () => {
    expect(saidOf("look at this\n\n![pasted image](/tmp/odin-pasted-a/b.png)")).toBe(
      "look at this\n\npasted image",
    );
  });

  it("leaves a link alone, which is not a picture", () => {
    expect(saidOf("see [the docs](https://example.com/a.png)")).toBe(
      "see [the docs](https://example.com/a.png)",
    );
  });

  it("leaves ordinary prose exactly as it was", () => {
    expect(saidOf("these two files should be one")).toBe("these two files should be one");
  });
});

/**
 * Where the drawing of a picture is wired up.
 *
 * A component cannot be imported here, so what is checked is that each surface
 * that can show a picture asks the same two questions of the same two modules —
 * the point of the exercise being that a picture is a picture everywhere, and
 * that pressing one opens the viewer rather than doing whatever the thing
 * around it does.
 */
describe("a picture in the agent console", () => {
  const terminal = source("hud/Terminal.svelte");

  it("draws the picture a tool call names, under the line that names it", () => {
    const work = terminal.slice(terminal.indexOf('<div class="work">'));
    expect(work.slice(0, 1600)).toMatch(/picturesNamed\(line\)/);
    expect(work.slice(0, 1600)).toMatch(/class="step-shot"/);
  });

  it("opens the viewer that already exists rather than a second one", () => {
    expect(terminal).toMatch(/class="step-shot"[\s\S]{0,300}?showPicture\(pictured\(path\)!/);
    expect(terminal).toMatch(/class="queued-shot"[\s\S]{0,300}?showPicture\(pictured\(path\)!/);
  });

  it("says with the cursor that pressing enlarges, and can be reached by keyboard", () => {
    expect(terminal).toMatch(/\.step-shot \{[\s\S]{0,400}?cursor: zoom-in/);
    expect(terminal).toMatch(/\.step-shot:focus-visible \{[\s\S]{0,200}?outline:/);
    expect(terminal).toMatch(/\.queued-shot \{[\s\S]{0,400}?cursor: zoom-in/);
    expect(terminal).toMatch(/\.queued-shot:focus-visible \{[\s\S]{0,200}?outline:/);
  });

  it("draws nothing at all for a path the host will not serve", () => {
    // The line already says what the file is; a placeholder would be the same
    // filename twice, and there is no third thing to say.
    expect(terminal).toMatch(/\{#each picturesNamed\(line\) as path \(path\)\}\s*\{#if pictured\(path\)\}/);
  });

  it("shows a queued question's picture rather than its path", () => {
    expect(terminal).toMatch(/\{#each picturesNamed\(ask\.body\) as path \(path\)\}/);
    expect(terminal).toMatch(/const said = saidOf\(body\)/);
  });
});

/**
 * The one cache, and the one ear for its answers.
 *
 * Every box that could show a picture used to ask for its own copy, so the same
 * screenshot open in a thread, an agent's log and a reply being written had the
 * host read the file three times and send three copies of it through a channel
 * that copies everything it is handed.
 */
describe("asking the host for a picture", () => {
  const pictured = source("pictured.svelte.ts");
  const editor = source("panels/Editor.svelte");

  it("asks once per picture, for the whole page", () => {
    expect(pictured).toMatch(/notify\("showImage", \{ path: src \}\)/);
    expect(pictured).toMatch(/asking\.add\(src\)/);
  });

  it("leaves alone the addresses a page can already draw", () => {
    // A data URI is one the composer made a moment ago, before anything was
    // written to disk.
    expect(pictured).toMatch(/\^\(data\|blob\|vscode-webview-resource\|https\):/);
  });

  it("does not reach for a window while the page is being rendered as text", () => {
    expect(pictured).toMatch(/typeof window === "undefined"/);
  });

  it("is where the renderer asks, rather than keeping a second cache", () => {
    expect(editor).toMatch(/import \{ pictured \} from "\.\.\/pictured\.svelte\.js"/);
    expect(editor).not.toMatch(/notify\("showImage"/);
  });
});

/**
 * A picture pressed inside something that is itself pressable.
 *
 * The quoted question at the top of an agent's log is one block that goes back
 * to the conversation it came from, and the renderer inside it draws a picture
 * as a button. Pressing one took both presses: the viewer opened, and behind it
 * the camera flew across the drawing and a thread opened — so closing the
 * picture left the reader somewhere else entirely.
 */
describe("pressing a picture inside a pressable block", () => {
  const terminal = source("hud/Terminal.svelte");

  it("lets the control inside the quote have its own press", () => {
    expect(terminal).toMatch(/function its\(event: Event\): boolean/);
    expect(terminal).toMatch(/closest\?\.\("button, input"\)/);
  });

  it("asks before going to the conversation, by press and by key alike", () => {
    // A picture reached with the keyboard is pressed with Enter, and Enter on
    // the block goes to the conversation: both doors need the same guard.
    const quoted = terminal.slice(terminal.indexOf('class="quoted"'));
    // Both handlers, and nothing past the block they belong to.
    const handlers = quoted.slice(0, quoted.indexOf("quoted-face"));
    expect(handlers.match(/if \(its\(event\)\) return;/g) ?? []).toHaveLength(2);
  });
});
