import { describe, expect, it } from "vitest";

import { DomainFilter } from "../src/domain.js";

const filter = new DomainFilter({ root: "/repo" });

describe("DomainFilter", () => {
  it("accepts project files and returns a repo-relative path", () => {
    expect(filter.toDomainPath("/repo/src/app.ts")).toBe("src/app.ts");
  });

  it("rejects dependencies", () => {
    expect(filter.toDomainPath("/repo/node_modules/lib/index.ts")).toBeUndefined();
  });

  it("rejects build output", () => {
    expect(filter.toDomainPath("/repo/dist/app.js")).toBeUndefined();
  });

  it("rejects declaration files, which stand in for code we do not own", () => {
    expect(filter.toDomainPath("/repo/src/types.d.ts")).toBeUndefined();
  });

  it("rejects anything outside the root", () => {
    expect(filter.toDomainPath("/elsewhere/src/app.ts")).toBeUndefined();
    expect(filter.toDomainPath("/repo/../escape.ts")).toBeUndefined();
  });

  it("honours a custom exclusion list", () => {
    const custom = new DomainFilter({ root: "/repo", excludeSegments: ["generated"] });
    expect(custom.toDomainPath("/repo/src/generated/api.ts")).toBeUndefined();
    expect(custom.toDomainPath("/repo/node_modules/lib.ts")).toBe("node_modules/lib.ts");
  });
});
