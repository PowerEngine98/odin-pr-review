export function movedToPull(
  armedFor: number | undefined,
  now: { number: number; baseRefName?: string } | undefined,
): { number: number; base: string } | undefined {
  if (!now || now.number === armedFor || !now.baseRefName) return undefined;
  return { number: now.number, base: now.baseRefName };
}
