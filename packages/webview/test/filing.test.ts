import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  SUMMARY_KEY,
  clearAll,
  composerKey,
  fileDrafts,
  forget,
  legacyKey,
  load,
  onUnsaved,
  remember,
  storeKey,
  type Draft,
  type Shelf,
  type Store,
  type Unsaved,
} from "../src/app/panels/drafts.js";
import { repositoryOf } from "../src/html.js";

/** A store as `localStorage` is one, and as every page on the machine shares it. */
function store(): Store & { held: Map<string, string> } {
  const held = new Map<string, string>();
  return {
    held,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  };
}

/** A remark on one file. */
function draft(path: string, body = "this is wrong"): Draft {
  return { path, line: 4, side: "RIGHT", body };
}

/** The same pull request number, in a repository and in another. */
function shelf(repository: string, files: string[] = [], threads: string[] = []): Shelf {
  return { review: "pr:272", repository, here: () => ({ files, threads }) };
}

const ACME = "github.com/acme/api";
const OTHER = "github.com/other/web";

afterEach(() => onUnsaved(null));

/**
 * Two repositories, one pull request number.
 *
 * Every page this extension draws shares one store, and a number is unique only
 * inside its own repository. Filed under the number alone, #272 in one
 * repository showed #272-in-another's remarks as its own pending review, and
 * Submit sent them there — mostly refused for naming files that did not exist,
 * and posted publicly in the wrong place where a path happened to exist in both.
 */
describe("drafts for the same number in two repositories", () => {
  it("keeps each repository's drafts to itself", () => {
    const kept = store();
    fileDrafts(shelf(ACME), [draft("src/server.ts", "acme's remark")], kept);
    fileDrafts(shelf(OTHER), [draft("src/app.tsx", "other's remark")], kept);

    expect(load(shelf(ACME), kept).drafts.map((d) => d.body)).toEqual(["acme's remark"]);
    expect(load(shelf(OTHER), kept).drafts.map((d) => d.body)).toEqual(["other's remark"]);
  });

  it("does not show one repository's drafts in the other, even for a shared file", () => {
    // The dangerous case: a path both repositories have, which the forge would
    // happily accept a remark on.
    const kept = store();
    fileDrafts(shelf(ACME), [draft("README.md")], kept);
    expect(load(shelf(OTHER, ["README.md"]), kept).drafts).toEqual([]);
  });

  it("keeps half-written text apart as well as finished remarks", () => {
    const kept = store();
    remember(shelf(ACME), SUMMARY_KEY, "acme looks fine", kept);
    expect(load(shelf(OTHER), kept).unsent).toEqual({});
  });

  it("names the repository in the key for a pair of refs too", () => {
    // `main..feature` is in every repository there is.
    const pair = (repository: string): Shelf => ({ review: "main..feature", repository });
    expect(storeKey(pair("/work/acme"))).not.toBe(storeKey(pair("/work/other")));
  });

  it("clears only the repository whose review was submitted", () => {
    const kept = store();
    fileDrafts(shelf(ACME), [draft("a.ts")], kept);
    fileDrafts(shelf(OTHER), [draft("b.ts")], kept);
    clearAll(shelf(ACME), kept);
    expect(load(shelf(OTHER), kept).drafts).toHaveLength(1);
  });
});

/**
 * Which repository a reading is, as the key spells it.
 *
 * The forge's name when there is a pull request, because that is what a pull
 * request number is unique within and it is the same in every clone and
 * worktree; a local path would split one review into as many as there are
 * checkouts, and a number alone joins every repository into one.
 */
