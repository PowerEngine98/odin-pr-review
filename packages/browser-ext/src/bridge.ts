import type { ChangeGraph, PullRequestSummary, Snippet } from "@odin/core";

export const BRIDGE_PORTS = Array.from({ length: 10 }, (_, i) => 47920 + i);
export const EXTENSION_ID = "powerengine98.odin-pr-review";

export interface BridgeAnswer {
  graph: ChangeGraph;
  snippets: [string, Snippet[]][];
}

export class BridgeError extends Error {
  constructor(message: string, readonly reason: "unreachable" | "no-repository" | "failed") {
    super(message);
  }
}

function call(port: number, path: string, token: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal ? { signal } : {}),
  });
}

export async function findBridge(token: string, known?: number): Promise<number | undefined> {
  const answers = async (port: number): Promise<boolean> => {
    try {
      const response = await call(port, "/odin/hello", token, AbortSignal.timeout(800));
      return response.ok && (await response.json())?.odin === true;
    } catch {
      return false;
    }
  };
  if (known && (await answers(known))) return known;
  const others = BRIDGE_PORTS.filter((port) => port !== known);
  const probes = others.map(answers);
  for (const [at, probe] of probes.entries()) if (await probe) return others[at];
  return undefined;
}

export async function bridgeGraph(
  port: number,
  token: string,
  owner: string,
  repo: string,
  number: number,
  base: string,
): Promise<BridgeAnswer> {
  const query = new URLSearchParams({ owner, repo, number: String(number), base });
  let response: Response;
  try {
    response = await call(port, `/odin/graph?${query}`, token);
  } catch {
    throw new BridgeError("VS Code is not answering.", "unreachable");
  }
  if (response.status === 404) {
    const said = await response.json().catch(() => ({})) as { error?: string };
    throw new BridgeError(said.error ?? `${owner}/${repo} is not open in VS Code.`, "no-repository");
  }
  if (!response.ok) {
    const said = await response.json().catch(() => ({})) as { error?: string };
    throw new BridgeError(said.error ?? `VS Code answered ${response.status}.`, "failed");
  }
  return response.json() as Promise<BridgeAnswer>;
}

export async function bridgePulls(
  port: number,
  token: string,
  owner: string,
  repo: string,
  asked: { state: string; author: string; search?: string },
  light = false,
): Promise<{ pulls: PullRequestSummary[]; viewer: string }> {
  const query = new URLSearchParams({
    owner,
    repo,
    state: asked.state,
    author: asked.author,
    search: asked.search ?? "",
    ...(light ? { light: "1" } : {}),
  });
  let response: Response;
  try {
    response = await call(port, `/odin/pulls?${query}`, token);
  } catch {
    throw new BridgeError("VS Code is not answering.", "unreachable");
  }
  const said = await response.json().catch(() => ({})) as { error?: string; pulls?: PullRequestSummary[]; viewer?: string };
  if (response.status === 404) throw new BridgeError(said.error ?? `${owner}/${repo} is not open in VS Code.`, "no-repository");
  if (!response.ok) throw new BridgeError(said.error ?? `VS Code answered ${response.status}.`, "failed");
  return { pulls: said.pulls ?? [], viewer: said.viewer ?? "" };
}

export interface Where {
  path?: string;
  need?: "pick" | "clone";
}

export async function bridgeWhere(port: number, token: string, owner: string, repo: string): Promise<Where> {
  const query = new URLSearchParams({ owner, repo });
  let response: Response;
  try {
    response = await call(port, `/odin/where?${query}`, token);
  } catch {
    throw new BridgeError("VS Code is not answering.", "unreachable");
  }
  if (response.status === 404) return { path: "" };
  if (!response.ok) throw new BridgeError(`VS Code answered ${response.status}.`, "failed");
  return response.json() as Promise<Where>;
}

export function repositoryLink(owner: string, repo: string): string {
  return `vscode://${EXTENSION_ID}/repository?${new URLSearchParams({ owner, repo })}`;
}

export function launch(url: string): void {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.src = url;
  document.body.append(frame);
  setTimeout(() => frame.remove(), 10_000);
}

export function pairingLink(token: string, extensionId: string): string {
  const query = new URLSearchParams({ token, from: `chrome-extension://${extensionId}` });
  return `vscode://${EXTENSION_ID}/connect?${query}`;
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bridgeGitHub(port: number, token: string): (path: string, accept: string) => Promise<Response> {
  return (path, accept) => {
    const query = new URLSearchParams({ path, accept: accept.includes("diff") ? "diff" : "json" });
    return call(port, `/odin/github?${query}`, token);
  };
}
