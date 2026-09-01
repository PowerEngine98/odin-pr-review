import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A helper is called from somewhere it can actually be seen.
 *
 * `place` — the one function that writes new text into the composer and puts
 * the caret after it — was a `const` inside `apply`, the toolbar's handler.
 * `take`, which is what choosing a name from the mention menu runs, is not
 * inside `apply`, so the name it called did not exist where it called it.
 * Pressing Tab on `@c` therefore did nothing at all: the menu closed, the
 * remark was untouched, and the field kept the two characters it had.
 *
 * Nothing said so. `take` is called through `void take(...)` from both
 * handlers, so the `ReferenceError` became a rejected promise nobody was
 * holding — not a page error, not a Svelte warning, and nothing in the
 * console the reader would think to open. TypeScript would have caught it,
 * but the bundle is built by esbuild, which strips the types without ever
 * checking them.
 *
 * So the source is what there is to read, and this is the one shape worth
 * reading it for: a call, inside one top-level function, to a name that is
 * only ever declared inside a different one. That is not a matter of taste —
 * there is no arrangement of the file in which it works.
 */
const PANELS = new URL("../src/app/panels/", import.meta.url);

/** The source with comments and string bodies out, so prose cannot look like code. */
function bare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
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
 * The component's instance script.
 *
 * Not the `module` one: the two are separate scopes, and mixing them would
 * report a fault that the compiler reports already.
 */
function instance(source: string): string {
  const opening = /<script(?![^>]*\bmodule\b)[^>]*>/.exec(source);
  if (!opening) return "";
  const from = opening.index + opening[0].length;
  const to = source.indexOf("</script>", from);
  return to < 0 ? "" : bare(source.slice(from, to));
}

interface Fn {
  name: string;
  body: string;
}

/** Every `function name(…) { … }` written at the top level of the script. */
function functions(script: string): Fn[] {
  const out: Fn[] = [];
  const looking = /^\s{0,4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = looking.exec(script)) !== null) {
    const opened = script.indexOf("{", looking.lastIndex);
    const shut = closes(script, opened);
    if (opened < 0 || shut < 0) continue;
    out.push({ name: match[1]!, body: script.slice(opened, shut + 1) });
  }
  return out;
}

/** The names a stretch of source binds: declarations and arrow parameters. */
function binds(text: string): Set<string> {
  const names = new Set<string>();
  for (const one of text.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(one[1]!);
  }
  // A parameter is a binding too, and one shadowing a name declared elsewhere
  // would otherwise read as a call to that other one.
  for (const one of text.matchAll(/\(([^()]*)\)\s*(?::[^=]*?)?=>/g)) {
    for (const part of one[1]!.split(",")) {
      const named = /^\s*\.{0,3}\s*([A-Za-z_$][\w$]*)/.exec(part);
      if (named) names.add(named[1]!);
    }
  }
  return names;
}

/** Words that take a bracket after them without being anything's name. */
const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "new", "await",
  "function", "do", "else", "of", "in", "instanceof", "void", "yield", "delete",
]);

/** Every name called as a function in a stretch of source. */
function calls(text: string): string[] {
  const out: string[] = [];
  for (const one of text.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = one[2]!;
    if (!KEYWORDS.has(name)) out.push(name);
  }
  return out;
}

const components = readdirSync(PANELS).filter((name) => name.endsWith(".svelte"));

describe("a helper is in scope where it is called", () => {
  it("has components to read", () => {
    // A directory that stopped matching would pass every case below by having
    // nothing in it, which is how a check like this dies without a sound.
    expect(components.length).toBeGreaterThan(0);
  });

  for (const name of components) {
    const script = instance(readFileSync(new URL(name, PANELS), "utf8"));
    const found = functions(script);
    if (found.length === 0) continue;

    // What each top-level function keeps to itself, and so what is invisible
    // from every other one.
    const kept = new Map<string, Set<string>>();
    for (const fn of found) kept.set(fn.name, binds(fn.body));

    // Everything the script declares outside any of those bodies: the imports,
    // the state, and the functions themselves.
    let outer = script;
    for (const fn of found) outer = outer.replace(fn.body, " ");
    const shared = binds(outer);
    for (const one of outer.matchAll(/import\s+(?:type\s+)?{([^}]*)}/g)) {
      for (const part of one[1]!.split(",")) {
        const named = /([A-Za-z_$][\w$]*)\s*$/.exec(part.split(" as ").pop()!.trim());
        if (named) shared.add(named[1]!);
      }
    }
    for (const one of outer.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) shared.add(one[1]!);
    for (const fn of found) shared.add(fn.name);

    it(`calls nothing ${name} keeps inside another function`, () => {
      const loose: string[] = [];
      for (const fn of found) {
        const mine = kept.get(fn.name)!;
        for (const called of calls(fn.body)) {
          if (shared.has(called) || mine.has(called)) continue;
          const elsewhere = found.find((other) => other !== fn && kept.get(other.name)!.has(called));
          // Named in the message, because the whole difficulty of this fault
          // is that the browser knows which name it was and nothing else does.
          if (elsewhere) loose.push(`${fn.name} calls ${called}, declared only inside ${elsewhere.name}`);
        }
      }
      expect(loose).toEqual([]);
    });
  }

  it("writes the composer's field from somewhere both handlers can see", () => {
    /*
     * The pair that broke, stated directly. `place` has to be a function of
     * the component rather than of `apply`, and `take` has to be the thing
     * that calls it — either half on its own is a Tab that closes the menu
     * and leaves `@c` in the field.
     */
    const source = readFileSync(new URL("Editor.svelte", PANELS), "utf8");
    expect(instance(source)).toMatch(/^\s{0,4}async function place\(/m);
    expect(source).toMatch(/await place\(done\.text, done\.caret, done\.caret\)/);
  });

  it("says who the composer's remark reaches, in each agent's colour", () => {
    // A textarea will not colour part of its own text, so the answer is drawn
    // under the field instead — and it has to be the agent's own colour, or it
    // says who rather than which one of them this is.
    const source = readFileSync(new URL("Editor.svelte", PANELS), "utf8");
    expect(source).toMatch(/const reaching = \$derived\(mentioned\(value, agents\)\)/);
    expect(source).toMatch(/class="reaching-who" style="--who:\{markOf\(who\.id\)\.color\}"/);
  });
});
