import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { folderIconNamesFor, type IconTable } from "@odin/webview";

const table = {
  folder: "folder",
  folderExpanded: "folder-open",
  folderNames: { src: "folder-src", test: "folder-test" },
  folderNamesExpanded: { src: "folder-src-open", test: "folder-test-open" },
};

const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

describe("a folder in the sidebar", () => {
  it("wears the Material icon of its name, open or shut, taking the deepest named segment of a joined path", () => {
    expect(folderIconNamesFor("src", table)).toEqual({ closed: "folder-src", open: "folder-src-open" });
    expect(folderIconNamesFor("test/shop/orders", table)).toEqual({ closed: "folder-test", open: "folder-test-open" });
    expect(folderIconNamesFor("src/test", table)).toEqual({ closed: "folder-test", open: "folder-test-open" });
    expect(folderIconNamesFor("realtime", table)).toEqual({ closed: "folder", open: "folder-open" });
  });

  it("finds the theme's own folder icons in what the build packs", () => {
    const packed = join(__dirname, "../dist/media/file-icons.json");
    if (!existsSync(packed)) return;
    const real = JSON.parse(readFileSync(packed, "utf8")) as IconTable;
    const src = folderIconNamesFor("src", real);
    expect(src.closed).toBe("folder-src");
    expect(real.svgs[src.open!]).toMatch(/^<svg/);
    expect(real.svgs[folderIconNamesFor("realtime", real).closed!]).toMatch(/^<svg/);
  });

  it("is tinted green when everything under it is a test, the way its test files are", () => {
    expect(read("webview/src/sidebar-views.ts")).toMatch(
      /folders\.length \+ files\.length > 0 && folders\.every\(\(child\) => child\.test\) && files\.every\(\(file\) => file\.test\)/,
    );
    const folder = read("webview/src/app/sidebar/Folder.svelte");
    expect(folder).toMatch(/class:test=\{folder\.test\}/);
    expect(folder).toMatch(/\.folder\.test \{\s*background-image: linear-gradient\(\s*color-mix\(in srgb, var\(--added\) 7%, transparent\)/);
  });
});

describe("the File icons switch under Show", () => {
  it("is on by default and hides the icons on cards and tabs when off", () => {
    expect(read("webview/src/app/state.svelte.ts")).toMatch(/fileIcons: true,/);
    expect(read("webview/src/app/chrome/Settings.svelte")).toMatch(/label="File icons"[\s\S]*?bind:checked=\{settings\.fileIcons\}/);
    expect(read("webview/src/app/canvas/Card.svelte")).toMatch(/icons=\{settings\.fileIcons \? model\.current\.fileIcons : undefined\}/);
    expect(read("webview/src/app/chrome/Tabs.svelte")).toMatch(/icons=\{settings\.fileIcons \? model\.current\.fileIcons : undefined\}/);
  });

  it("reaches the sidebar, which redraws without them", () => {
    expect(read("vscode-ext/src/sidebar.ts")).toMatch(/const shown = this\.settings\?\.read\(\)\?\.fileIcons !== false;/);
    expect(read("vscode-ext/src/panel.ts")).toMatch(/GraphPanel\.onFileIcons\?\.\(\);/);
    expect(read("vscode-ext/src/extension.ts")).toMatch(/GraphPanel\.onFileIcons = \(\) => sidebar\.setFileIcons\(\);/);
  });
});
