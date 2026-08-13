import { compile } from "svelte/compiler";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compiles every component on its own and reports what will not build.
 *
 * Separate from build.mjs because that one bundles: it needs every import to
 * resolve, so a half-finished port fails on the first missing file and says
 * nothing about the twenty components that are fine. This compiles each file
 * in isolation, which catches the errors that actually belong to it — bad
 * markup, a rune used outside a rune file, a store mutated in a template.
 *
 * It also writes nothing, so several people can run it at once.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

let failed = 0;
let checked = 0;

// Components only. A `.svelte.ts` rune module is TypeScript, which the Svelte
// compiler will not parse on its own — esbuild strips the types first, so
// those are checked by the bundle rather than here.
for await (const file of glob("src/app/**/*.svelte", { cwd: HERE })) {
  const path = `${HERE}/${file}`;
  const source = readFileSync(path, "utf8");
  checked += 1;
  try {
    compile(source, { filename: path, runes: true, generate: "client" });
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${relative(HERE, path)}`);
    console.error(`     ${error.message.split("\n")[0]}`);
    if (error.start) console.error(`     line ${error.start.line}`);
  }
}

console.log(`${checked - failed}/${checked} components compile`);
process.exit(failed > 0 ? 1 : 0);
