import { describe, expect, it } from "vitest";

// @ts-expect-error a plain script, without types
import { bumpOf, nextVersion } from "../../../scripts/next-version.mjs";

describe("the version a merge publishes as", () => {
  it("reads the kind of change from the commit subjects", () => {
    expect(bumpOf(["fix: a thing", "chore: tidy"])).toBe("patch");
    expect(bumpOf(["fix: a thing", "feat(tour): diagrams"])).toBe("minor");
    expect(bumpOf(["feat!: a new shape"])).toBe("major");
    expect(bumpOf(["fix: x\n\nBREAKING CHANGE: settings renamed"])).toBe("major");
  });

  it("bumps past what is live, keeping majors for when one is promised", () => {
    expect(nextVersion({ manifest: "0.1.0", live: "0.1.0", messages: ["fix: a"] })).toBe("0.1.1");
    expect(nextVersion({ manifest: "0.1.0", live: "0.1.3", messages: ["feat: a"] })).toBe("0.2.0");
    expect(nextVersion({ manifest: "0.1.0", live: "0.4.2", messages: ["feat!: a"] })).toBe("0.5.0");
    expect(nextVersion({ manifest: "1.2.0", live: "1.2.0", messages: ["feat!: a"] })).toBe("2.0.0");
  });

  it("takes the manifest as it stands when it is ahead, or nothing is live yet", () => {
    expect(nextVersion({ manifest: "0.1.0", live: "", messages: ["feat: a"] })).toBe("0.1.0");
    expect(nextVersion({ manifest: "1.0.0", live: "0.9.4", messages: ["fix: a"] })).toBe("1.0.0");
  });
});
