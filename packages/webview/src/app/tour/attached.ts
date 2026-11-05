import type { Attached } from "./state.svelte.js";

/** Where an attached frame points, as the chip says it: `Order.kt:12-18`. */
export function placeOf(attached: Attached): string {
  if (!attached.file) return "";
  const name = attached.file.slice(attached.file.lastIndexOf("/") + 1);
  if (!attached.start) return name;
  const lines = attached.end && attached.end !== attached.start ? `${attached.start}-${attached.end}` : `${attached.start}`;
  return `${name}:${lines}`;
}

/**
 * The reader's message with the frame it argues with, for the agent: which
 * moment of the tour, what it claimed, and the code it pointed at.
 */
export function withFrame(said: string, attached: Attached): string {
  const where = attached.file
    ? `\nIt points at \`${attached.file}\`${attached.start ? ` lines ${attached.start}-${attached.end ?? attached.start}${attached.side === "base" ? " (before the change)" : ""}` : ""}${attached.code ? `:\n\`\`\`\n${attached.code}\n\`\`\`` : "."}`
    : "";
  return `${said}

About this moment in the tour, topic ${attached.topic + 1} "${attached.topicTitle}", frame ${attached.frame}. It says:
> ${attached.say.replace(/\n/g, "\n> ")}${where}`;
}
