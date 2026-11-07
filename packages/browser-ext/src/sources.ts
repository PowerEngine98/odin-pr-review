import type { ChangeGraph, Snippet } from "@odin/core";

import { bridgeGraph, findBridge, BridgeError, bridgeWhere, launch, repositoryLink } from "./bridge.js";
import { readPull, type Api, type PullJson } from "./github.js";
import { graphOf } from "./page.js";

export type SourceKind = "github" | "vscode" | "browser";

export interface Settings {
  source: SourceKind;
  token?: string;
  port?: number;
}

export interface Drawing {
  pull: PullJson;
  graph: ChangeGraph;
  snippets: [string, Snippet[]][];
  arrows: boolean;
}

export async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["source", "bridgeToken", "bridgePort"]);
  const source: SourceKind = stored.source === "vscode" || stored.source === "browser" ? stored.source : "github";
  return {
    source,
    ...(typeof stored.bridgeToken === "string" ? { token: stored.bridgeToken } : {}),
    ...(typeof stored.bridgePort === "number" ? { port: stored.bridgePort } : {}),
  };
}

export async function saveSettings(next: Partial<Settings>): Promise<void> {
  const write: Record<string, unknown> = {};
  if (next.source) write.source = next.source;
  if (next.token) write.bridgeToken = next.token;
  if (next.port) write.bridgePort = next.port;
  await chrome.storage.local.set(write);
}

async function locate(
  port: number,
  token: string,
  owner: string,
  repo: string,
  say: (text: string) => void,
): Promise<void> {
  let where = await bridgeWhere(port, token, owner, repo);
  if (where.path !== undefined) return;
  launch(repositoryLink(owner, repo));
  const started = Date.now();
  while (where.path === undefined) {
    say(
      where.need === "pick"
        ? `${owner}/${repo} is in more than one folder. Choose the one to read in VS Code…`
        : `${owner}/${repo} is not on this computer yet. Choose where to clone it in VS Code…`,
    );
    if (Date.now() - started > 5 * 60_000) {
      throw new BridgeError(`VS Code did not get a folder for ${owner}/${repo}.`, "no-repository");
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    where = await bridgeWhere(port, token, owner, repo);
  }
}

export async function vsCodePort(
  settings: Settings,
  owner: string,
  repo: string,
  say: (text: string) => void,
): Promise<number> {
  if (!settings.token) throw new BridgeError("Odin is not connected to VS Code yet.", "unreachable");
  say("Asking VS Code…");
  const port = await findBridge(settings.token, settings.port);
  if (!port) throw new BridgeError("VS Code is not answering.", "unreachable");
  if (port !== settings.port) await saveSettings({ port });
  await locate(port, settings.token, owner, repo, say);
  return port;
}

export async function draw(
  settings: Settings,
  owner: string,
  repo: string,
  number: number,
  api: Api,
  say: (text: string) => void,
): Promise<Drawing> {
  const { pull, diff } = await readPull({ owner, repo, number }, api);
  const plain = graphOf(pull, diff);

  if (settings.source === "vscode") {
    const port = await vsCodePort(settings, owner, repo, say);
    say(`VS Code is reading #${number}…`);
    const answer = await bridgeGraph(port, settings.token!, owner, repo, number, pull.base.ref);
    const graph = {
      ...answer.graph,
      meta: { ...answer.graph.meta, pullRequest: answer.graph.meta.pullRequest ?? plain.meta.pullRequest },
    };
    return { pull, graph, snippets: answer.snippets, arrows: true };
  }

  if (settings.source === "browser") {
    const { compute } = await import("./compute/compute.js");
    const computed = await compute(owner, repo, pull, plain, api, say);
    return { pull, ...computed, arrows: true };
  }

  return { pull, graph: plain, snippets: [], arrows: false };
}