describe("the repository a reading is filed under", () => {
  it("is the forge's owner and name for a pull request, wherever it is checked out", () => {
    const pullRequest = { url: "https://github.com/Acme/API/pull/272" };
    expect(repositoryOf({ repo: "/Users/me/acme", pullRequest })).toBe("github.com/acme/api");
    expect(repositoryOf({ repo: "/Users/me/acme-worktree", pullRequest })).toBe(
      "github.com/acme/api",
    );
  });

  it("tells two repositories' pull requests of one number apart", () => {
    expect(repositoryOf({ pullRequest: { url: "https://github.com/acme/api/pull/272" } })).not.toBe(
      repositoryOf({ pullRequest: { url: "https://github.com/other/web/pull/272" } }),
    );
  });

  it("is the checkout without a pull request, when the forge may not have been asked", () => {
    expect(repositoryOf({ repo: "/Users/me/acme" })).toBe("/Users/me/acme");
  });

  it("goes into the page beside the review name, which is left as it was", () => {
    // The camera and the pinned drawings are keyed by `review`; changing its
    // spelling would have lost all of them.
    const html = readFileSync(new URL("../src/html.ts", import.meta.url), "utf8");
    expect(html).toContain("? `pr:${graph.meta.pullRequest.number}`");
    expect(html).toContain("{ repository: repositoryOf(graph.meta) }");
  });
});

/**
 * Drafts written before the repository was part of the key.
 *
 * They are not lost and they are not moved. A record under the old key does not
 * say which repository it came from, and adopting it into whichever repository
 * is open when it is next read is the mistake this project made once already,
 * with a conversation that walked onto a pull request it did not belong to. So
 * the old key is read only when the new one holds nothing, only when the record
 * names files this change actually has, and it is never written or removed.
 */
describe("drafts filed under the old repository-less key", () => {
  function withOld(filed: object) {
    const kept = store();
    kept.setItem(legacyKey("pr:272"), JSON.stringify(filed));
    return kept;
  }

  it("are still shown where nothing has been filed under the new key", () => {
    const kept = withOld({ drafts: [draft("src/server.ts")], unsent: {} });
    expect(load(shelf(ACME, ["src/server.ts"]), kept).drafts).toHaveLength(1);
  });

  it("are never rewritten or removed, whatever the reader does", () => {
    const old = JSON.stringify({ drafts: [draft("src/server.ts")], unsent: {} });
    const kept = withOld(JSON.parse(old));
    const here = shelf(ACME, ["src/server.ts"]);

    load(here, kept);
    remember(here, SUMMARY_KEY, "looks fine", kept);
    fileDrafts(here, [...load(here, kept).drafts, draft("src/server.ts", "and this")], kept);
    forget(here, SUMMARY_KEY, kept);
    clearAll(here, kept);

    expect(kept.getItem(legacyKey("pr:272"))).toBe(old);
  });

  it("are not shown in a repository whose change does not have their files", () => {
    // The same number in another repository: the old record's files are not
    // this change's, so it is not this change's record.
    const kept = withOld({ drafts: [draft("src/server.ts")], unsent: {} });
    expect(load(shelf(OTHER, ["src/app.tsx", "README.md"]), kept).drafts).toEqual([]);
  });

  it("are not shown when only some of their files are this change's", () => {
    const kept = withOld({
      drafts: [draft("README.md"), draft("src/server.ts")],
      unsent: {},
    });
    expect(load(shelf(OTHER, ["README.md"]), kept).drafts).toEqual([]);
  });

  it("are judged by the file a half-written comment names, too", () => {
    const where = { path: "src/server.ts", side: "RIGHT", line: 4 };
    const kept = withOld({ drafts: [], unsent: { [composerKey(where)]: "half" } });
    expect(load(shelf(ACME, ["src/server.ts"]), kept).unsent).toEqual({
      [composerKey(where)]: "half",
    });
    expect(load(shelf(OTHER, ["src/app.tsx"]), kept).unsent).toEqual({});
  });

  it("are left alone when they name nothing that can be checked", () => {
    // A summary alone says nothing about which repository it was written in.
    const kept = withOld({ drafts: [], unsent: { [SUMMARY_KEY]: "lgtm" } });
    expect(load(shelf(ACME, ["src/server.ts"]), kept).unsent).toEqual({});
  });

  it("give way to anything filed under the new key", () => {
    const kept = withOld({ drafts: [draft("src/server.ts", "old")], unsent: {} });
    const here = shelf(ACME, ["src/server.ts"]);
    fileDrafts(here, [draft("src/server.ts", "new")], kept);
    expect(load(here, kept).drafts.map((d) => d.body)).toEqual(["new"]);
  });

  it("do not come back once the review they were read into has been submitted", () => {
    // Otherwise the next load would find the new key empty, read the old one
    // again, and offer the same remarks for a second posting.
    const kept = withOld({ drafts: [draft("src/server.ts")], unsent: {} });
    const here = shelf(ACME, ["src/server.ts"]);
    expect(load(here, kept).drafts).toHaveLength(1);
    clearAll(here, kept);
    expect(load(here, kept).drafts).toEqual([]);
  });

  it("are not copied under the new key merely by being looked at", () => {
    // Every box files itself as it opens; an unchanged record is not written.
    const kept = withOld({ drafts: [draft("src/server.ts")], unsent: {} });
    const here = shelf(ACME, ["src/server.ts"]);
    remember(here, SUMMARY_KEY, "", kept);
    expect(kept.getItem(storeKey(here))).toBeNull();
  });
});

