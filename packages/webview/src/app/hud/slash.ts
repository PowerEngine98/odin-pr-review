export function typingCommand(text: string): string | undefined {
  const match = /^\/(\S*)$/.exec(text);
  return match ? match[1] : undefined;
}

export function suggestions(commands: readonly string[], query: string, limit = 12): string[] {
  const wanted = query.toLowerCase();
  const starts = commands.filter((one) => one.toLowerCase().startsWith(wanted));
  const inside = commands.filter((one) => !one.toLowerCase().startsWith(wanted) && one.toLowerCase().includes(wanted));
  return [...starts, ...inside].slice(0, limit);
}

export function isCommand(text: string): boolean {
  return /^\/\S/.test(text.trim());
}
