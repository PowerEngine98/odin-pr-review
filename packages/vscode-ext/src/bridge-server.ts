import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const BRIDGE_PORTS = Array.from({ length: 10 }, (_, i) => 47920 + i);

export interface Pairing {
  token: string;
  origin: string;
}

export interface Served {
  graph: unknown;
  snippets: [string, unknown[]][];
}

export class NotHere extends Error {}

export interface BridgeBackend {
  version: string;
  graph(owner: string, repo: string, number: number, base: string): Promise<Served>;
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
): void {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-headers"] = "authorization";
    headers["access-control-allow-methods"] = "GET, OPTIONS";
    headers.vary = "origin";
  }
  response.writeHead(status, headers);
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

export function trusted(request: IncomingMessage, pairing: Pairing, port: number): "ok" | "origin" | "host" | "token" {
  const host = request.headers.host ?? "";
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "host";
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== pairing.origin) return "origin";
  if (request.method === "OPTIONS") return "ok";
  const auth = request.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ") || !same(auth.slice(7), pairing.token)) return "token";
  return "ok";
}

export async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  pairing: Pairing,
  port: number,
  backend: BridgeBackend,
): Promise<void> {
  const verdict = trusted(request, pairing, port);
  if (verdict === "host" || verdict === "origin") return send(response, 403, { error: "Not allowed" });
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") return send(response, 204, null, origin);
  if (verdict === "token") return send(response, 401, { error: "Not paired" }, origin);
  if (request.method !== "GET") return send(response, 405, { error: "Only GET" }, origin);

  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/odin/hello") {
    return send(response, 200, { odin: true, version: backend.version }, origin);
  }
  if (url.pathname === "/odin/graph") {
    const owner = url.searchParams.get("owner") ?? "";
    const repo = url.searchParams.get("repo") ?? "";
    const number = Number(url.searchParams.get("number") ?? "");
    const base = url.searchParams.get("base") ?? "";
    const name = /^[\w.-]+$/;
    if (!name.test(owner) || !name.test(repo) || !Number.isInteger(number) || number < 1 || !/^[\w./-]*$/.test(base)) {
      return send(response, 400, { error: "Bad request" }, origin);
    }
    try {
      return send(response, 200, await backend.graph(owner, repo, number, base), origin);
    } catch (error) {
      if (error instanceof NotHere) return send(response, 404, { error: error.message }, origin);
      return send(response, 500, { error: (error as Error).message }, origin);
    }
  }
  return send(response, 404, { error: "Not found" }, origin);
}

export async function listen(
  pairing: () => Pairing | undefined,
  backend: BridgeBackend,
): Promise<{ server: Server; port: number } | undefined> {
  for (const port of BRIDGE_PORTS) {
    const server = createServer((request, response) => {
      const paired = pairing();
      if (!paired) return send(response, 403, { error: "Not paired" });
      void handle(request, response, paired, port, backend);
    });
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (bound) return { server, port };
  }
  return undefined;
}
