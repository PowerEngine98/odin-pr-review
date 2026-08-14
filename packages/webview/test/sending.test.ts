import { describe, expect, it } from "vitest";

import { APP_SCRIPT } from "../src/generated/app.js";

/**
 * What may cross to the extension.
 *
 * The channel copies what it is handed rather than sharing it, and a copy is
 * made by the structured clone algorithm — which refuses anything it cannot
 * reproduce. Everything this page holds in `$state` is handed around as a
 * proxy, so a payload read straight off the state is precisely the kind of
 * thing it refuses.
 *
 * The failure is worth spelling out because of how quiet it is: the send
 * throws, the extension hears nothing at all, and the reader sees a button that
 * did nothing. A whole review's worth of drafts goes that way.
 */
describe("what the page sends to the extension", () => {
  it("cannot send a proxy, which is what state is made of", () => {
    // Not a test of our code — a test of the constraint our code exists to
    // satisfy. If this ever stops throwing, the snapshot below is free to go.
    const proxied = new Proxy([{ body: "LGTM" }], {});
    expect(() => structuredClone(proxied)).toThrow();
  });

  it("takes a snapshot on the way out rather than at each caller", () => {
    // Read from the compiled page, so it is the shipped `notify` being checked
    // and not the source it was built from. A payload cannot acquire this fault
    // later by being made reactive, which is why the snapshot lives here and
    // not at the one caller that happened to hit it.
    const send = APP_SCRIPT.match(/postMessage\(\{\s*type:\s*(\w+)\s*,\s*payload:\s*([^}]+)\}\)/);
    expect(send).not.toBeNull();
    const [, type, payload] = send!;
    // The payload is passed through something; the type is not.
    expect(payload).toMatch(new RegExp(`^\\w+\\(${type}?.*\\)$|^\\w+\\(\\w+\\)$`));
    expect(payload.trim()).not.toBe(type);
  });
});
