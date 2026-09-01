import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Every prop a console declares is a prop it actually takes.
 *
 * A component's props are written twice — once as the names being destructured
 * and once as the type describing them — and only the first of the two binds
 * anything. Adding a prop to the type and to the markup, and forgetting the
 * pattern in between, leaves the markup referring to a name that does not
 * exist, which is a `ReferenceError` the moment the component renders.
 *
 * That is not hypothetical. `cap` was added to `Terminal.svelte`'s type and to
 * its markup and never to its destructuring, and the whole dock disappeared: a
 * component that throws while rendering takes its parent's block down with it,
 * so a reader with two agents switched on saw no console at all, no gap where
 * one had been, and nothing on the page to say why. `Uncaught ReferenceError:
 * cap is not defined` on the window was the only trace of it.
 *
 * Nothing else catches it. The Svelte compiler is content — an unbound
 * identifier in markup is a legal reference to something it assumes is global —
 * and a component cannot be rendered in this suite, so the text is what there
 * is to read.
 */
const HUD = new URL("../src/app/hud/", import.meta.url);

/** The source with its comments taken out, so prose cannot look like code. */
function bare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Where the brace opened at `open` closes again. */
function closes(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === "{") depth += 1;
    else if (text[at] === "}") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/**
 * The pieces of a `{ … }` that belong to it rather than to something nested.
 *
 * Angle brackets are deliberately not counted: `=>` would close one that was
 * never opened, and a comma inside `Record<string, number>` splitting a member
 * in two costs nothing, since the half without the name in it simply yields no
 * name.
 */
function members(shape: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let held = "";
  for (const ch of shape) {
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    if (depth === 0 && (ch === ";" || ch === "," || ch === "\n")) {
      out.push(held);
      held = "";
    } else {
      held += ch;
    }
  }
  out.push(held);
  return out;
}

interface Props {
  /** The names actually bound — the only half of the pair that declares one. */
  taken: string[];
  /** The names the type says the component has. */
  declared: string[];
}

/**
 * A component's `$props()`, read as the two lists it really is.
 *
 * `let { … }: { … } = $props()`, so the pattern is the first pair of braces
 * after `let` and the type is the second. Read from the source with its
 * comments already stripped, because a brace inside a comment would otherwise
 * decide where the type ends.
 */
function propsOf(source: string): Props | null {
  const clean = bare(source);
  const at = clean.indexOf("= $props()");
  if (at < 0) return null;

  const from = clean.lastIndexOf("let {", at);
  if (from < 0) return null;

  const opened = clean.indexOf("{", from);
  const shut = closes(clean, opened);
  const taken = members(clean.slice(opened + 1, shut))
    .map((one) => one.split(/[=:]/)[0]!.replace("...", "").trim())
    .filter((one) => one !== "");

  const rest = clean.slice(shut + 1, at);
  const type = rest.indexOf("{");
  const declared = members(rest.slice(type + 1, closes(rest, type)))
    .map((one) => /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(]/.exec(one)?.[1] ?? "")
    .filter((one) => one !== "");

  return { taken, declared };
}

const components = readdirSync(HUD).filter((name) => name.endsWith(".svelte"));

describe("what a console says it takes", () => {
  it("has components to read", () => {
    // A directory that stopped matching would pass every case below by having
    // nothing in it, which is how a check like this dies without a sound.
    expect(components.length).toBeGreaterThan(0);
  });

  for (const name of components) {
    const props = propsOf(readFileSync(new URL(name, HUD), "utf8"));
    if (!props) continue;

    it(`binds every prop ${name} declares`, () => {
      const loose = props.declared.filter((one) => !props.taken.includes(one));
      // Named in the message, because the whole difficulty of this fault is
      // that the browser knows which name it was and nothing else does.
      expect(loose, `${name} declares ${loose.join(", ")} without binding it`).toEqual([]);
    });
  }

  it("caps the log at the height the column allowed it", () => {
    /*
     * The pair that broke: the markup caps its own height with `cap`, so `cap`
     * has to be a variable. Both halves together, because either one on its own
     * is a console that renders and ignores the column.
     */
    const source = readFileSync(new URL("Terminal.svelte", HUD), "utf8");
    expect(propsOf(source)?.taken).toContain("cap");
    expect(source).toMatch(/cap \?\? Number\.POSITIVE_INFINITY/);
  });

  it("hands the column's answer down to each console", () => {
    // The far end of the same wire. A dock that stopped passing these would
    // leave every log at whatever height its own text wanted, which is the
    // sliver the column exists to prevent.
    const dock = readFileSync(new URL("Terminals.svelte", HUD), "utf8");
    expect(dock).toMatch(/cramped=\{at >= column\.showing\}/);
    expect(dock).toMatch(/cap=\{column\.each\}/);

    // And it may only hand over names the console actually takes: passing one
    // it does not is the same mistake from the other side, and is silent in
    // exactly the same way.
    const takes = propsOf(readFileSync(new URL("Terminal.svelte", HUD), "utf8"))!.taken;
    // To the closing slash rather than to the first `>`, since `at >=` in an
    // attribute is a greater-than sign in the middle of the tag.
    const tag = /<Terminal\b([\s\S]*?)\/>/.exec(dock);
    expect(tag).not.toBeNull();
    const passed = [...tag![1]!.matchAll(/(?:^|\s)([a-zA-Z][\w]*)=/g)].map((one) => one[1]!);
    expect(passed.length).toBeGreaterThan(0);
    expect(passed.filter((one) => !takes.includes(one))).toEqual([]);
  });
});