/**
 * A save that did not happen.
 *
 * It used to be swallowed, on the grounds that the drafts lived as long as the
 * page — true until the reload, when they were gone and nothing had said so.
 * The store is shared by every review in every repository and each draft
 * carries the code it was written against, so filling it is plausible; the
 * reader is told when it happens, while the drafts are still on screen. Once:
 * a full store fails every save, and saves happen on every keystroke.
 */
describe("a save that fails", () => {
  function refusing(error: unknown): Store {
    return {
      getItem: () => null,
      setItem: () => {
        throw error;
      },
      removeItem: () => undefined,
    };
  }

  function listen(): Unsaved[] {
    const heard: Unsaved[] = [];
    onUnsaved((trouble) => heard.push(trouble));
    return heard;
  }

  it("is reported, once, however many keystrokes follow it", () => {
    const heard = listen();
    const full = refusing(Object.assign(new Error("quota"), { name: "QuotaExceededError" }));
    for (const text of ["t", "th", "thi", "this"]) {
      remember(shelf(ACME), SUMMARY_KEY, text, full);
    }
    fileDrafts(shelf(ACME), [draft("a.ts")], full);
    expect(heard).toEqual(["full"]);
  });

  it("says a full store apart from one that refuses to keep anything", () => {
    const heard = listen();
    remember(shelf(ACME), SUMMARY_KEY, "x", refusing(Object.assign(new Error("no"), { name: "SecurityError" })));
    expect(heard).toEqual(["unavailable"]);
  });

  it("is reported when there is no store at all and there was something to keep", () => {
    const heard = listen();
    fileDrafts(shelf(ACME), [], null);
    expect(heard).toEqual([]);
    fileDrafts(shelf(ACME), [draft("a.ts")], null);
    expect(heard).toEqual(["unavailable"]);
  });

  it("is not reported for an empty review that could not be written", () => {
    // Nothing was going to be lost.
    const heard = listen();
    const kept = refusing(Object.assign(new Error("quota"), { name: "QuotaExceededError" }));
    clearAll(shelf(ACME), { ...kept, removeItem: () => { throw new Error("no"); } });
    expect(heard).toEqual([]);
  });

  it("reaches the editor, whose warnings are where a review's troubles are told", () => {
    const main = readFileSync(new URL("../src/app/main.ts", import.meta.url), "utf8");
    expect(main).toContain('notify("draftsUnsaved", { trouble })');
    const panel = readFileSync(
      new URL("../../vscode-ext/src/panel.ts", import.meta.url),
      "utf8",
    );
    expect(panel).toContain('message.type === "draftsUnsaved"');
    expect(panel).toContain("showWarningMessage(unsavedDrafts(");
  });
});

/**
 * The pending list after a reload.
 *
 * Remarks were written to the store on every change and never read back into
 * the list, so after a reload the pending review said nothing was pending, and
 * the next remark added was filed as the whole list, over the top of the rest.
 */
describe("the pending review when the page wakes up", () => {
  it("reads back what was filed", () => {
    const panel = readFileSync(
      new URL("../src/app/panels/ReviewPanel.svelte", import.meta.url),
      "utf8",
    );
    expect(panel).toContain("const held = load(shelfOf(model.current)).drafts;");
    expect(panel).toMatch(/onMount\(\(\) => \{\s*if \(drafts\.length > 0\) return;/);
  });
});
