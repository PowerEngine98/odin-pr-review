import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "@odin/core";

import { GITHUB_READS } from "../../vscode-ext/src/bridge-server.js";
import { diffOfFiles, readPull, type PullFile } from "../src/github.js";

const place = { owner: "someone", repo: "shop", number: 7 };

function answering(files: PullFile[], seen: string[] = []) {
  return async (path: string, accept: string): Promise<Response> => {
    seen.push(path);
    if (accept === "application/vnd.github.diff") {
      return new Response(JSON.stringify({ message: "Sorry, the diff exceeded the maximum number of files (300)." }), { status: 406 });
    }
    const page = /[?&]page=(\d+)/.exec(path);
    if (page) {
      const at = Number(page[1]) - 1;
      return new Response(JSON.stringify(files.slice(at * 100, at * 100 + 100)));
    }
    return new Response(JSON.stringify({ number: 7, title: "Big", html_url: "", state: "open", changed_files: files.length, base: { ref: "main", sha: "a" }, head: { ref: "big", sha: "b" } }));
  };
}

describe("a pull request too large for GitHub's one diff", () => {
  const files: PullFile[] = Array.from({ length: 305 }, (_, at) => ({
    filename: `src/File${at}.ts`,
    status: "modified",
    patch: `@@ -1,1 +1,1 @@\n-const total = ${at};\n+const total = ${at + 1};`,
  }));

  it("is read file by file instead, every page at once, whether through VS Code or straight from GitHub", async () => {
    const seen: string[] = [];
    const { diff } = await readPull(place, { via: answering(files, seen) });
    const pages = seen.filter((path) => path.includes("/files?"));
    expect(pages).toHaveLength(4);
    expect(parseUnifiedDiff(diff)).toHaveLength(305);

    const direct = await readPull(place, { fetch: ((url: string, init: RequestInit) => answering(files)(String(url).replace("https://api.github.com", ""), (init.headers as Record<string, string>).accept)) as typeof fetch });
    expect(parseUnifiedDiff(direct.diff)).toHaveLength(305);
  });

  it("keeps what each file is: added, removed, renamed, or a picture with no text to show", () => {
    const parsed = parseUnifiedDiff(
      diffOfFiles([
        { filename: "new.ts", status: "added", patch: "@@ -0,0 +1,1 @@\n+export const a = 1;" },
        { filename: "old.ts", status: "removed", patch: "@@ -1,1 +0,0 @@\n-export const b = 2;" },
        { filename: "to.ts", previous_filename: "from.ts", status: "renamed", patch: "@@ -1,1 +1,1 @@\n-x\n+y" },
        { filename: "logo.png", status: "modified" },
      ]),
    );
    expect(parsed.map((file) => file.status)).toEqual(["added", "deleted", "renamed", "modified"]);
    expect(parsed[2]?.oldPath).toBe("from.ts");
  });

  it("is let through VS Code, which answers for the browser", () => {
    expect(GITHUB_READS.test("/repos/someone/shop/pulls/7/files?per_page=100&page=3")).toBe(true);
    expect(GITHUB_READS.test("/repos/someone/shop/pulls/7/comments")).toBe(false);
  });
});
