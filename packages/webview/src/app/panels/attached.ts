export interface Attached {
  id: string;
  name: string;
  type: string;
  data: string;
}

export function forHost(attached: Attached[] | undefined): { name: string; data: string }[] | undefined {
  if (!attached || attached.length === 0) return undefined;
  return attached.map((one) => ({ name: one.name, data: one.data }));
}
