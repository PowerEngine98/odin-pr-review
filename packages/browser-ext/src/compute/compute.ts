import { enrichSnippets, type ChangeGraph, type Snippet } from "@odin/core";

import { probesOf, resolveAt } from "../../../cli/src/resolving.js";
import type { Api, PullJson } from "../github.js";
import { join } from "../shims/path.js";
import { installSystem } from "./system.js";
import { gunzip, untar } from "./tar.js";
import { forget, mounted, read, writeFile } from "./vfs.js";

const LARGEST = 512 * 1024;
const kept: string[] = [];

function headers(api: Api): Record<string, string> {
  const sent: Record<string, string> = { "x-github-api-version": "2022-11-28" };
  if (api.token) sent.authorization = `Bearer ${api.token}`;
  return sent;
}

function skipped(path: string): boolean {
  return /(^|\/)(node_modules|\.git)\//.test(path);
}

function binary(data: Uint8Array): boolean {
  return data.subarray(0, 8000).includes(0);
}

const decoder = new TextDecoder();

async function mount(
  owner: string,
  repo: string,
  sha: string,
  api: Api,
  say: (text: string) => void,
): Promise<string> {
  const root = `/odin/${sha}`;
  if (mounted(root)) return root;
  say(`Downloading ${owner}/${repo} at ${sha.slice(0, 7)}…`);
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`, {
    headers: headers(api),
  });
  if (!response.ok) throw new Error(`GitHub would not send the repository at ${sha.slice(0, 7)} (${response.status})`);
  const bytes = await gunzip(response);
  say(`Reading ${owner}/${repo} at ${sha.slice(0, 7)}…`);
  for (const file of untar(bytes)) {
    const path = file.path.slice(file.path.indexOf("/") + 1);
    if (!path || skipped(path) || file.data.length > LARGEST || binary(file.data)) continue;
    writeFile(join(root, path), decoder.decode(file.data));
  }
  kept.push(root);
  while (kept.length > 4) forget(kept.shift()!);
  return root;
}

async function mergeBaseOf(owner: string, repo: string, pull: PullJson, api: Api): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${pull.base.sha}...${pull.head.sha}`,
    { headers: { ...headers(api), accept: "application/vnd.github+json" } },
  );
  if (!response.ok) return pull.base.sha;
  const compared = await response.json() as { merge_base_commit?: { sha?: string } };
  return compared.merge_base_commit?.sha ?? pull.base.sha;
}

export interface Computed {
  graph: ChangeGraph;
  snippets: [string, Snippet[]][];
}

export async function compute(
  owner: string,
  repo: string,
  pull: PullJson,
  drawn: ChangeGraph,
  api: Api,
  say: (text: string) => void,
): Promise<Computed> {
  const probes = probesOf(drawn);
  if (probes.length === 0) return { graph: drawn, snippets: [] };

  installSystem();
  const head = await mount(owner, repo, pull.head.sha, api, say);
  let base: string | undefined;
  let graph = drawn;
  if (probes.some((probe) => probe.side === "base")) {
    const mergeBase = await mergeBaseOf(owner, repo, pull, api);
    base = await mount(owner, repo, mergeBase, api, say);
    graph = { ...graph, meta: { ...graph.meta, mergeBase } };
  }

  say("Finding where every call lands…");
  const resolved = await resolveAt(graph, { head, ...(base ? { base } : {}) });
  const snippets = await enrichSnippets(resolved, {
    cwd: "/",
    read: async (path, side) => read(join(side === "base" && base ? base : head, path)),
  });
  return { graph: resolved, snippets: [...snippets] };
}
