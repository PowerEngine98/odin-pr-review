import { host, notify } from "../state.svelte.js";

export { isCommand, suggestions, typingCommand } from "./slash.js";

export const slash = $state({ commands: {} as Record<string, string[]> });

const asked = new Set<string>();

export function askCommands(agent: string): void {
  if (!host || asked.has(agent)) return;
  asked.add(agent);
  notify("agentCommands", { agent });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as { type?: string; agent?: string; commands?: unknown };
    if (message?.type !== "agentCommands" || typeof message.agent !== "string" || !Array.isArray(message.commands)) return;
    slash.commands = {
      ...slash.commands,
      [message.agent]: message.commands.filter((one): one is string => typeof one === "string"),
    };
  });
}
