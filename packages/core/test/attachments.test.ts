import { describe, expect, it } from "vitest";

import { attachmentBranch, storeAttachments, withAttachments, type Gh } from "../src/git/attachments.js";

const PNG = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
const MP4 = `data:video/mp4;base64,${Buffer.from("mp4").toString("base64")}`;

function fakeGh(options: { push: boolean; branch?: string }) {
  const calls: { args: string[]; body?: unknown }[] = [];
  const gh: Gh = async (args, input) => {
    calls.push({ args, ...(input ? { body: JSON.parse(input) } : {}) });
    const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
    if (args.includes(".permissions.push")) return String(options.push);
    if (path.endsWith("/forks")) return JSON.stringify({ full_name: "ada/shop" });
    if (args.includes(".full_name")) return "ada/shop";
    if (path.includes("/git/ref/heads/")) {
      if (!options.branch) throw new Error("Not Found");
      return options.branch;
    }
    if (path.includes("/git/commits/")) return "tree0";
    if (path.endsWith("/git/blobs")) return JSON.stringify({ sha: `blob${calls.length}` });
    if (path.endsWith("/git/trees")) return JSON.stringify({ sha: "tree1" });
    if (path.endsWith("/git/commits")) return JSON.stringify({ sha: "commit1" });
    return "{}";
  };
  return { gh, calls };
}

describe("media attached to a remark", () => {
  it("lives on a branch named for the reviewed branch and the person", () => {
    expect(attachmentBranch("origin/feature/total", "Ada")).toBe("odin-attachments/feature/total/Ada");
    expect(attachmentBranch(undefined, "ada")).toBe("odin-attachments/issues/ada");
  });

  it("is committed to a new branch in the repository when you can push to it", async () => {
    const { gh, calls } = fakeGh({ push: true });
    const stored = await storeAttachments(gh, "acme/shop", "odin-attachments/feature/ada", [
      { name: "total.png", data: PNG },
      { name: "run.mp4", data: MP4 },
    ], 1000);
    expect(stored.map((one) => [one.image, one.url])).toEqual([
      [true, "https://github.com/acme/shop/blob/odin-attachments/feature/ada/1000-1-total.png?raw=true"],
      [false, "https://github.com/acme/shop/blob/odin-attachments/feature/ada/1000-2-run.mp4?raw=true"],
    ]);
    const commit = calls.find((call) => call.args.some((arg) => arg.endsWith("/git/commits")));
    expect(commit?.body).toMatchObject({ tree: "tree1", parents: [] });
    const ref = calls.find((call) => call.args.some((arg) => arg.endsWith("/git/refs")));
    expect(ref?.body).toEqual({ ref: "refs/heads/odin-attachments/feature/ada", sha: "commit1" });
  });

  it("goes to your fork when you cannot push, on top of what the branch already holds", async () => {
    const { gh, calls } = fakeGh({ push: false, branch: "head0" });
    const stored = await storeAttachments(gh, "acme/shop", "odin-attachments/issues/ada", [{ name: "a.png", data: PNG }]);
    expect(stored[0]!.url).toContain("https://github.com/ada/shop/blob/");
    const tree = calls.find((call) => call.args.some((arg) => arg.endsWith("/git/trees")));
    expect(tree?.body).toMatchObject({ base_tree: "tree0" });
    expect(calls.some((call) => call.args.includes("PATCH"))).toBe(true);
  });

  it("refuses what is not an image or a video", async () => {
    const { gh } = fakeGh({ push: true });
    await expect(storeAttachments(gh, "acme/shop", "b", [{ name: "x.txt", data: "data:text/plain;base64,eA==" }])).rejects.toThrow(
      "not an image or a video",
    );
  });

  it("ends the remark with pictures shown and videos linked", () => {
    const body = withAttachments("Looks wrong", [
      { name: "a.png", url: "https://x/a.png?raw=true", image: true },
      { name: "b.mp4", url: "https://x/b.mp4?raw=true", image: false },
    ]);
    expect(body).toBe("Looks wrong\n\n![a.png](https://x/a.png?raw=true)\n[▶ b.mp4](https://x/b.mp4?raw=true)");
  });
});
