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

export interface Where {
  path?: string;
  need?: "pick" | "clone";
}

export interface BridgeBackend {
  version: string;
  where(owner: string, repo: string): Promise<Where>;
  graph(owner: string, repo: string, number: number, base: string): Promise<Served>;
  session?(owner: string, repo: string, number: number, base: string, sink: Sink, head?: string): Promise<Session>;
  github?(path: string, accept: "json" | "diff"): Promise<{ status: number; body: string }>;
  pulls?(owner: string, repo: string, query: PullQuery): Promise<{ pulls: unknown[]; viewer: string }>;
}

export interface PullQuery {
  state: "open" | "merged" | "closed" | "all";
  author: string;
  search: string;
}

export const GITHUB_READS = /^\/(user|repos\/(?!\.\.?\/)[\w.-]+\/(?!\.\.?\/)[\w.-]+\/pulls(\/\d+)?)(\?[\w=&%.-]*)?$/;

export interface Sink {
  send(event: Record<string, unknown>): void;
}

export interface Session {
  id: string;
  deliver(message: unknown): void;
  close(): void;
}

const sessions = new Map<string, Session>();

function readBody(request: IncomingMessage, limit = 4 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error as Error);
      }
    });
    request.on("error", reject);
  });
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
    headers["access-control-allow-headers"] = "authorization, content-type";
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
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
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const posted = /^\/odin\/session\/([\w-]+)$/.exec(url.pathname);
  if (request.method === "POST" && posted) {
    const session = sessions.get(posted[1]!);
    if (!session) return send(response, 404, { error: "No such session" }, origin);
    try {
      session.deliver(await readBody(request));
    } catch {
      return send(response, 400, { error: "Bad message" }, origin);
    }
    return send(response, 200, { ok: true }, origin);
  }
  if (request.method !== "GET") return send(response, 405, { error: "Only GET" }, origin);

  if (url.pathname === "/odin/hello") {
    return send(response, 200, { odin: true, version: backend.version }, origin);
  }
  const owner = url.searchParams.get("owner") ?? "";
  const repo = url.searchParams.get("repo") ?? "";
  const name = /^[\w.-]+$/;
  if (url.pathname === "/odin/where") {
    if (!name.test(owner) || !name.test(repo)) return send(response, 400, { error: "Bad request" }, origin);
    try {
      return send(response, 200, await backend.where(owner, repo), origin);
    } catch (error) {
      return send(response, 500, { error: (error as Error).message }, origin);
    }
  }
  if (url.pathname === "/odin/session") {
    const number = Number(url.searchParams.get("number") ?? "");
    const base = url.searchParams.get("base") ?? "";
    const head = url.searchParams.get("head") ?? "";
    if (!/^[\w./-]*$/.test(head)) return send(response, 400, { error: "Bad request" }, origin);
    if (!backend.session) return send(response, 404, { error: "Not offered" }, origin);
    if (!name.test(owner) || !name.test(repo) || !Number.isInteger(number) || number < 1 || !/^[\w./-]*$/.test(base)) {
      return send(response, 400, { error: "Bad request" }, origin);
    }
    response.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
    });
    const sink: Sink = { send: (event) => response.write(`${JSON.stringify(event)}\n`) };
    let session: Session | undefined;
    let gone = false;
    request.on("close", () => {
      gone = true;
      if (session) {
        sessions.delete(session.id);
        session.close();
      }
    });
    try {
      session = await backend.session(owner, repo, number, base, sink, head || undefined);
      if (gone) {
        session.close();
        return;
      }
      sessions.set(session.id, session);
      sink.send({ type: "session", id: session.id });
    } catch (error) {
      sink.send({ type: "error", missing: error instanceof NotHere, error: (error as Error).message });
      response.end();
    }
    return;
  }
  if (url.pathname === "/odin/github") {
    const path = url.searchParams.get("path") ?? "";
    const accept = url.searchParams.get("accept") === "diff" ? "diff" : "json";
    if (!backend.github) return send(response, 404, { error: "Not offered" }, origin);
    if (!GITHUB_READS.test(path)) return send(response, 400, { error: "Bad request" }, origin);
    try {
      const answer = await backend.github(path, accept);
      response.writeHead(answer.status, {
        "content-type": accept === "diff" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
      });
      response.end(answer.body);
    } catch (error) {
      send(response, 502, { message: (error as Error).message }, origin);
    }
    return;
  }
  if (url.pathname === "/odin/pulls") {
    const state = url.searchParams.get("state") ?? "open";
    const author = url.searchParams.get("author") ?? "";
    const search = url.searchParams.get("search") ?? "";
    const states = ["open", "merged", "closed", "all"];
    if (!name.test(owner) || !name.test(repo) || !states.includes(state) || !/^[\w-]*$/.test(author) || search.length > 200) {
      return send(response, 400, { error: "Bad request" }, origin);
    }
    if (!backend.pulls) return send(response, 404, { error: "Not found" }, origin);
    try {
      return send(
        response,
        200,
        await backend.pulls(owner, repo, { state: state as PullQuery["state"], author, search }),
        origin,
      );
    } catch (error) {
      if (error instanceof NotHere) return send(response, 404, { error: error.message }, origin);
      return send(response, 500, { error: (error as Error).message }, origin);
    }
  }
  if (url.pathname === "/odin/graph") {
    const number = Number(url.searchParams.get("number") ?? "");
    const base = url.searchParams.get("base") ?? "";
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
  ports: number[] = BRIDGE_PORTS,
): Promise<{ server: Server; port: number } | undefined> {
  for (const wanted of ports) {
    let port = wanted;
    const server = createServer((request, response) => {
      const paired = pairing();
      if (!paired) return send(response, 403, { error: "Not paired" });
      void handle(request, response, paired, port, backend);
    });
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(wanted, "127.0.0.1", () => resolve(true));
    });
    if (!bound) continue;
    const address = server.address();
    if (address && typeof address === "object") port = address.port;
    return { server, port };
  }
  return undefined;
}
