import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ChangeGraph } from "@odin/core";

/**
 * Where a rendered review lives, and how to say where that is.
 *
 * The name is derived from the repository and the branch pair rather than from
 * the clock, so reopening the same review reopens the same address. That is the
 * same reason the layout is deterministic: a reviewer coming back to a change
 * should find it where they left it, and an agent should be able to hand the
 * url to someone else without having gone and looked first.
 */
export function pagePath(graph: ChangeGraph, cwd: string): string {
  const repo = basename(resolve(cwd)) || "repo";
  const name = [repo, graph.meta.baseRef, graph.meta.headRef]
    .map(slug)
    .join("--");
  return join(tmpdir(), "odin-pr-review", `${name}.html`);
}

/**
 * Anything that is not a plain name becomes a dash.
 *
 * Runs of dots are collapsed and leading ones dropped. A ref cannot reach out
 * of the directory anyway — the separators are gone by then — but a file called
 * `r--..-..-etc.html` reads like an attempt at it, and nobody should have to
 * work out that it is not.
 */
function slug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\-]+|[.\-]+$/g, "") || "x";
}

export async function writePage(file: string, html: string): Promise<string> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, html, "utf8");
  return pathToFileURL(file).href;
}

/**
 * Serves the page over http, for the callers a file url cannot reach.
 *
 * Bound to the loopback address on purpose: this is one person's view of an
 * unpublished review, and binding it to every interface would put a colleague's
 * unfinished branch on the office network without anybody asking for that.
 */
export function serve(html: string, port: number): Promise<string> {
  return new Promise((ok, fail) => {
    const server = createServer((request, response) => {
      if (request.url !== "/" && request.url !== "/index.html") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found\n");
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(html);
    });

    server.on("error", fail);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      ok(`http://127.0.0.1:${bound}/`);
    });
  });
}
