/**
 * Driving a real editor, so a question about tabs has an answer.
 *
 * Everything else in this repository can be exercised without one: the layout
 * is arithmetic, the page is a document a headless browser will load, and the
 * panel's own bookkeeping runs against a stub. What none of that reaches is the
 * editor itself — how many tabs opening a change actually produces, whether a
 * webview with a host behind it draws what the standalone document does, what a
 * command does when a real workspace is under it.
 *
 * Those are the faults that kept coming back as screen recordings, because the
 * only way anybody could see them was to look. VS Code is Electron, so it
 * speaks the same debugging protocol as a browser; given a port it can be
 * driven and read like any other page.
 *
 * Run it with a repository and a command:
 *
 *   node scripts/drive.mjs <repo> "Odin: Review Pull Request as a Graph"
 *
 * It leaves the editor running so the next question can be asked of the same
 * window; `--close` when finished.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

const APP = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const CLI = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";

/**
 * A short path, and it has to be short.
 *
 * The editor puts a unix socket inside its user data directory, and a socket
 * path over 103 characters is refused by the kernel — so a scratch directory
 * nested five deep starts an editor that exits before it draws anything, with
 * the reason four lines into a log nobody was reading.
 */
const HOME = "/tmp/ovs";
const PORT = 9333;

export async function endpoint(port = PORT, tries = 80) {
  for (let n = 0; n < tries; n++) {
    try {
      const found = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await found.json();
      const page = targets.find((one) => one.type === "page");
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  throw new Error("the editor never opened a debuggable window");
}

/** Installs this build into the driven editor's own profile. */
export function install(vsix) {
  mkdirSync(`${HOME}/user`, { recursive: true });
  mkdirSync(`${HOME}/ext`, { recursive: true });
  return new Promise((done) => {
    const run = spawn(CLI, [
      "--user-data-dir", `${HOME}/user`,
      "--extensions-dir", `${HOME}/ext`,
      "--install-extension", vsix,
    ], { stdio: "ignore" });
    run.on("exit", done);
  });
}

/** Opens a window on a repository, with the protocol listening. */
export function open(repo, port = PORT) {
  return spawn(APP, [
    "--user-data-dir", `${HOME}/user`,
    "--extensions-dir", `${HOME}/ext`,
    `--remote-debugging-port=${port}`,
    "--disable-workspace-trust",
    "--new-window",
    repo,
  ], { stdio: "ignore", detached: true });
}

/** A connection to one target, with the calls this needs. */
export async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = () => no(new Error("could not attach to the editor"));
  });

  let id = 0;
  const waiting = new Map();
  ws.onmessage = (message) => {
    const said = JSON.parse(message.data);
    if (said.id && waiting.has(said.id)) {
      waiting.get(said.id)(said);
      waiting.delete(said.id);
    }
  };

  const send = (method, params = {}) =>
    new Promise((ok) => {
      const at = ++id;
      waiting.set(at, ok);
      ws.send(JSON.stringify({ id: at, method, params }));
      // A call that never comes back is a run that hangs for ever, which is
      // worse than one that reports nothing.
      setTimeout(() => {
        if (waiting.has(at)) {
          waiting.delete(at);
          ok({ result: {} });
        }
      }, 30000);
    });

  const evaluate = async (expression) => {
    const said = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (said.result?.exceptionDetails) {
      throw new Error(
        said.result.exceptionDetails.exception?.description ?? "threw in the editor",
      );
    }
    return said.result?.result?.value;
  };

  return { send, evaluate, close: () => ws.close() };
}

/**
 * Running a command the way a reader does.
 *
 * Through the palette rather than through any API: what is being tested is what
 * happens when somebody asks for a change, and an editor driven by its own
 * internals is not answering that question.
 */
export async function run(page, title) {
  const key = (type, extra) =>
    page.send("Input.dispatchKeyEvent", { type, ...extra });

  await key("keyDown", {
    key: "p", code: "KeyP", modifiers: 8 | 4,
    windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80,
  });
  await key("keyUp", {
    key: "p", code: "KeyP", modifiers: 8 | 4,
    windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80,
  });
  await wait(900);

  await page.send("Input.insertText", { text: `>${title}` });
  await wait(1200);

  await key("rawKeyDown", {
    key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  });
  await key("keyUp", {
    key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  });
}

/** What the editor is showing, as far as this needs to know. */
export const LOOK = `(() => {
  const tabs = [...document.querySelectorAll(".tabs-container .tab")].map(
    (tab) => (tab.getAttribute("aria-label") || tab.textContent || "").trim(),
  );
  return {
    tabs,
    odin: tabs.filter((name) => /odin|graph|#\\\\d/i.test(name)),
    webviews: document.querySelectorAll("iframe.webview").length,
    notice: [...document.querySelectorAll(".notification-list-item-message")]
      .map((one) => one.textContent.trim())
      .slice(0, 4),
  };
})()`;
