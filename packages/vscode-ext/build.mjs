import { build } from "esbuild";

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
