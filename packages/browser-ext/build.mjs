import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "dist", "extension");
const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"));

const SHIMS = {
  crypto: "crypto.ts",
  fs: "fs.ts",
  "fs/promises": "fs.ts",
  path: "path.ts",
  "path/posix": "path.ts",
};

const browserOnly = {
  name: "browser-only",
  setup(context) {
    const builtins = new RegExp(`^(node:)?(${builtinModules.map((m) => m.replace(/[/]/g, "\\/")).join("|")})$`);
    context.onResolve({ filter: builtins }, (args) => {
      const name = args.path.replace(/^node:/, "");
      return { path: join(HERE, "src", "shims", SHIMS[name] ?? "node.cjs") };
    });
  },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(HERE, "static"), OUT, { recursive: true });

const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const shared = {
  bundle: true,
  platform: "browser",
  target: "chrome120",
  outdir: OUT,
  minify: process.env.ODIN_DEV !== "1",
  logLevel: "warning",
  plugins: [browserOnly],
  define: { "process.env.NODE_ENV": '"production"' },
  banner: {
    js: [
      'var process = globalThis.process ?? { env: {}, platform: "browser", versions: {}, cwd: () => "/" };',
      "globalThis.setImmediate ??= (run, ...args) => setTimeout(run, 0, ...args);",
      "globalThis.clearImmediate ??= (id) => clearTimeout(id);",
    ].join("\n"),
  },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: {
      content: join(HERE, "src", "content.ts"),
      sandbox: join(HERE, "src", "sandbox.ts"),
      options: join(HERE, "src", "options.ts"),
    },
    format: "iife",
  }),
  build({
    ...shared,
    entryPoints: { viewer: join(HERE, "src", "viewer.ts") },
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
  }),
]);

if (process.argv.includes("--zip")) {
  const zip = join(HERE, "..", "..", "dist", "odin-pr-review-browser.zip");
  mkdirSync(dirname(zip), { recursive: true });
  rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", zip, "."], { cwd: OUT });
  console.log(zip);
}
