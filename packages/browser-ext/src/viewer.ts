import type { ChangeGraph } from "@odin/core";
import type { PickerView, SidebarModel } from "@odin/webview";

import {
  GitHubError,
  listPulls,
  readPull,
  whoAmI,
  type Api,
  type Asked,
  type Place,
} from "./github.js";
import { BridgeError, bridgeGitHub, bridgePulls, findBridge, launch, newToken, pairingLink } from "./bridge.js";
import { pageOf } from "./page.js";
import { changeModel, pickerOf, pickerOfSummaries, sidebarPage } from "./picker.js";
import { openSession, type Remote } from "./session.js";
import { draw, readSettings, saveSettings, vsCodePort, type Settings, type SourceKind } from "./sources.js";
import { rootVariables } from "./vscode-vars.js";

const params = new URLSearchParams(location.search);
const owner = params.get("owner") ?? "";
const repo = params.get("repo") ?? "";
const first = Number(params.get("number") ?? "");
const dark = params.get("theme") !== "light";
const place: Place = { owner, repo };

document.documentElement.dataset.theme = dark ? "dark" : "light";

const status = document.getElementById("status")!;
const graphFrame = document.getElementById("page") as HTMLIFrameElement;
const sideFrame = document.getElementById("side") as HTMLIFrameElement;
const back = document.getElementById("back") as HTMLButtonElement;
const sideTitle = document.getElementById("side-title")!;
const goLive = document.getElementById("go-live")!;
const goLiveButton = document.getElementById("go-live-button") as HTMLButtonElement;
const goLiveBranch = document.getElementById("go-live-branch")!;
const goLiveFailed = document.getElementById("go-live-failed")!;
const enable = document.getElementById("enable") as HTMLButtonElement;
const enableLabel = document.getElementById("enable-label")!;
const link = document.getElementById("link")!;

type Link = "ok" | "retrying" | "down" | "off";

const LINK_TIPS: Record<Exclude<Link, "off">, string> = {
  ok: "Connected to VS Code. Agents, tours and narration run there, and what you do here goes back to it.",
  retrying: "VS Code stopped answering, often because it reloaded or updated an extension. Reconnecting every two seconds; the graph stays as it was.",
  down: "VS Code is not answering. Check it is open with Odin installed, then click this dot to try again, or switch to another source here.",
};

function setLink(state: Link) {
  link.hidden = state === "off";
  if (state === "off") return;
  link.dataset.state = state;
  link.title = LINK_TIPS[state];
  link.setAttribute("aria-label", LINK_TIPS[state]);
}
const features = document.getElementById("features")!;
const pairing = document.getElementById("pairing")!;

function say(text: string, detail = "") {
  status.hidden = false;
  status.replaceChildren();
  const line = document.createElement("p");
  line.textContent = text;
  status.append(line);
  if (detail) {
    const small = document.createElement("p");
    small.className = "detail";
    small.textContent = detail;
    status.append(small);
  }
}

function offerToken(why: string) {
  say(why, "Odin reads public repositories without signing in. Private ones, and more than 60 requests an hour, need a GitHub token.");
  const button = document.createElement("button");
  button.textContent = "Add a GitHub token";
  button.addEventListener("click", () => {
    const query = owner ? `?${new URLSearchParams({ owner })}` : "";
    window.open(chrome.runtime.getURL(`options.html${query}`), "_blank", "noopener");
  });
  status.append(button);
}

