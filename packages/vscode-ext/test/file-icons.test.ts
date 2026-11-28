import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fileIconsFor, iconNameFor, type IconTable } from "@odin/webview";

const table: IconTable = {
  file: "file",
  fileNames: { "package.json": "nodejs", dockerfile: "docker" },
  fileExtensions: { tsx: "react_ts", ts: "typescript", "test.ts": "test-ts", kt: "kotlin" },
  svgs: { file: "<svg>f</svg>", nodejs: "<svg>n</svg>", typescript: "<svg>t</svg>", "test-ts": "<svg>x</svg>", react_ts: "<svg>r</svg>" },
};

describe("the icon a file is shown with", () => {
  it("is found by the file's whole name first, then by its longest extension, then the plain file", () => {
    expect(iconNameFor("web/package.json", table)).toBe("nodejs");
    expect(iconNameFor("ops/Dockerfile", table)).toBe("docker");
    expect(iconNameFor("src/Order.test.ts", table)).toBe("test-ts");
    expect(iconNameFor("src/Order.ts", table)).toBe("typescript");
    expect(iconNameFor("ui/Card.tsx", table)).toBe("react_ts");
    expect(iconNameFor("Main.KT", table)).toBe("kotlin");
    expect(iconNameFor("notes", table)).toBe("file");
  });

  it("travels once per icon, however many files wear it", () => {
    const icons = fileIconsFor(["a/One.tsx", "b/Two.tsx", "c/Order.ts"], table)!;
    expect(icons.of).toEqual({ "a/One.tsx": "react_ts", "b/Two.tsx": "react_ts", "c/Order.ts": "typescript" });
    expect(Object.keys(icons.icons).sort()).toEqual(["react_ts", "typescript"]);
    expect(icons.icons.react_ts).toBe(`data:image/svg+xml,${encodeURIComponent("<svg>r</svg>")}`);
    expect(fileIconsFor(["x.ts"], undefined)).toBeUndefined();
  });

  it("comes from the Material Icon Theme, packed into the extension at build", () => {
    const packed = join(__dirname, "../dist/media/file-icons.json");
    if (!existsSync(packed)) return;
    const real = JSON.parse(readFileSync(packed, "utf8")) as IconTable;
    expect(iconNameFor("ui/Card.tsx", real)).toBe("react_ts");
    expect(iconNameFor("src/Main.kt", real)).toBe("kotlin");
    expect(real.svgs.react_ts).toMatch(/^<svg/);
  });

  it("is drawn before the name in the sidebar, on a file's card and on the graph's tabs", () => {
    const read = (path: string) => readFileSync(join(__dirname, "../../webview/src/app", path), "utf8");
    expect(read("sidebar/File.svelte")).toMatch(/<FileIcon path=\{file\.path\} icons=\{model\.current\.fileIcons\} \/>\s*<span class="name">/);
    expect(read("canvas/Card.svelte")).toMatch(/<FileIcon path=\{node\.path\} icons=\{settings\.fileIcons \? model\.current\.fileIcons : undefined\} \/>\s*\{head\.name\}/);
    expect(read("chrome/Tabs.svelte")).toMatch(/<FileIcon path=\{paths\.get\(id\)!\} icons=\{settings\.fileIcons \? model\.current\.fileIcons : undefined\} \/>/);
  });
});
