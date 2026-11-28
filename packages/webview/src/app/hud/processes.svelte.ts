export type ProcStatus = "running" | "idle" | "stopped" | "terminated";

export interface ProcView {
  pid: number;
  command: string;
  icon: string;
  status: ProcStatus;
  beat: number;
  readable: boolean;
  ports: number[];
  startedAt: number;
  endedAt?: number;
}

export const procs = $state({ lists: {} as Record<string, ProcView[]>, icons: {} as Record<string, string> });

export function shortCommand(command: string): string {
  const parts = command.split(/\s+/).filter(Boolean);
  const head = (parts[0] ?? "").split("/").pop() ?? "";
  const tail = parts
    .slice(1)
    .filter((one) => !one.startsWith("-") && !one.includes("/") && !one.includes("="))
    .slice(-2);
  const said = [head, ...tail].join(" ");
  return said.length > 28 ? `${said.slice(0, 27)}…` : said;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type?: string; lists?: Record<string, ProcView[]>; icons?: Record<string, string> };
    if (message?.type !== "processes") return;
    procs.lists = message.lists ?? {};
    procs.icons = { ...procs.icons, ...(message.icons ?? {}) };
  });
}