function explain(error: unknown) {
  graphFrame.hidden = true;
  if (error instanceof BridgeError) {
    if (error.reason === "unreachable") setLink("down");
    return say(error.message, "Is VS Code open, with Odin installed? Click the red dot beside Synced with: VS Code to try again.");
  }
  if (error instanceof GitHubError && reader.via) {
    return say(
      "VS Code could not read this from GitHub.",
      `${error.message} — Odin reads through the GitHub CLI there; run gh auth status in a terminal to check the account it uses.`,
    );
  }
  if (error instanceof GitHubError) {
    if (error.reason === "missing") return offerToken("GitHub did not show Odin this repository.");
    if (error.reason === "denied") return offerToken("GitHub refused the token Odin has.");
    if (error.reason === "limited") return offerToken("GitHub's hourly limit for anonymous reads is used up.");
    if (error.reason === "too-large") {
      return say("This pull request is too large for GitHub to send as one diff.", "Open it in VS Code with Odin to read it.");
    }
  }
  say("Odin could not read this.", error instanceof Error ? error.message : String(error));
}

async function api(): Promise<Api> {
  if (settings.source === "vscode" && settings.token) {
    const token = settings.token;
    return {
      via: async (path, accept) => {
        const port = await findBridge(token, settings.port);
        if (!port) throw new BridgeError("VS Code is not answering.", "unreachable");
        return bridgeGitHub(port, token)(path, accept);
      },
    };
  }
  const stored = await chrome.storage.local.get("token");
  return typeof stored.token === "string" && stored.token ? { token: stored.token } : {};
}

const PAGE_STORE = "page";

async function savedPage(): Promise<Record<string, string>> {
  const stored = await chrome.storage.local.get(PAGE_STORE);
  const saved = stored[PAGE_STORE];
  return saved && typeof saved === "object" ? saved as Record<string, string> : {};
}

let keeping = Promise.resolve();
function keep(key: string, value: string | null): Promise<void> {
  keeping = keeping.then(async () => {
    const saved = await savedPage();
    if (value === null) delete saved[key];
    else saved[key] = value;
    await chrome.storage.local.set({ [PAGE_STORE]: saved });
  });
  return keeping;
}

function viewedKey(number: number): string {
  return `viewed:${owner}/${repo}#${number}`.toLowerCase();
}

async function viewedOf(number: number): Promise<Set<string>> {
  const stored = await chrome.storage.local.get(viewedKey(number));
  const paths = stored[viewedKey(number)];
  return new Set(Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : []);
}

type HostMessage = {
  type?: string;
  number?: number;
  state?: Asked;
  author?: string;
  search?: string;
  path?: string;
  paths?: string[];
  viewed?: boolean;
};

window.addEventListener("message", (event) => {
  const frame = [graphFrame, sideFrame].find((f) => f.contentWindow === event.source);
  if (!frame) return;
  const data = event.data ?? {};
  if (typeof data.odinError === "string") console.error(`Odin page: ${data.odinError}`);
  if (data.odinStore && typeof data.odinStore.key === "string") {
    void keep(data.odinStore.key, data.odinStore.value ?? null);
  }
  if (frame === graphFrame && data.odinUnlock === true) toggleFeatures(true);
  if (frame === graphFrame && remote && data.odinHost && typeof data.odinHost === "object") remote.post(outgoing(data.odinHost as Record<string, unknown>));
  if (frame === sideFrame && data.odinHost && typeof data.odinHost === "object") {
    void fromSidebar(data.odinHost as HostMessage);
  }
});

function ready(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.odinReady !== true) return;
      window.removeEventListener("message", listener);
      resolve();
    };
    window.addEventListener("message", listener);
  });
}

let renderer: string | undefined;

async function show(frame: HTMLIFrameElement, html: string, hosted: boolean) {
  const loaded = ready(frame);
  frame.src = "page.html";
  await loaded;
  frame.contentWindow!.postMessage(
    { odinPage: html, saved: await savedPage(), hosted, ...(hosted && renderer ? { renderer } : {}) },
    "*",
  );
  frame.hidden = false;
}

function toSidebar(message: unknown) {
  sideFrame.contentWindow?.postMessage(message, "*");
}

function toGraph(message: unknown) {
  graphFrame.contentWindow?.postMessage(message, "*");
}

