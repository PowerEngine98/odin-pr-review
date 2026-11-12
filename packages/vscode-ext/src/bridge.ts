import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { basename, join } from "node:path";

import { currentUser, forgeEnv, git, listPullRequests } from "@odin/core";
import * as vscode from "vscode";

import { randomUUID } from "node:crypto";

import { listen, NotHere, type Pairing, type PullQuery, type Served, type Session, type Sink, type Where } from "./bridge-server.js";
import { buildGraphForRepo } from "./graph.js";
import type { GraphPanel } from "./panel.js";
import { githubRepositories, Repositories } from "./repositories.js";

export type Presenter = (repo: string, number: number, base: string, head?: string) => Promise<GraphPanel | undefined>;
export type GoLive = (repo: string, number: number) => Promise<GraphPanel>;

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

  private readonly repositories: Repositories;
  private readonly offered = new Set<string>();
  private readonly watching: vscode.Disposable | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly present?: Presenter,
    private readonly goLive?: GoLive,
    private readonly followers?: Set<(old: GraphPanel, next: GraphPanel) => void>,
  ) {
    this.repositories = new Repositories(join(context.globalStorageUri?.fsPath ?? "", "repositories.json"));
    this.watching = vscode.workspace.onDidChangeWorkspaceFolders?.((change) => this.recordFolders(change.added));
  }

  async start(): Promise<void> {
    void this.recordOpen();
    void this.recordRecent();
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
    this.watching?.dispose();
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
      void vscode.window.showInformationMessage("Odin: GitHub is connected, with all features on.");
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
      where: (owner, repo) => this.where(owner, repo),
      session: (owner, repo, number, base, sink, head) => this.session(owner, repo, number, base, sink, head),
      graph: (owner, repo, number, base) => this.serialized(() => this.graph(owner, repo, number, base)),
      github: (path, accept) => githubThroughGh(path, accept),
      pulls: (owner, repo, query) => this.pulls(owner, repo, query),
    });
    if (!opened) return undefined;
    this.server = opened.server;
    return opened.port;
  }

  private close(): void {
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = undefined;
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  recordFolders(folders: readonly vscode.WorkspaceFolder[]): void {
    void this.recordPaths(folders.map((folder) => folder.uri.fsPath));
  }

  private async recordOpen(): Promise<void> {
    await this.recordPaths((vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath));
  }

  private async recordRecent(): Promise<void> {
    const recent = await vscode.commands
      .executeCommand<{ workspaces?: { folderUri?: vscode.Uri }[] }>("_workbench.getRecentlyOpened")
      .then(undefined, () => undefined);
    const paths = (recent?.workspaces ?? [])
      .map((entry) => entry.folderUri)
      .filter((uri): uri is vscode.Uri => uri?.scheme === "file")
      .map((uri) => uri.fsPath);
    await this.recordPaths(paths);
  }

  private async recordPaths(paths: string[]): Promise<void> {
    for (const path of paths) {
      if (!existsSync(join(path, ".git"))) continue;
      const remotes = await git(["remote", "-v"], { cwd: path }).catch(() => "");
      for (const name of githubRepositories(remotes)) this.repositories.record(name, path);
    }
  }

  private async candidates(owner: string, repo: string) {
    const name = `${owner}/${repo}`;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const remotes = await git(["remote", "-v"], { cwd: folder.uri.fsPath }).catch(() => "");
      if (remoteFor(remotes, owner, repo)) this.repositories.record(name, await rootOf(folder.uri.fsPath));
    }
    const known = await this.repositories.candidates(name, async (path) => {
      const remotes = await git(["remote", "-v"], { cwd: path }).catch(() => "");
      return remoteFor(remotes, owner, repo) !== undefined;
    });
    const roots = [...new Set(await Promise.all(known.paths.map(rootOf)))];
    return { paths: roots, ...(known.chosen ? { chosen: await rootOf(known.chosen) } : {}) };
  }

  private async settled(paths: string[]): Promise<string | undefined> {
    if (paths.length === 1) return paths[0];
    const here = paths.filter((path) => this.isOpenHere(path) || this.holdsOpenFolder(path));
    if (here.length === 1) return here[0];
    const pool = here.length > 0 ? here : paths;
    const main = [];
    for (const path of pool) if (!(await isLinkedWorktree(path))) main.push(path);
    return main.length === 1 ? main[0] : undefined;
  }

  private holdsOpenFolder(path: string): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((folder) => folder.uri.fsPath.startsWith(`${path}/`));
  }

  private async where(owner: string, repo: string): Promise<Where> {
    const { paths, chosen } = await this.candidates(owner, repo);
    if (chosen) return { path: chosen };
    const path = await this.settled(paths);
    if (path) return { path };
    return { need: paths.length === 0 ? "clone" : "pick" };
  }

  async resolveFromUri(uri: vscode.Uri): Promise<void> {
    const params = new URLSearchParams(uri.query);
    const owner = params.get("owner") ?? "";
    const repo = params.get("repo") ?? "";
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return;
    const name = `${owner}/${repo}`;
    const { paths, chosen } = await this.candidates(owner, repo);
    let path = chosen ?? (await this.settled(paths));
    if (!path && paths.length > 1) path = await this.pick(name, paths);
    if (!path && paths.length === 0) path = await this.clone(owner, repo);
    if (!path) return;
    this.repositories.choose(name, path);
    await this.openFolder(path);
  }

  private async pick(name: string, paths: string[]): Promise<string | undefined> {
    const picked = await vscode.window.showQuickPick(
      paths.map((path) => ({ label: basename(path), description: path, path })),
      {
        title: `Odin: which copy of ${name} should the browser read?`,
        placeHolder: "Odin remembers the choice for this repository",
        ignoreFocusOut: true,
      },
    );
    return picked?.path;
  }

  private async clone(owner: string, repo: string): Promise<string | undefined> {
    const name = `${owner}/${repo}`;
    const choice = await vscode.window.showInformationMessage(
      `${name} is not on this computer yet. Clone it so Odin can draw its arrows?`,
      { modal: true, detail: `Odin will run git clone https://github.com/${name}.git into a folder you choose.` },
      "Choose Folder…",
    );
    if (choice !== "Choose Folder…") return undefined;
    const parent = await vscode.window.showOpenDialog({
      title: `Where should ${name} be cloned?`,
      openLabel: "Clone Here",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    const into = parent?.[0]?.fsPath;
    if (!into) return undefined;
    const target = join(into, repo);
    if (existsSync(target)) {
      void vscode.window.showErrorMessage(`Odin: ${target} already exists. Choose another folder.`);
      return undefined;
    }
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Odin: cloning ${name}…` },
        () => git(["clone", "--quiet", `https://github.com/${name}.git`, target], { cwd: into }),
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Odin: could not clone ${name}. ${(error as Error).message}`);
      return undefined;
    }
    this.repositories.record(name, target);
    return target;
  }

  private isOpenHere(path: string): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((folder) => folder.uri.fsPath === path);
  }

  private async openFolder(path: string): Promise<void> {
    if (this.isOpenHere(path)) return;
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path), { forceNewWindow: true });
  }

  private openOnce(path: string): void {
    if (this.isOpenHere(path) || this.offered.has(path)) return;
    this.offered.add(path);
    void this.openFolder(path);
  }

  async openReading(owner: string, repo: string, number: number, base: string, head?: string): Promise<boolean> {
    if (!this.present) return false;
    const found = await this.where(owner, repo);
    if (!found.path) return false;
    const cwd = found.path;
    const panel = await this.serialized(() => this.present!(cwd, number, base, head));
    return panel !== undefined;
  }

  private renderer: string | null | undefined;

  private diagramRenderer(): string | null {
    if (this.renderer !== undefined) return this.renderer;
    try {
      this.renderer = readFileSync(join(this.context.extensionUri.fsPath, "dist", "media", "mermaid.min.js"), "utf8");
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  private async session(
    owner: string,
    repo: string,
    number: number,
    base: string,
    sink: Sink,
    head?: string,
  ): Promise<Session> {
    if (!this.present) throw new Error("This window cannot show readings.");
    const found = await this.where(owner, repo);
    if (!found.path) throw new NotHere(`${owner}/${repo} has no folder in VS Code yet.`);
    const cwd = found.path;
    sink.send({ type: "note", message: `VS Code is reading #${number}…` });
    const panel = await this.serialized(() => this.present!(cwd, number, base, head));
    if (!panel) throw new Error(`VS Code could not draw #${number}.`);
    sink.send({ type: "graph", graph: panel.changeGraph });
    sink.send({
      type: "reading",
      live: panel.changeGraph.meta.worktree === true,
      branch: (head ?? panel.changeGraph.meta.headRef ?? "").replace(/^origin\//, ""),
    });
    const renderer = this.diagramRenderer();
    if (renderer) sink.send({ type: "renderer", source: renderer });
    const mirror = {
      html: (html: string) => sink.send({ type: "html", html }),
      message: (message: unknown) => sink.send({ type: "message", message }),
    };
    let current = panel;
    let detach = current.attach(mirror);
    const moveTo = (next: GraphPanel) => {
      if (next === current) return;
      detach();
      current = next;
      sink.send({ type: "graph", graph: next.changeGraph });
      sink.send({
        type: "reading",
        live: next.changeGraph.meta.worktree === true,
        branch: (next.changeGraph.meta.headRef ?? "").replace(/^origin\//, ""),
      });
      detach = current.attach(mirror);
    };
    const follow = (old: GraphPanel, next: GraphPanel) => {
      if (old === current) moveTo(next);
    };
    this.followers?.add(follow);
    return {
      id: randomUUID(),
      deliver: (message) => {
        if ((message as { odinGoLive?: unknown } | null)?.odinGoLive === true) {
          if (!this.goLive) {
            sink.send({ type: "goLiveFailed", message: "This window cannot go live." });
            return;
          }
          void this.serialized(() => this.goLive!(cwd, number)).then(
            (live) => moveTo(live),
            (error: Error) => sink.send({ type: "goLiveFailed", message: `VS Code could not go live: ${error.message}` }),
          );
          return;
        }
        current.receive(message);
      },
      close: () => {
        this.followers?.delete(follow);
        detach();
      },
    };
  }

  private async pulls(owner: string, repo: string, query: PullQuery): Promise<{ pulls: unknown[]; viewer: string }> {
    const found = await this.where(owner, repo);
    if (!found.path) throw new NotHere(`${owner}/${repo} has no folder in VS Code yet.`);
    const cwd = found.path;
    const [pulls, viewer] = await Promise.all([
      listPullRequests({
        cwd,
        state: query.state,
        ...(query.author ? { author: query.author } : {}),
        ...(query.search ? { search: query.search } : {}),
      }),
      currentUser({ cwd }).catch(() => undefined),
    ]);
    if (!pulls) throw new Error("GitHub did not answer through gh.");
    return { pulls, viewer: viewer ?? "" };
  }

  private async graph(owner: string, repo: string, number: number, base: string): Promise<Served> {
    const found = await this.where(owner, repo);
    if (!found.path) {
      throw new NotHere(
        found.need === "pick"
          ? `${owner}/${repo} is in more than one folder. Choose one in VS Code.`
          : `${owner}/${repo} is not on this computer yet. Clone it from VS Code.`,
      );
    }
    const cwd = found.path;
    const remotes = await git(["remote", "-v"], { cwd });
    const remote = remoteFor(remotes, owner, repo) ?? "origin";
    this.openOnce(cwd);
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

export function githubThroughGh(
  path: string,
  accept: "json" | "diff",
  run: (args: string[]) => Promise<string> = ghRead,
): Promise<{ status: number; body: string }> {
  const media = accept === "diff" ? "application/vnd.github.diff" : "application/vnd.github+json";
  return run(["api", path.slice(1), "-H", `Accept: ${media}`]).then(
    (body) => ({ status: 200, body }),
    (error: Error) => {
      const said = error.message;
      const status = Number(/HTTP (\d{3})/.exec(said)?.[1] ?? 502);
      return { status, body: JSON.stringify({ message: said.replace(/^gh: /, "").trim() }) };
    },
  );
}

function ghRead(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { env: forgeEnv(), timeout: 60_000, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || stdout || error.message).trim()));
        else resolve(stdout);
      },
    );
  });
}

async function rootOf(path: string): Promise<string> {
  const top = (await git(["rev-parse", "--show-toplevel"], { cwd: path }).catch(() => "")).trim();
  return top || path;
}

async function isLinkedWorktree(path: string): Promise<boolean> {
  const [dir, common] = await Promise.all([
    git(["rev-parse", "--absolute-git-dir"], { cwd: path }).catch(() => ""),
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: path }).catch(() => ""),
  ]);
  return Boolean(dir.trim() && common.trim() && dir.trim() !== common.trim());
}
