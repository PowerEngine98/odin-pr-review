import { describe, expect, it } from "vitest";

import { anonymize } from "../src/support/anonymize.js";

const secrets = {
  home: "/Users/someone",
  repos: ["/Users/someone/work/acme/shop"],
  names: ["acme/shop"],
  titles: ["feat(fe): checkout flow for the Big Client"],
  branches: ["feat/checkout-flow", "development"],
  logins: ["someone", "teammate-1"],
};

describe("an Odin log made safe to share", () => {
  it("names what Odin knows by placeholders that stay the same through the log", () => {
    const log = [
      "live: rebuilding /Users/someone/work/acme/shop, 2 files changed",
      "live: following /Users/someone/work/acme/shop against development, feat/checkout-flow from 2d73b0eae",
      "read #42 feat(fe): checkout flow for the Big Client by teammate-1 on acme/shop",
    ].join("\n");
    const out = anonymize(log, secrets);
    expect(out).toBe(
      [
        "live: rebuilding <repo-1>, 2 files changed",
        "live: following <repo-1> against <branch-2>, <branch-1> from <sha>",
        "read #42 <title-1> by <user-1> on <repository-1>",
      ].join("\n"),
    );
  });

  it("hides files but keeps what kind of file they are", () => {
    expect(anonymize("rebuilding (backend/src/main/kotlin/com/acme/Order.kt, web/src/App.tsx)"))
      .toBe("rebuilding (<file>.kt, <file>.tsx)");
    expect(anonymize("wrote /opt/data/cache/state.json and /tmp/odin-base-x1/thing"))
      .toBe("wrote <path>.json and <path>");
    expect(anonymize("open C:\\Users\\dev\\proj\\main.go")).toBe("open <path>.go");
  });

  it("hides a bare file name too, keeping its kind", () => {
    expect(anonymize("changed (OrderUpgradeTests.kt, main.go)")).toBe("changed (<file>.kt, <file>.go)");
  });

  it("hides names it was never told about when they look like paths or branches", () => {
    expect(anonymize("checked out hotfix/secret-customer-name")).toBe("checked out <name>");
  });

  it("keeps the host of a link and drops the rest", () => {
    expect(anonymize("fetched https://github.example.corp/acme/shop/pull/12?x=1 and https://github.com"))
      .toBe("fetched https://github.example.corp/<…> and https://github.com");
  });

  it("never lets a token, an email or a commit through", () => {
    const out = anonymize(
      "auth ghp_abcdefghijklmnopqrstuvwxyz0123 Bearer abc.def-123456789 by dev@acme.example at 4db15e626783b41fe581c1c5ef9e25aa00112233",
    );
    expect(out).toBe("auth <token> Bearer <token> by <email> at <sha>");
  });

  it("leaves ordinary words, numbers and times alone", () => {
    const line = "2026-11-18T21:34:09.785Z  live: feat 117 files +3951 -1412 in 555ms, resolving references";
    expect(anonymize(line)).toBe(line);
  });

  it("matches a login as a whole word only", () => {
    expect(anonymize("someone said someones", { logins: ["someone"] })).toBe("<user-1> said someones");
  });
});