let reader: Api = {};
let viewer = "";
let asked: { state: Asked; author: string; search?: string } = { state: "open", author: "" };
let picker: PickerView = pickerOf([], "", asked);
let reading: { number: number; graph: ChangeGraph; viewed: Set<string> } | null = null;
let sidebarShown = false;

async function drawSidebar(model: SidebarModel) {
  if (!sidebarShown) {
    sidebarShown = true;
    await show(sideFrame, sidebarPage(model, dark), true);
    return;
  }
  toSidebar({ type: "model", model });
}

function showPicker() {
  closeRemote();
  reading = null;
  back.hidden = true;
  sideTitle.hidden = false;
  graphFrame.hidden = true;
  say("Choose a pull request to draw it.");
  void drawSidebar({ loading: false, picker });
}

async function readPicker() {
  try {
    if (settings.source === "vscode" && settings.token) {
      const port = await findBridge(settings.token, settings.port);
      if (!port) throw new BridgeError("VS Code is not answering.", "unreachable");
      const answer = await bridgePulls(port, settings.token, owner, repo, asked);
      picker = pickerOfSummaries(answer.pulls, answer.viewer || viewer, asked);
      return;
    }
    picker = pickerOf(await listPulls(place, reader, asked), viewer, asked);
  } catch (error) {
    picker = pickerOf([], viewer, asked, false);
    if (!reading) explain(error);
  }
}

const IN_VS_CODE = "Comes with Odin for VS Code.";
const NEEDS_ARROWS = "Needs Enable all features: arrows are found from the whole repository.";

function lockedFor(arrows: boolean): Record<string, string> {
  return {
    ...(arrows ? {} : { imports: NEEDS_ARROWS }),
    unchanged: arrows ? IN_VS_CODE : NEEDS_ARROWS,
    agents: IN_VS_CODE,
    autoNarrate: IN_VS_CODE,
    systemVoice: IN_VS_CODE,
    kokoroVoice: IN_VS_CODE,
  };
}

let settings: Settings = { source: "github" };

function showSource() {
  const label: Record<SourceKind, string> = {
    github: "Enable all features",
    vscode: "Synced with: VS Code",
    browser: "Computed in: browser",
  };
  enableLabel.textContent = label[settings.source];
  if (settings.source !== "vscode") setLink("off");
  enable.classList.toggle("on", settings.source !== "github");
  for (const choice of features.querySelectorAll<HTMLElement>(".choice")) {
    choice.classList.toggle("chosen", choice.dataset.source === settings.source);
  }
}

function offerBasic(why: string, detail: string, number: number) {
  say(why, detail);
  const retry = document.createElement("button");
  retry.textContent = "Try again";
  retry.addEventListener("click", () => void openPull(number).catch(explain));
  const basic = document.createElement("button");
  basic.textContent = "Draw without arrows";
  basic.addEventListener("click", () => void openPull(number, "github").catch(explain));
  status.append(retry, basic);
}

let remote: Remote | undefined;

const OWN = 1_000_000_000;
const ASKED = new Set(["say", "speak"]);
const ANSWERED = new Set(["saying", "said", "spoken"]);

function outgoing(message: Record<string, unknown>): Record<string, unknown> {
  const payload = message.payload as { id?: unknown } | undefined;
  if (!ASKED.has(String(message.type)) || typeof payload?.id !== "number") return message;
  return { ...message, payload: { ...payload, id: payload.id + OWN } };
}

function incoming(message: unknown): unknown {
  const answer = message as { type?: unknown; id?: unknown } | null;
  if (!answer || !ANSWERED.has(String(answer.type)) || typeof answer.id !== "number") return message;
  if (answer.id < OWN) return undefined;
  return { ...answer, id: answer.id - OWN };
}

function closeRemote() {
  remote?.close();
  remote = undefined;
  goLive.hidden = true;
}

