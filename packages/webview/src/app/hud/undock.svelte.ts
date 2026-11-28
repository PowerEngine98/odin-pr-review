export const undock = $state({ as: "", away: [] as string[] });

export function readUndocked(): void {
  if (typeof document === "undefined") return;
  undock.as = document.body?.dataset.undocked ?? "";
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type?: string; agents?: unknown };
    if (message?.type !== "undocked") return;
    undock.away = Array.isArray(message.agents) ? message.agents.filter((one): one is string => typeof one === "string") : [];
  });
}
