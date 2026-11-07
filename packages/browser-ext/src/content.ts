import { ODIN_MARK } from "../../webview/src/mark.js";

import { placeOf, type Place } from "./github.js";

type Mode = "repo" | "pull";

const TAB = "data-odin-tab";
const HASH = "#odin";

function odinHash(): { on: boolean; number?: number } {
  const match = /^#odin(\d*)$/.exec(location.hash);
  if (!match) return { on: false };
  return match[1] ? { on: true, number: Number(match[1]) } : { on: true };
}

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

function icon(): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(ODIN_MARK, "image/svg+xml").documentElement;
  const mark = document.importNode(parsed, true) as unknown as SVGSVGElement;
  mark.setAttribute("width", "16");
  mark.setAttribute("height", "16");
  mark.setAttribute("aria-hidden", "true");
  mark.setAttribute("focusable", "false");
  mark.classList.add("octicon", "odin-tab-icon");
  return mark;
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
    if (!alive()) return;
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

function stuckHeight(): number {
  let bottom = 0;
  for (const element of document.elementsFromPoint(window.innerWidth / 2, 1)) {
    for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position !== "fixed" && position !== "sticky") continue;
      const rect = node.getBoundingClientRect();
      if (rect.top <= 1) bottom = Math.max(bottom, rect.bottom);
    }
  }
  return bottom;
}

let furthest = 0;

function holdScroll() {
  if (overlay && window.scrollY > furthest + 1) window.scrollTo({ top: furthest, behavior: "instant" });
}

function fit(scroll = false) {
  if (!overlay) return;
  const nav = navOf(overlay.dataset.mode as Mode);
  if (!nav) return;
  const navTop = nav.getBoundingClientRect().top + window.scrollY;
  const navBottom = nav.getBoundingClientRect().bottom + window.scrollY;
  if (scroll) window.scrollTo({ top: navTop, behavior: "instant" });
  const stuck = stuckHeight();
  furthest = Math.max(navTop - stuck, 0);
  if (scroll && stuck > 0) window.scrollTo({ top: furthest, behavior: "instant" });
  overlay.style.top = `${navBottom}px`;
  overlay.style.height = `${Math.max(window.innerHeight - stuck - (navBottom - navTop), 320)}px`;
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
  const number = place.number ?? odinHash().number;
  if (number) query.set("number", String(number));

  overlay = document.createElement("div");
  overlay.className = "odin-overlay";
  overlay.dataset.mode = mode;
  const frame = document.createElement("iframe");
  frame.allow = "autoplay; clipboard-write";
  frame.src = chrome.runtime.getURL(`viewer.html?${query}`);
  frame.title = "Odin";
  frame.allow = "clipboard-write";
  overlay.append(frame);
  document.body.append(overlay);
  document.documentElement.classList.add("odin-open");
  markCurrent(mode);
  settle();
}

let settling: number[] = [];

function settle() {
  for (const timer of settling) clearTimeout(timer);
  const stop = () => {
    for (const timer of settling) clearTimeout(timer);
    settling = [];
  };
  for (const kind of ["wheel", "touchstart", "keydown", "mousedown"]) {
    window.addEventListener(kind, stop, { once: true, passive: true });
  }
  fit(true);
  settling = [300, 1000, 2500].map((delay) => window.setTimeout(() => fit(true), delay));
}

function followUrl() {
  if (!alive() || location.href === seen) return;
  seen = location.href;
  if (odinHash().on) open();
  else close();
}

function onResize() {
  fit();
}

function alive(): boolean {
  if (globalThis.chrome?.runtime?.id) return true;
  observer.disconnect();
  clearInterval(ticking);
  window.removeEventListener("popstate", followUrl);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("scroll", holdScroll);
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

const EXTENSION = `chrome-extension://${chrome.runtime.id}`;

window.addEventListener("message", (event) => {
  if (event.origin !== EXTENSION || typeof event.data?.odinReading !== "number") return;
  const place = placeOf(location.pathname);
  if (!place || !overlay || overlay.dataset.mode !== "repo") return;
  const number = event.data.odinReading;
  const path = number > 0
    ? `/${place.owner}/${place.repo}/pulls${HASH}${number}`
    : `/${place.owner}/${place.repo}/pulls${HASH}`;
  history.replaceState(history.state, "", path);
  seen = location.href;
});

window.addEventListener("popstate", followUrl);
window.addEventListener("resize", onResize);
window.addEventListener("scroll", holdScroll, { passive: true });
const ticking = setInterval(followUrl, 500);

ensureTabs();
if (odinHash().on) open();