goLiveButton.addEventListener("click", () => {
  if (!remote) return;
  goLiveButton.disabled = true;
  goLiveFailed.hidden = true;
  goLiveButton.textContent = "Going live in VS Code…";
  remote.post({ odinGoLive: true });
});

function withVariables(html: string): string {
  const vars = rootVariables(dark);
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (open) => open + vars) : vars + html;
}

function explainBridge(error: BridgeError, number: number) {
  const detail = error.reason === "no-repository"
    ? "Open that repository's folder in VS Code, or draw this one without arrows."
    : "Is VS Code open, with Odin installed and connected?";
  offerBasic(error.message, detail, number);
}

async function openInVsCode(number: number, quiet = false): Promise<boolean> {
  const tell = (text: string) => {
    if (!quiet) say(text);
  };
  const { pull } = await readPull({ owner, repo, number }, reader);
  const port = await vsCodePort(settings, owner, repo, tell);
  const viewed = await viewedOf(number);
  let drawn = false;
  let pages = 0;
  let held: unknown[] | undefined = [];
  const opened = await openSession(
    port,
    settings.token!,
    { owner, repo, number, base: pull.base.ref, head: pull.head.ref },
    {
      note: (text) => {
        if (!drawn) tell(text);
      },
      graph: (graph) => {
        reading = { number, graph, viewed };
        back.hidden = false;
        sideTitle.hidden = true;
        void drawSidebar(changeModel(graph, viewed, picker));
      },
      reading: ({ live, branch }) => {
        goLive.hidden = live || !branch;
        goLiveFailed.hidden = true;
        goLiveBranch.textContent = branch;
        goLiveButton.replaceChildren("Go live in: ", goLiveBranch);
        goLiveButton.disabled = false;
      },
      wentLive: () => {
        void openPull(number);
      },
      renderer: (source) => {
        renderer = source;
      },
      goLiveFailed: (message) => {
        goLiveButton.replaceChildren("Go live in: ", goLiveBranch);
        goLiveButton.disabled = false;
        goLiveFailed.textContent = message;
        goLiveFailed.hidden = false;
      },
      html: (html) => {
        drawn = true;
        reconnects = 0;
        setLink("ok");
        const page = ++pages;
        held = [];
        void show(graphFrame, withVariables(html), true).then(() => {
          if (page !== pages) return;
          const waiting = held;
          held = undefined;
          for (const message of waiting ?? []) toGraph(message);
          status.hidden = true;
          window.parent.postMessage({ odinReading: number }, "https://github.com");
        });
      },
      message: (message) => {
        const mine = incoming(message);
        if (mine === undefined) return;
        if (held) held.push(mine);
        else toGraph(mine);
      },
      ended: (error) => {
        if (reading?.number !== number || remote !== opened) return;
        if (drawn && reconnects < 15) {
          reconnects++;
          setLink("retrying");
          setTimeout(() => {
            if (reading?.number === number && remote === opened) void reconnect(number);
          }, 2000);
          return;
        }
        if (error) {
          setLink("down");
          graphFrame.hidden = true;
          explainBridge(error, number);
        }
      },
    },
  );
  if (!opened) return false;
  remote = opened;
  return true;
}

let reconnects = 0;

async function reconnect(number: number) {
  try {
    if (await openInVsCode(number, true)) return;
  } catch {
    if (reconnects < 15) {
      reconnects++;
      setTimeout(() => {
        if (reading?.number === number) void reconnect(number);
      }, 2000);
      return;
    }
  }
  setLink("down");
  graphFrame.hidden = true;
  explainBridge(new BridgeError("VS Code stopped answering.", "unreachable"), number);
}

