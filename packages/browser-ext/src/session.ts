import type { ChangeGraph } from "@odin/core";

import { BridgeError } from "./bridge.js";

export interface SessionEvents {
  note(text: string): void;
  graph(graph: ChangeGraph): void;
  html(html: string): void;
  message(message: unknown): void;
  reading?(reading: { live: boolean; branch: string }): void;
  wentLive?(): void;
  ended(error?: BridgeError): void;
}

export interface Remote {
  post(message: unknown): void;
  close(): void;
}

export async function openSession(
  port: number,
  token: string,
  query: { owner: string; repo: string; number: number; base: string; head: string },
  on: SessionEvents,
): Promise<Remote | undefined> {
  const stop = new AbortController();
  const params = new URLSearchParams({ ...query, number: String(query.number) });
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/odin/session?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: stop.signal,
    });
  } catch {
    throw new BridgeError("VS Code is not answering.", "unreachable");
  }
  if (response.status === 404) return undefined;
  if (!response.ok || !response.body) throw new BridgeError(`VS Code answered ${response.status}.`, "failed");

  let id = "";
  const waiting: unknown[] = [];
  const deliver = (message: unknown) => {
    void fetch(`http://127.0.0.1:${port}/odin/session/${id}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(message),
    }).catch(() => undefined);
  };

  const handle = (event: Record<string, unknown>) => {
    if (event.type === "session" && typeof event.id === "string") {
      id = event.id;
      for (const message of waiting.splice(0)) deliver(message);
    } else if (event.type === "note") on.note(String(event.message ?? ""));
    else if (event.type === "graph") on.graph(event.graph as ChangeGraph);
    else if (event.type === "html") on.html(String(event.html ?? ""));
    else if (event.type === "message") on.message(event.message);
    else if (event.type === "wentLive") on.wentLive?.();
    else if (event.type === "reading") on.reading?.({ live: event.live === true, branch: String(event.branch ?? "") });
    else if (event.type === "error") {
      on.ended(new BridgeError(String(event.error ?? "VS Code could not draw this."), event.missing ? "no-repository" : "failed"));
    }
  };

  void (async () => {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let held = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        held += value;
        let at = held.indexOf("\n");
        while (at >= 0) {
          const line = held.slice(0, at);
          held = held.slice(at + 1);
          if (line.trim()) handle(JSON.parse(line) as Record<string, unknown>);
          at = held.indexOf("\n");
        }
      }
      on.ended();
    } catch {
      if (!stop.signal.aborted) on.ended(new BridgeError("VS Code stopped answering.", "unreachable"));
    }
  })();

  return {
    post(message) {
      if (id) deliver(message);
      else waiting.push(message);
    },
    close() {
      stop.abort();
    },
  };
}
