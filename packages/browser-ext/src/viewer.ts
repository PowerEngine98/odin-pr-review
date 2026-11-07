import {
  GitHubError,
  listPulls,
  readPull,
  whoAmI,
  type Api,
  type Asked,
  type Place,
} from "./github.js";
import { pageOf } from "./page.js";
import { pickerOf, pickerPage } from "./picker.js";

const params = new URLSearchParams(location.search);
const owner = params.get("owner") ?? "";
const repo = params.get("repo") ?? "";
const number = Number(params.get("number") ?? "");
const dark = params.get("theme") !== "light";
const place: Place = { owner, repo };

document.documentElement.dataset.theme = dark ? "dark" : "light";

const status = document.getElementById("status")!;
const frame = document.getElementById("page") as HTMLIFrameElement;

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
  frame.hidden = true;
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

type HostMessage = { type?: string; number?: number; state?: Asked; author?: string };
let onHost: (message: HostMessage) => void = () => {};

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow) return;
  const data = event.data ?? {};
  if (typeof data.odinError === "string") console.error(`Odin page: ${data.odinError}`);
  if (data.odinStore && typeof data.odinStore.key === "string") {
    void keep(data.odinStore.key, data.odinStore.value ?? null);
  }
  if (data.odinHost && typeof data.odinHost === "object") onHost(data.odinHost as HostMessage);
});

function sandboxReady(): Promise<void> {
  return new Promise((resolve) => {
    const ready = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.odinReady !== true) return;
      window.removeEventListener("message", ready);
      resolve();
    };
    window.addEventListener("message", ready);
  });
}

async function show(html: string, hosted: boolean) {
  const ready = sandboxReady();
  frame.src = "page.html";
  await ready;
  frame.contentWindow!.postMessage({ odinPage: html, saved: await savedPage(), hosted }, "*");
  frame.hidden = false;
  status.hidden = true;
}

async function showPull(pull: Required<Place>) {
  say(`Reading #${pull.number}…`);
  const { pull: json, diff } = await readPull(pull, await api());
  say(`Drawing #${json.number} ${json.title}…`);
  await show(await pageOf(json, diff, { dark }), false);
}

async function showPicker() {
  say("Reading pull requests…");
  const reader = await api();
  const viewer = await whoAmI(reader).catch(() => "");
  let asked: { state: Asked; author: string } = { state: "open", author: "" };
  const picker = pickerOf(await listPulls(place, reader, asked), viewer, asked);

  onHost = (message) => {
    if (message.type === "read" && typeof message.number === "number") {
      window.parent.postMessage({ odinOpen: message.number }, "https://github.com");
      return;
    }
    if (message.type !== "asked") return;
    asked = {
      state: message.state ?? asked.state,
      author: typeof message.author === "string" ? message.author : asked.author,
    };
    frame.contentWindow?.postMessage({ type: "loading", value: true }, "*");
    listPulls(place, reader, asked)
      .then((pulls) => pickerOf(pulls, viewer, asked))
      .catch(() => pickerOf([], viewer, asked, false))
      .then((next) => {
        frame.contentWindow?.postMessage({ type: "model", model: { loading: false, picker: next } }, "*");
      });
  };

  await show(pickerPage(picker, dark), true);
}

const shown = Number.isInteger(number) && number > 0
  ? showPull({ owner, repo, number })
  : showPicker();
shown.catch(explain);