async function openPull(number: number, once?: SourceKind) {
  closeRemote();
  graphFrame.hidden = true;
  say(`Reading #${number}…`);
  if (!once && settings.source === "vscode") {
    try {
      if (await openInVsCode(number)) return;
    } catch (error) {
      if (error instanceof BridgeError) {
        if (error.reason === "unreachable") setLink("down");
        explainBridge(error, number);
        return;
      }
      throw error;
    }
  }
  const using: Settings = once ? { ...settings, source: once } : settings;
  let drawing;
  try {
    drawing = await draw(using, owner, repo, number, reader, (text) => say(text));
  } catch (error) {
    if (error instanceof BridgeError) {
      explainBridge(error, number);
      return;
    }
    throw error;
  }
  const { pull, graph } = drawing;
  say(`Drawing #${pull.number} ${pull.title}…`);
  const viewed = await viewedOf(number);
  reading = { number, graph, viewed };
  back.hidden = false;
  sideTitle.hidden = true;
  void drawSidebar(changeModel(graph, viewed, picker));
  const html = await pageOf(pull, graph, {
    dark,
    snippets: drawing.snippets,
    locked: lockedFor(drawing.arrows),
    version: chrome.runtime.getManifest().version,
    unlock: true,
  });
  await show(graphFrame, html, false);
  toGraph({ type: "setViewed", paths: [...viewed], viewed: true });
  status.hidden = true;
  window.parent.postMessage({ odinReading: number }, "https://github.com");
}

function redraw() {
  if (reading) void openPull(reading.number).catch(explain);
}

let waiting = 0;

