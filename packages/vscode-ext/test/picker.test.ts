import { describe, expect, it } from "vitest";

import type { LocalBranch, PullRequestSummary } from "@odin/core";
import { renderSidebar } from "@odin/webview";

import { pickerView } from "../src/sidebar.js";

function pull(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 7,
    title: "Keep the zoom when a divider is dragged",
    url: "https://example.test/pull/7",
    branch: "topic",
    draft: false,
    author: "someone",
    createdAt: "2026-08-01T00:00:00Z",
    headSha: "a1b2c3d4e5f6",
    ...over,
  };
}

function local(over: Partial<LocalBranch> = {}): LocalBranch {
  return { branch: "topic", ahead: 0, behind: 0, uncommitted: 0, ...over };
}

/**
 * The chooser for one pull request, with whatever this machine has for it.
 *
 * The whole path, in one call: the host reads the repository and settles what
 * it knows into a model, and the components draw that model to text. The two
 * used to be one function that built markup with template strings, and testing
 * them together is still the point — a model nobody could draw and markup drawn
 * from a model nobody builds are each worth very little on their own.
 */
const page = (pr: PullRequestSummary, mine?: LocalBranch) =>
  body(
    renderSidebar({
      loading: false,
      picker: pickerView(
        [pr],
        "main",
        () => false,
        "",
        { state: "open", author: "" },
        true,
        () => mine,
      ),
    }),
  );

/**
 * Just the markup, without the application embedded beneath it.
 *
 * The document carries the compiled components as a string, and that string
 * contains a template for every element any of them can draw. Searching the
 * whole page therefore finds a class whether or not anything was rendered
 * wearing it — which is exactly the distinction half of these tests are about.
 */
function body(html: string): string {
  const from = html.indexOf('<div id="app">');
  const to = html.indexOf("<script", from);
  return html.slice(from, to === -1 ? undefined : to);
}

describe("a change with nothing of its own on this machine", () => {
  it("is checked out by pressing it", () => {
    // The original gesture, and still the right one: there is one reading of
    // this change, so the press cannot mean anything else.
    const html = page(pull());
    expect(html).not.toContain("drifted");
    expect(html).not.toContain("pull-body");
  });

  it("is not offered a choice merely for being out of date", () => {
    // Behind is the same change, older. A fold here would ask the reader to
    // choose between a thing and itself.
    expect(page(pull(), local({ behind: 4 }))).not.toContain("drifted");
  });
});

describe("a change this machine has moved on from", () => {
  it("folds open instead of checking out", () => {
    const html = page(pull(), local({ ahead: 2 }));
    expect(html).toContain("drifted");
    expect(html).toContain('data-where="local"');
    expect(html).toContain('data-where="origin"');
  });

  it("says what is on top, on the row itself", () => {
    // Visible while scrolling past, so a reader can see which changes they
    // have work sitting on without opening anything.
    expect(page(pull(), local({ ahead: 2 }))).toContain("2 commits");
    const one = page(pull(), local({ ahead: 1 }));
    expect(one).toContain("1 commit");
    expect(one).not.toContain("1 commits");
  });

  it("counts uncommitted work as a reason to ask", () => {
    const html = page(pull(), local({ uncommitted: 4, worktree: "/repo" }));
    expect(html).toContain("drifted");
    expect(html).toContain("4 uncommitted");
  });

  it("says both when there is both", () => {
    const html = page(pull(), local({ ahead: 2, uncommitted: 4, worktree: "/repo" }));
    expect(html).toContain("2 commits, 4 uncommitted");
  });

  it("names the forge's reading by its commit", () => {
    // So that picking it is a deliberate act rather than the thing that
    // happens when you aim badly.
    expect(page(pull(), local({ ahead: 1 }))).toContain("at a1b2c3d");
  });
});

describe("a change that has already landed", () => {
  it("offers no local reading, whatever the stale branch says", () => {
    // A merged change has no branch to be ahead of anything. Whatever is left
    // lying around under that name is not a second reading of it.
    const html = page(pull({ state: "merged" }), local({ ahead: 9 }));
    expect(html).not.toContain("drifted");
    expect(html).not.toContain('data-where="local"');
  });
});

describe("a row carrying more than fits", () => {
  it("wraps the tags rather than pushing the author off the edge", () => {
    // Open, changes requested, pushed to since you looked, and work of your
    // own on top: four pills, a face, a name and an age, on a bar a few words
    // wide. Held to one line it was the author and the age that fell off.
    const html = body(
      renderSidebar({
        loading: false,
        picker: pickerView(
          [pull({ reviewDecision: "CHANGES_REQUESTED" })],
          "main",
          () => true,
          "",
          { state: "open", author: "" },
          true,
          () => local({ ahead: 5, uncommitted: 2, worktree: "/repo" }),
        ),
      }),
    );
    expect(html).toContain("changes requested");
    expect(html).toContain("new commits");
    expect(html).toContain("5 commits, 2 uncommitted");
    // The facts, not just the decorations: these are what used to fall off the
    // right-hand edge. Whether they now wrap onto a second line is the style
    // sheet's business, and the style sheet is not part of this page.
    expect(html).toContain("someone");
    // The compiler appends its scoping class, so the match is on the opening
    // of the attribute rather than on the whole of it.
    expect(html).toContain('class="when');
  });
});

describe("what the rows are safe to carry", () => {
  it("cannot be broken out of an attribute by a branch name", () => {
    // The quote is what matters. A branch carrying `">` would otherwise close
    // the title it is written into and start writing elements of its own —
    // and a branch name comes from whoever pushed it.
    const html = page(pull({ branch: '"><script>x</script>' }), local({ ahead: 1 }));
    expect(html).not.toContain('"><script>x');
    expect(html).toContain("&quot;");
  });

  it("escapes a title into the row", () => {
    const html = page(pull({ title: '<img src=x onerror="1">' }), local({ ahead: 1 }));
    expect(html).not.toContain("<img src=x");
  });
});
