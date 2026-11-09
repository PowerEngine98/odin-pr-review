import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  const anything: unknown = new Proxy(function () {}, { get: () => anything, apply: () => anything, construct: () => anything as object });
  return { default: anything, ...Object.fromEntries(["window", "workspace", "commands", "Uri", "env", "ViewColumn", "ColorThemeKind", "EventEmitter", "Disposable", "ProgressLocation", "StatusBarAlignment", "ThemeColor", "ThemeIcon", "Range", "Position", "Selection", "TextEditorRevealType", "languages", "extensions"].map((name) => [name, anything])) };
});

const { mirrorOf } = await import("../src/panel.js");

class Frame {
  private shown = "";
  readonly delivered: unknown[] = [];
  get html(): string {
    return this.shown;
  }
  set html(value: string) {
    this.shown = value;
  }
  postMessage(message: unknown): Promise<boolean> {
    this.delivered.push(message);
    return Promise.resolve(true);
  }
}

const frame = () => ({ webview: new Frame() }) as never;

function browser() {
  const got: { html: string[]; messages: unknown[] } = { html: [], messages: [] };
  return { got, mirror: { html: (html: string) => got.html.push(html), message: (message: unknown) => got.messages.push(message) } };
}

describe("a frame watched from the browser", () => {
  it("keeps feeding a browser after another reading takes the frame over", () => {
    const panel = frame() as { webview: Frame };
    const first = mirrorOf(panel as never);
    const watcher = browser();
    first.mirrors.add(watcher.mirror);
    panel.webview.html = "<p>before</p>";

    const second = mirrorOf(panel as never);
    void panel.webview.postMessage({ type: "rows", nodes: ["renamed"] });

    expect(second).toBe(first);
    expect(watcher.got.html).toEqual(["<p>before</p>"]);
    expect(watcher.got.messages).toEqual([{ type: "rows", nodes: ["renamed"] }]);
    expect(panel.webview.delivered).toEqual([{ type: "rows", nodes: ["renamed"] }]);
  });

  it("hands a browser that arrives later the page and every change since", () => {
    const panel = frame() as { webview: Frame };
    mirrorOf(panel as never);
    panel.webview.html = "<p>page</p>";
    void panel.webview.postMessage({ type: "model", payload: 1 });
    void panel.webview.postMessage({ type: "spoken" });

    const log = mirrorOf(panel as never);
    expect(log.html).toBe("<p>page</p>");
    expect(log.sent).toEqual([{ type: "model", payload: 1 }]);
  });

  it("starts over when a new page is drawn", () => {
    const panel = frame() as { webview: Frame };
    const log = mirrorOf(panel as never);
    void panel.webview.postMessage({ type: "model", payload: 1 });
    panel.webview.html = "<p>new</p>";
    expect(log.sent).toEqual([]);
    expect(log.html).toBe("<p>new</p>");
  });
});
