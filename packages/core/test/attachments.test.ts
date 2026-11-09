import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AttachDenied,
  atLeast,
  ghStatus,
  openIssueWithMedia,
  uploadAttachments,
  versionOf,
  withAttachments,
  type Gh,
} from "../src/git/attachments.js";

const PNG = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
const MP4 = `data:video/mp4;base64,${Buffer.from("mp4").toString("base64")}`;

function fakeGh(options: { push: boolean; version?: string; login?: string }) {
  const calls: string[][] = [];
  const sent: string[] = [];
  const gh: Gh = async (args) => {
    calls.push(args);
    if (args[0] === "--version") return `gh version ${options.version ?? "2.99.0"} (2026-09-01)\n`;
    if (args[0] === "api" && args[1] === "user") {
      if (!options.login) throw new Error("not logged in");
      return `${options.login}\n`;
    }
    if (args[0] === "api" && args[1]?.startsWith("repos/")) {
      return JSON.stringify({ id: 42, permissions: { push: options.push } });
    }
    const upload = args.find((arg) => arg.startsWith("https://uploads.github.com/"));
    if (upload) {
      const input = args[args.indexOf("--input") + 1]!;
      sent.push(readFileSync(input, "utf8"));
      return JSON.stringify({ url: `https://github.com/user-attachments/assets/${sent.length}` });
    }
    if (args[0] === "issue" && args[1] === "create") {
      const body = args[args.indexOf("--body-file") + 1]!;
      sent.push(readFileSync(body, "utf8"));
      return "Creating issue in acme/shop\n\nhttps://github.com/acme/shop/issues/7\n";
    }
    if (args.includes("repos/acme/shop/issues")) return JSON.stringify({ html_url: "https://github.com/acme/shop/issues/8" });
    return "{}";
  };
  return { gh, calls, sent };
}

describe("media attached to a remark", () => {
  it("is uploaded the way gh --attach uploads, and comes back as a link with no branch behind it", async () => {
    const { gh, calls, sent } = fakeGh({ push: true });
    const stored = await uploadAttachments(gh, "acme/shop", [
      { name: "before.png", data: PNG },
      { name: "run.mp4", data: MP4 },
    ]);
    const uploads = calls.filter((args) => args.some((arg) => arg.startsWith("https://uploads.github.com/")));
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toContain("Content-Type: application/octet-stream");
    expect(uploads[0]!.find((arg) => arg.startsWith("https://"))).toBe(
      "https://uploads.github.com/user-attachments/assets?name=before.png&content_type=image%2Fpng&repository_id=42",
    );
    expect(sent).toEqual(["png", "mp4"]);
    expect(stored.map((one) => one.url)).toEqual([
      "https://github.com/user-attachments/assets/1",
      "https://github.com/user-attachments/assets/2",
    ]);
    expect(calls.some((args) => args.some((arg) => /git\/(refs|blobs|trees)|forks/.test(arg)))).toBe(false);
  });

  it("says plainly that it needs write access, rather than failing halfway", async () => {
    const { gh, calls } = fakeGh({ push: false });
    await expect(uploadAttachments(gh, "acme/shop", [{ name: "a.png", data: PNG }])).rejects.toBeInstanceOf(AttachDenied);
    expect(calls.some((args) => args.some((arg) => arg.startsWith("https://uploads.")))).toBe(false);
  });

  it("refuses what is not an image or a video", async () => {
    const { gh } = fakeGh({ push: true });
    await expect(uploadAttachments(gh, "acme/shop", [{ name: "x.txt", data: "data:text/plain;base64,eA==" }])).rejects.toThrow(
      "not an image or a video",
    );
  });

  it("ends the remark with pictures shown and videos on a line of their own, where GitHub plays them", () => {
    const body = withAttachments("Looks wrong", [
      { name: "a.png", url: "https://github.com/user-attachments/assets/1", image: true },
      { name: "b.mp4", url: "https://github.com/user-attachments/assets/2", image: false },
    ]);
    expect(body).toBe(
      "Looks wrong\n\n![a.png](https://github.com/user-attachments/assets/1)\n\nhttps://github.com/user-attachments/assets/2",
    );
  });
});

describe("an issue sent from Odin", () => {
  it("is created with gh issue create --attach, pictures carrying their names as alt text", async () => {
    const { gh, calls, sent } = fakeGh({ push: true });
    const made = await openIssueWithMedia(gh, "acme/shop", { title: "Broken", body: "It broke", label: "Bug" }, [
      { name: "shot.png", data: PNG },
      { name: "run.mp4", data: MP4 },
    ]);
    expect(made).toEqual({ url: "https://github.com/acme/shop/issues/7", left: 0 });
    const create = calls.find((args) => args[0] === "issue")!;
    expect(create.slice(0, 4)).toEqual(["issue", "create", "--repo", "acme/shop"]);
    const attached = create.filter((_, i) => create[i - 1] === "--attach");
    expect(attached[0]).toMatch(/1-shot\.png#shot\.png$/);
    expect(attached[1]).toMatch(/2-run\.mp4$/);
    expect(sent).toEqual(["It broke"]);
  });

  it("is still sent, without the files, by someone who cannot upload, and says how many were left", async () => {
    const { gh, calls } = fakeGh({ push: false });
    const made = await openIssueWithMedia(gh, "acme/shop", { title: "Broken", body: "It broke", label: "Bug" }, [
      { name: "shot.png", data: PNG },
    ]);
    expect(made).toEqual({ url: "https://github.com/acme/shop/issues/8", left: 1 });
    expect(calls.some((args) => args.includes("--attach"))).toBe(false);
  });
});

describe("the GitHub CLI Odin needs", () => {
  it("reads its version", () => {
    expect(versionOf("gh version 2.99.0 (2026-09-01)\nhttps://github.com/cli/cli/releases/tag/v2.99.0")).toBe("2.99.0");
    expect(atLeast("2.99.0", "2.99.0")).toBe(true);
    expect(atLeast("2.100.1", "2.99.0")).toBe(true);
    expect(atLeast("2.96.0", "2.99.0")).toBe(false);
    expect(atLeast(undefined, "2.99.0")).toBe(false);
  });

  it("calls a signed-in gh older than the --attach release outdated", async () => {
    expect(await ghStatus(fakeGh({ push: true, version: "2.96.0", login: "ada" }).gh)).toEqual({
      ok: false,
      login: "ada",
      version: "2.96.0",
      problem: "outdated",
    });
    expect(await ghStatus(fakeGh({ push: true, version: "2.99.0", login: "ada" }).gh)).toEqual({
      ok: true,
      login: "ada",
      version: "2.99.0",
    });
    expect((await ghStatus(fakeGh({ push: true, version: "2.99.0" }).gh)).problem).toBe("signed-out");
  });
});