function line(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

function pairingHelp(token: string) {
  const code = `${chrome.runtime.id}:${token}`;
  const install = document.createElement("a");
  install.href = "https://marketplace.visualstudio.com/items?itemName=powerengine98.odin-pr-review";
  install.target = "_blank";
  install.rel = "noopener";
  install.textContent = "Install Odin for VS Code";
  const shown = document.createElement("code");
  shown.textContent = code;
  const copy = document.createElement("button");
  copy.textContent = "Copy code";
  copy.addEventListener("click", () => void navigator.clipboard.writeText(code).then(() => (copy.textContent = "Copied")));
  pairing.replaceChildren(
    line("VS Code has not answered yet."),
    install,
    line("Or, in VS Code, run “Odin: Connect the Browser Extension” and paste:"),
    shown,
    copy,
  );
}

async function connectVsCode() {
  const token = settings.token ?? newToken();
  if (!settings.token) {
    settings = { ...settings, token };
    await saveSettings({ token });
  }
  launch(pairingLink(token, chrome.runtime.id));
  pairing.hidden = false;
  pairing.replaceChildren(line("Opening VS Code… Allow Odin there, then come back."));

  const attempt = ++waiting;
  const started = Date.now();
  while (attempt === waiting && !features.hidden) {
    const port = await findBridge(token, settings.port);
    if (port) {
      settings = { ...settings, source: "vscode", port };
      await saveSettings({ source: "vscode", port });
      reader = await api();
      pairing.hidden = true;
      features.hidden = true;
      enable.setAttribute("aria-expanded", "false");
      showSource();
      redraw();
      return;
    }
    if (Date.now() - started > 8000) pairingHelp(token);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function choose(source: SourceKind) {
  waiting++;
  if (source === "vscode") {
    await connectVsCode();
    return;
  }
  settings = { ...settings, source };
  await saveSettings({ source });
  reader = await api();
  pairing.hidden = true;
  features.hidden = true;
  enable.setAttribute("aria-expanded", "false");
  showSource();
  redraw();
}

function toggleFeatures(open = features.hidden) {
  features.hidden = !open;
  enable.setAttribute("aria-expanded", String(open));
  if (!open) {
    waiting++;
    pairing.hidden = true;
  }
}

link.addEventListener("click", (event) => {
  if (link.dataset.state !== "down") return;
  event.stopPropagation();
  setLink("retrying");
  reconnects = 0;
  if (reading) {
    void openPull(reading.number).catch(explain);
    return;
  }
  if (!settings.token) return;
  void findBridge(settings.token, settings.port).then(async (port) => {
    setLink(port ? "ok" : "down");
    if (!port) return;
    viewer = await whoAmI(reader).catch(() => "");
    await readPicker();
    if (Number.isInteger(first) && first > 0) await openPull(first);
    else showPicker();
  });
});

enable.addEventListener("click", () => toggleFeatures());
document.getElementById("features-close")!.addEventListener("click", () => toggleFeatures(false));
for (const choice of features.querySelectorAll<HTMLButtonElement>(".choice")) {
  choice.addEventListener("click", () => void choose(choice.dataset.source as SourceKind));
}

async function fromSidebar(message: HostMessage) {
  if (message.type === "read" && typeof message.number === "number") {
    await openPull(message.number).catch(explain);
    return;
  }
  if (message.type === "asked") {
    asked = {
      state: message.state ?? asked.state,
      author: typeof message.author === "string" ? message.author : asked.author,
      search: typeof message.search === "string" ? message.search : asked.search ?? "",
    };
    toSidebar({ type: "loading", value: true });
    await readPicker();
    toSidebar({ type: "model", model: { loading: false, picker } });
    return;
  }
  if (message.type === "focus" && typeof message.path === "string") {
    toGraph({ type: "focus", path: message.path });
    return;
  }
  if (message.type === "viewed" && Array.isArray(message.paths) && reading) {
    for (const path of message.paths) {
      if (message.viewed === true) reading.viewed.add(path);
      else reading.viewed.delete(path);
    }
    await chrome.storage.local.set({ [viewedKey(reading.number)]: [...reading.viewed] });
    toGraph({ type: "setViewed", paths: message.paths, viewed: message.viewed === true });
  }
}

back.addEventListener("click", () => {
  window.parent.postMessage({ odinReading: 0 }, "https://github.com");
  showPicker();
});

async function start() {
  settings = await readSettings();
  showSource();
  if (settings.source === "vscode" && settings.token) {
    void findBridge(settings.token, settings.port).then((port) => setLink(port ? "ok" : "down"));
  }
  reader = await api();
  viewer = await whoAmI(reader).catch(() => "");
  await readPicker();
  if (Number.isInteger(first) && first > 0) await openPull(first);
  else showPicker();
}

start().catch(explain);

const SIDE_WIDTH = "odinSideWidth";
const SIDE_DEFAULT = 320;
const shellEl = document.querySelector<HTMLElement>(".shell")!;
const sash = document.getElementById("sash")!;

function setSideWidth(width: number) {
  const clamped = Math.round(Math.min(Math.max(width, 200), Math.max(260, window.innerWidth * 0.6)));
  shellEl.style.setProperty("--side-width", `${clamped}px`);
  return clamped;
}

function quietly(write: () => void) {
  try {
    write();
  } catch {
    return;
  }
}

quietly(() => {
  const kept = Number(localStorage.getItem(SIDE_WIDTH));
  if (kept > 0) setSideWidth(kept);
});

sash.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  sash.setPointerCapture(event.pointerId);
  sash.classList.add("dragging");
  document.body.classList.add("resizing");
  const left = shellEl.getBoundingClientRect().left;
  let width = SIDE_DEFAULT;
  const move = (moved: PointerEvent) => {
    width = setSideWidth(moved.clientX - left);
  };
  const stop = () => {
    sash.classList.remove("dragging");
    document.body.classList.remove("resizing");
    sash.removeEventListener("pointermove", move);
    sash.removeEventListener("pointerup", stop);
    sash.removeEventListener("pointercancel", stop);
    quietly(() => localStorage.setItem(SIDE_WIDTH, String(width)));
  };
  sash.addEventListener("pointermove", move);
  sash.addEventListener("pointerup", stop);
  sash.addEventListener("pointercancel", stop);
});

sash.addEventListener("dblclick", () => {
  setSideWidth(SIDE_DEFAULT);
  quietly(() => localStorage.removeItem(SIDE_WIDTH));
});
