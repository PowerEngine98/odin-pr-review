import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { gunzip, untar } from "../src/compute/tar.js";
import { forget, writeFile } from "../src/compute/vfs.js";
import { existsSync, readdirSync, readFileSync } from "../src/shims/fs.js";
import { dirname, join, relative, resolve } from "../src/shims/path.js";

function header(name: string, size: number, type = "0"): Uint8Array {
  const block = new Uint8Array(512);
  const encode = (text: string, at: number) => block.set(new TextEncoder().encode(text), at);
  encode(name, 0);
  encode(size.toString(8).padStart(11, "0"), 124);
  encode(type, 156);
  return block;
}

function tar(files: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = new TextEncoder().encode(text);
    parts.push(header(name, body.length));
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body);
    parts.push(padded);
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("a repository read into memory", () => {
  it("unpacks GitHub's gzipped tarball", async () => {
    const bytes = gzipSync(tar({ "acme-shop-1a2b/src/order.ts": "export class Order {}\n" }));
    const files = [...untar(await gunzip(new Response(bytes)))];
    expect(files.map((f) => f.path)).toEqual(["acme-shop-1a2b/src/order.ts"]);
    expect(new TextDecoder().decode(files[0]!.data)).toBe("export class Order {}\n");
  });

  it("answers the resolvers' file system calls", () => {
    writeFile("/odin/abc/src/order.ts", "export class Order {}");
    writeFile("/odin/abc/src/lines/line.ts", "export class Line {}");
    expect(existsSync("/odin/abc/src")).toBe(true);
    expect(readFileSync("/odin/abc/src/order.ts")).toBe("export class Order {}");
    const entries = readdirSync("/odin/abc/src", { withFileTypes: true }) as { name: string; isDirectory(): boolean }[];
    expect(entries.map((e) => `${e.name}:${e.isDirectory()}`)).toEqual(["lines:true", "order.ts:false"]);
    forget("/odin/abc");
    expect(existsSync("/odin/abc/src/order.ts")).toBe(false);
  });

  it("joins paths the way Node's posix path does", () => {
    expect(join("/odin/abc", "src/../src/order.ts")).toBe("/odin/abc/src/order.ts");
    expect(dirname("/odin/abc/src/order.ts")).toBe("/odin/abc/src");
    expect(relative("/odin/abc", "/odin/abc/src/order.ts")).toBe("src/order.ts");
    expect(resolve("/odin", "abc", "./src")).toBe("/odin/abc/src");
  });
});
