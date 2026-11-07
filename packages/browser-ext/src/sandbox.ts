import { relayedStorage, type Saved } from "./storage.js";

function install(name: "localStorage" | "sessionStorage", storage: Storage) {
  Object.defineProperty(window, name, { configurable: true, get: () => storage });
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || typeof event.data?.odinPage !== "string") return;
  const saved: Saved = event.data.saved ?? {};
  install("localStorage", relayedStorage(saved, (key, value) => {
    window.parent.postMessage({ odinStore: { key, value } }, "*");
  }));
  install("sessionStorage", relayedStorage({}, () => {}));
  if (event.data.hosted === true) {
    const host = {
      postMessage: (message: unknown) => window.parent.postMessage({ odinHost: message }, "*"),
      getState: () => undefined,
      setState: () => undefined,
    };
    Object.assign(window, { acquireVsCodeApi: () => host });
  }
  document.open();
  document.write(event.data.odinPage);
  document.close();
});
window.addEventListener("error", (event) => {
  window.parent.postMessage({ odinError: String(event.error?.stack ?? event.message) }, "*");
});
window.addEventListener("unhandledrejection", (event) => {
  window.parent.postMessage({ odinError: String(event.reason?.stack ?? event.reason) }, "*");
});
window.parent.postMessage({ odinReady: true }, "*");
