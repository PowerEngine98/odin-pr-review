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
import { graphOf, pageOf } from "./page.js";
import { changeModel, pickerOf, sidebarPage } from "./picker.js";

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
  button.addEventListener("click", () => chrome.runtime.openOptionsPage());
  status.append(button);
}

function explain(error: unknown) {
  graphFrame.hidden = true;
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

async function show(frame: HTMLIFrameElement, html: string, hosted: boolean) {
  const loaded = ready(frame);
  frame.src = "page.html";
  await loaded;
  frame.contentWindow!.postMessage({ odinPage: html, saved: await savedPage(), hosted }, "*");
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
let asked: { state: Asked; author: string } = { state: "open", author: "" };
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
  reading = null;
  back.hidden = true;
  sideTitle.hidden = false;
  graphFrame.hidden = true;
  say("Choose a pull request to draw it.");
  void drawSidebar({ loading: false, picker });
}

async function readPicker() {
  try {
    picker = pickerOf(await listPulls(place, reader, asked), viewer, asked);
  } catch (error) {
    picker = pickerOf([], viewer, asked, false);
    if (!reading) explain(error);
  }
}

async function openPull(number: number) {
  graphFrame.hidden = true;
  say(`Reading #${number}…`);
  const { pull, diff } = await readPull({ owner, repo, number }, reader);
  say(`Drawing #${pull.number} ${pull.title}…`);
  const graph = graphOf(pull, diff);
  const viewed = await viewedOf(number);
  reading = { number, graph, viewed };
  back.hidden = false;
  sideTitle.hidden = true;
  void drawSidebar(changeModel(graph, viewed, picker));
  await show(graphFrame, await pageOf(pull, diff, { dark }), false);
  toGraph({ type: "setViewed", paths: [...viewed], viewed: true });
  status.hidden = true;
  window.parent.postMessage({ odinReading: number }, "https://github.com");
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
  reader = await api();
  viewer = await whoAmI(reader).catch(() => "");
  await readPicker();
  if (Number.isInteger(first) && first > 0) await openPull(first);
  else showPicker();
}

start().catch(explain);
