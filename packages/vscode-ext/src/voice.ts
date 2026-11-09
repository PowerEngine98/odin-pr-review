import { spawn, type ChildProcess } from "node:child_process";

/**
 * The operating system's own voice, for a page that wants an answer read aloud.
 *
 * macOS only, through `say`, which speaks with whatever voice the reader chose
 * in the system's settings — often a downloaded one, and far smoother than what
 * a webview is given. The text goes in on stdin so nothing in it can be read as
 * an option. One sentence at a time, and a new one stops the last.
 *
 * Anywhere else, or when `say` will not run, the page is told it failed and
 * reads with the browser's voice from then on.
 */
export class SystemVoice {
  private speaking: ChildProcess | undefined;

  say(text: string, started: () => void, ended: (ok: boolean) => void): void {
    this.hush();
    if (process.platform !== "darwin") {
      ended(false);
      return;
    }
    const child = spawn("say", ["-f", "-"], { stdio: ["pipe", "ignore", "ignore"] });
    this.speaking = child;
    let over = false;
    const finish = (ok: boolean) => {
      if (over) return;
      over = true;
      if (this.speaking === child) this.speaking = undefined;
      if (!child.killed) ended(ok);
    };
    child.once("spawn", started);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(text);
  }

  hush(): void {
    const child = this.speaking;
    this.speaking = undefined;
    if (child && child.exitCode === null) child.kill();
  }
}
