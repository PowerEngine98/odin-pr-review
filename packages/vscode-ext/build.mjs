import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

/**
 * Bundles the extension to a single CommonJS file.
 *
 * VS Code loads extensions as CommonJS, while every package in this repository
 * is ESM, so the boundary has to be crossed somewhere. Doing it here keeps the
 * libraries idiomatic and leaves the extension as the only place that knows
 * about the editor's module format.
 *
 * `vscode` is provided by the host at runtime and must never be bundled.
 */
await build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  // The TypeScript compiler is a large dependency, but bundling it is what
  // lets the extension resolve references itself rather than depending on
  // whichever language server happens to be installed.
  minify: process.env.ODIN_DEV !== "1",
  logLevel: "info",
});

/*
 * The diagram renderer, copied rather than bundled.
 *
 * Agents draw in mermaid — it is what they reach for when asked how something
 * is put together — and a fenced block of `graph TD` is a picture written down
 * as text. Drawing it needs a DOM, so it cannot be done on this side and handed
 * over as markup; it has to run in the page.
 *
 * Three and a half megabytes of it, which is why it is a file beside the
 * extension rather than part of the page. The document Odin writes is inlined
 * whole and parsed on every open; carrying a renderer that most readings never
 * use would be paid for by all of them. This is fetched by the page the first
 * time a diagram actually appears, and never otherwise.
 */
const require = createRequire(import.meta.url);
await mkdir("dist/media", { recursive: true });
await copyFile(
  require.resolve("mermaid/dist/mermaid.min.js"),
  "dist/media/mermaid.min.js",
);
