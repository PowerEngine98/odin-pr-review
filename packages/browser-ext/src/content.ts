import { placeOf, type Place } from "./github.js";

type Mode = "repo" | "pull";

const TAB = "data-odin-tab";
const HASH = "#odin";

let overlay: HTMLDivElement | null = null;
let quieted: HTMLAnchorElement[] = [];
let seen = location.href;

const NAVS: Record<Mode, string> = {
  repo: 'nav[aria-label="Repository"]',
  pull: 'nav[aria-label="Pull request"], nav[aria-label="Pull request navigation"]',
};

function navOf(mode: Mode): HTMLElement | null {
  return document.querySelector(NAVS[mode]);
}

function ours(nav: ParentNode): HTMLAnchorElement | null {
  const tab = nav.querySelector(`[${TAB}]`);
  if (!tab) return null;
  return tab instanceof HTMLAnchorElement ? tab : tab.querySelector("a");
}

function hrefOf(place: Place, mode: Mode): string {
  if (mode === "pull") return `/${place.owner}/${place.repo}/pull/${place.number}${HASH}`;
  return `/${place.owner}/${place.repo}/pulls${HASH}`;
}

function icon(): HTMLImageElement {
  const image = document.createElement("img");
  image.src = chrome.runtime.getURL("icon16.png");
  image.width = 16;
  image.height = 16;
  image.alt = "";
  image.className = "odin-tab-icon";
  return image;
}

function holderOf(link: HTMLAnchorElement): HTMLElement {
  const parent = link.parentElement;
  return parent instanceof HTMLLIElement ? parent : link;
}

function tabLike(model: HTMLAnchorElement, href: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = [...model.classList]
    .filter((name) => !/^(active|selected)/.test(name))
    .join(" ");
  link.href = href;

  const iconSlot = model.querySelector('[data-component="icon"]');
  if (iconSlot) {
    const slot = iconSlot.cloneNode(false) as HTMLElement;
    slot.append(icon());
    link.append(slot);
  } else if (model.querySelector("svg")) {
    link.append(icon(), " ");
  }

  const textSlot = model.querySelector('[data-component="text"]');
  if (textSlot) {
    const text = textSlot.cloneNode(false) as HTMLElement;
    text.textContent = "Odin";
    text.setAttribute("data-content", "Odin");
    link.append(text);
  } else {
    link.append("Odin");
  }
  return link;
}

function addTab(mode: Mode, place: Place) {
  const nav = navOf(mode);
  if (!nav || ours(nav)) return;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const model = links.at(-1);
  if (!model) return;

  const link = tabLike(model, hrefOf(place, mode));
  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState(history.state, "", link.href);
    seen = location.href;
    open();
  });

  const holder = holderOf(model);
  let tab: HTMLElement = link;
  if (holder instanceof HTMLLIElement) {
    tab = holder.cloneNode(false) as HTMLLIElement;
    tab.append(link);
  }
  tab.setAttribute(TAB, mode);

  if (mode === "pull") {
    const first = holderOf(links[0]!);
    first.before(tab);
    return;
  }
  const pulls = links.find((a) => /\/pulls$/.test(a.pathname));
  (pulls ? holderOf(pulls) : holder).after(tab);
}

function ensureTabs() {
  const place = placeOf(location.pathname);
  if (!place) return;
  addTab("repo", place);
  if (place.number) addTab("pull", place);
}

function theme(): "dark" | "light" {
  const root = document.documentElement;
  const mode = root.dataset.colorMode;
  if (mode === "dark" || mode === "light") return mode;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function fit() {
  if (!overlay) return;
  const nav = navOf(overlay.dataset.mode as Mode);
  const top = nav ? nav.getBoundingClientRect().bottom + window.scrollY : 0;
  overlay.style.top = `${top}px`;
  overlay.style.height = `${Math.max(window.innerHeight - top, 480)}px`;
}

let selectedClasses: string[] = [];

function selectionOf(link: HTMLAnchorElement): string[] {
  return [...link.classList].filter((name) => /^selected/.test(name));
}

function markCurrent(mode: Mode) {
  const nav = navOf(mode);
  const link = nav && ours(nav);
  if (!nav || !link) return;
  quieted = [...nav.querySelectorAll<HTMLAnchorElement>("a[aria-current]")].filter((a) => a !== link);
  selectedClasses = quieted.flatMap(selectionOf);
  for (const other of quieted) {
    other.removeAttribute("aria-current");
    other.classList.remove(...selectionOf(other));
  }
  link.setAttribute("aria-current", "page");
  link.classList.add(...selectedClasses);
}

function close() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  document.documentElement.classList.remove("odin-open");
  for (const mode of ["repo", "pull"] as const) {
    const nav = navOf(mode);
    const link = nav && ours(nav);
    if (!link) continue;
    link.removeAttribute("aria-current");
    link.classList.remove(...selectionOf(link));
  }
  for (const link of quieted) {
    link.setAttribute("aria-current", "page");
    link.classList.add(...selectedClasses);
  }
  quieted = [];
  selectedClasses = [];
}

function open() {
  const place = placeOf(location.pathname);
  if (!place) return;
  close();
  ensureTabs();
  const mode: Mode = place.number ? "pull" : "repo";
  const query = new URLSearchParams({ owner: place.owner, repo: place.repo, theme: theme() });
  if (place.number) query.set("number", String(place.number));

  window.scrollTo(0, 0);
  overlay = document.createElement("div");
  overlay.className = "odin-overlay";
  overlay.dataset.mode = mode;
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL(`viewer.html?${query}`);
  frame.title = "Odin";
  frame.allow = "clipboard-write";
  overlay.append(frame);
  document.body.append(overlay);
  document.documentElement.classList.add("odin-open");
  markCurrent(mode);
  fit();
}

function followUrl() {
  if (location.href === seen) return;
  seen = location.href;
  if (location.hash === HASH) open();
  else close();
}

function alive(): boolean {
  if (chrome.runtime?.id) return true;
  observer.disconnect();
  clearInterval(ticking);
  window.removeEventListener("popstate", followUrl);
  window.removeEventListener("resize", fit);
  return false;
}

let queued = false;
const observer = new MutationObserver(() => {
  if (queued || !alive()) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    ensureTabs();
    followUrl();
    const nav = overlay && navOf(overlay.dataset.mode as Mode);
    if (overlay && nav && !ours(nav)?.hasAttribute("aria-current")) {
      markCurrent(overlay.dataset.mode as Mode);
    }
  });
});
observer.observe(document.body, { childList: true, subtree: true });

const EXTENSION = new URL(chrome.runtime.getURL("")).origin;

window.addEventListener("message", (event) => {
  if (event.origin !== EXTENSION || typeof event.data?.odinOpen !== "number") return;
  const place = placeOf(location.pathname);
  if (!place) return;
  location.assign(`/${place.owner}/${place.repo}/pull/${event.data.odinOpen}${HASH}`);
});

window.addEventListener("popstate", followUrl);
window.addEventListener("resize", fit);
const ticking = setInterval(() => {
  if (alive()) followUrl();
}, 500);

ensureTabs();
if (location.hash === HASH) open();
