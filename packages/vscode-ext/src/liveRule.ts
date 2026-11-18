export interface LiveHeld {
  repo: string;
  live: boolean;
}

export function liveFitsHere(windowRepo: string | undefined, at: string, held: readonly LiveHeld[]): boolean {
  if (!windowRepo || windowRepo !== at) return false;
  return held.every((one) => !one.live || one.repo === at);
}
