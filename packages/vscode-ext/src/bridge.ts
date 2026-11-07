import type { Server } from "node:http";

import { git } from "@odin/core";
import * as vscode from "vscode";

import { listen, NotHere, type Pairing, type Served } from "./bridge-server.js";
import { buildGraphForRepo } from "./graph.js";

const TOKEN = "odin.browser.token";
const ORIGIN = "odin.browser.origin";

export function remoteFor(remotes: string, owner: string, repo: string): string | undefined {
  const wanted = `${owner}/${repo}`.toLowerCase();
  for (const line of remotes.split("\n")) {
    const [name, url] = line.trim().split(/\s+/);
    if (!name || !url) continue;
    const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
    if (match && `${match[1]}/${match[2]}`.toLowerCase() === wanted) return name;
  }
  return undefined;
}

export function pairingFrom(query: string): Pairing | undefined {
  const params = new URLSearchParams(query);
  const token = params.get("token") ?? "";
  const origin = params.get("from") ?? "";
  if (!/^[0-9a-f]{32,128}$/.test(token)) return undefined;
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return undefined;
  return { token, origin };
}

export class BrowserBridge implements vscode.Disposable {
  private pairing: Pairing | undefined;
  private server: Server | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async start(): Promise<void> {
    const token = await this.context.secrets?.get(TOKEN).then(undefined, () => undefined);
    const origin = this.context.globalState?.get<string>(ORIGIN);
    if (!token || !origin) return;
    this.pairing = { token, origin };
    await this.open();
  }

  async pairFromUri(uri: vscode.Uri): Promise<void> {
    const pairing = pairingFrom(uri.query);
    if (!pairing) {
      void vscode.window.showErrorMessage("Odin: that connection link from the browser is not valid.");
      return;
    }
    await this.pair(pairing);
  }

  async pairByCode(): Promise<void> {
    const code = await vscode.window.showInputBox({
      title: "Connect Odin's browser extension",
      prompt: "Paste the code the browser extension shows under Enable all features",
      ignoreFocusOut: true,
    });
    if (!code) return;
    const [id, token] = code.trim().split(":");
    const pairing = pairingFrom(new URLSearchParams({ token: token ?? "", from: `chrome-extension://${id ?? ""}` }).toString());
    if (!pairing) {
      void vscode.window.showErrorMessage("Odin: that code is not one the browser extension makes.");
      return;
    }
    await this.pair(pairing);
  }

  async disconnect(): Promise<void> {
    await this.context.secrets.delete(TOKEN);
    await this.context.globalState.update(ORIGIN, undefined);
    this.pairing = undefined;
    this.close();
    void vscode.window.showInformationMessage("Odin: the browser extension is disconnected.");
  }

  dispose(): void {
    this.close();
  }

  private async pair(pairing: Pairing): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      "Let Odin's browser extension read pull requests from the repositories open in VS Code?",
      {
        modal: true,
        detail: `Asked by ${pairing.origin}. It reaches this window only on 127.0.0.1, with the code it sent, and only reads: graphs of pull requests whose repository is open here.`,
      },
      "Allow",
    );
    if (choice !== "Allow") return;
    await this.context.secrets.store(TOKEN, pairing.token);
    await this.context.globalState.update(ORIGIN, pairing.origin);
    this.pairing = pairing;
    const port = await this.open();
    if (port) {
      void vscode.window.showInformationMessage("Odin: the browser extension is connected. Back in GitHub, it now draws arrows from here.");
    } else {
      void vscode.window.showErrorMessage("Odin: no free port between 47920 and 47929 to talk to the browser on.");
    }
  }

  private async open(): Promise<number | undefined> {
    if (this.server) {
      const address = this.server.address();
      return typeof address === "object" && address ? address.port : undefined;
    }
    const version = String(this.context.extension.packageJSON.version ?? "");
    const opened = await listen(() => this.pairing, {
      version,
      graph: (owner, repo, number, base) => this.serialized(() => this.graph(owner, repo, number, base)),
    });
    if (!opened) return undefined;
    this.server = opened.server;
    return opened.port;
  }

  private close(): void {
    this.server?.close();
    this.server = undefined;
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async repositoryFor(owner: string, repo: string): Promise<{ cwd: string; remote: string } | undefined> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const cwd = folder.uri.fsPath;
      const remotes = await git(["remote", "-v"], { cwd }).catch(() => "");
      const remote = remoteFor(remotes, owner, repo);
      if (remote) return { cwd, remote };
    }
    return undefined;
  }

  private async graph(owner: string, repo: string, number: number, base: string): Promise<Served> {
    const found = await this.repositoryFor(owner, repo);
    if (!found) throw new NotHere(`${owner}/${repo} is not open in VS Code. Open its folder there, then try again.`);
    const { cwd, remote } = found;
    await git(["fetch", "--quiet", remote, `refs/pull/${number}/head`], { cwd });
    const head = (await git(["rev-parse", "FETCH_HEAD"], { cwd })).trim();
    if (base) await git(["fetch", "--quiet", remote, base], { cwd }).catch(() => "");
    const settings = vscode.workspace.getConfiguration("odin");
    const built = await buildGraphForRepo({
      cwd,
      headRef: head,
      ...(base ? { baseRef: `${remote}/${base}` } : {}),
      number,
      includeImports: true,
      includeContext: settings.get<boolean>("includeContext", false),
    });
    return { graph: built.graph, snippets: [...built.snippets] };
  }
}
