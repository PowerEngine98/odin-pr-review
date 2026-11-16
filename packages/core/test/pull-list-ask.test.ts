import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listPullRequests } from "../src/git/pullRequest.js";

const pr = (number: number, login: string) =>
  `{"number":${number},"title":"t${number}","url":"u","headRefName":"b${number}","isDraft":false,` +
  `"author":{"login":"${login}"},"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-0${number % 9 + 1}T00:00:00Z","state":"OPEN"}`;

describe("asking the forge for pull requests in a busy repository", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;
  const log = () => join(repo, "asked.log");
  const asked = () => readFileSync(log(), "utf8").trim().split("\n");

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-gh-list-"));
    repo = mkdtempSync(join(tmpdir(), "odin-gh-list-repo-"));
    const file = join(bin, "gh");
    writeFileSync(
      file,
      "#!/bin/sh\n" +
        `echo "$@" >> "${join(repo, "asked.log")}"\n` +
        'case "$*" in\n' +
        `  *"author:marco "*) echo '[${pr(7, "marco")}]';;\n` +
        `  *"author:"*) echo '[]';;\n` +
        `  *"pricing "*) echo '[${pr(3, "ada")}]';;\n` +
        `  *) echo '[${pr(1, "ada")},${pr(2, "marcos")}]';;\n` +
        "esac\n",
    );
    chmodSync(file, 0o755);
    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  beforeEach(() => {
    writeFileSync(log(), "");
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("finds a login's pull requests by asking the forge, however old they are", async () => {
    const found = await listPullRequests({ cwd: repo, author: "marco" });
    expect(found?.map((one) => one.number)).toEqual([7]);
    expect(asked()).toHaveLength(1);
    expect(asked()[0]).toMatch(/--state all --search is:pr is:open author:marco sort:updated-desc --limit 50 /);
  });

  it("falls back to part of a login matched among the newest", async () => {
    const found = await listPullRequests({ cwd: repo, author: "marc" });
    expect(found?.map((one) => one.number)).toEqual([2]);
    expect(asked()[0]).toMatch(/author:marc /);
    expect(asked()[1]).not.toMatch(/--search/);
    expect(asked()[1]).toMatch(/--limit 200 /);
  });

  it("hands typed words to the forge's own search", async () => {
    const found = await listPullRequests({ cwd: repo, search: "pricing" });
    expect(found?.map((one) => one.number)).toEqual([3]);
    expect(asked()[0]).toMatch(/--search is:pr is:open pricing sort:updated-desc --limit 50 /);
  });
});

describe("the fast first answer", () => {
  it("leaves out the review decision, which the forge is slowest to work out", async () => {
    const { mkdtempSync, writeFileSync, chmodSync, readFileSync } = await import("node:fs");
    const bin = mkdtempSync(join(tmpdir(), "odin-gh-light-"));
    const log = join(bin, "asked.log");
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${log}"\necho '[]'\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
    try {
      await listPullRequests({ cwd: bin, light: true });
      await listPullRequests({ cwd: bin });
      const [light, full] = readFileSync(log, "utf8").trim().split("\n");
      expect(light).not.toContain("reviewDecision");
      expect(full).toContain("reviewDecision");
      expect(light).toContain("reviewRequests");
    } finally {
      process.env.PATH = path;
    }
  });
});
