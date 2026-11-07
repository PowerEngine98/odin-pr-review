export type Saved = Record<string, string>;

export function relayedStorage(saved: Saved, save: (key: string, value: string | null) => void): Storage {
  const items = new Map(Object.entries(saved));
  return {
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(String(key)) ?? null,
    setItem(key: string, value: string) {
      items.set(String(key), String(value));
      save(String(key), String(value));
    },
    removeItem(key: string) {
      items.delete(String(key));
      save(String(key), null);
    },
    clear() {
      for (const key of items.keys()) save(key, null);
      items.clear();
    },
  };
}
