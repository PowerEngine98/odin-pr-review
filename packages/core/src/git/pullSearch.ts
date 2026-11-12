export type PullState = "open" | "merged" | "closed" | "all";

export interface PullAsk {
  state: PullState;
  author: string;
  search?: string;
}

const STATE: Record<PullState, string> = {
  open: "is:open",
  merged: "is:merged",
  closed: "is:closed is:unmerged",
  all: "",
};

export const RECENT = 200;

export function searching(asked: PullAsk): boolean {
  return asked.author !== "" || (asked.search ?? "") !== "";
}

export function pullQuery(asked: PullAsk, repo?: string): string {
  return [
    repo ? `repo:${repo}` : "",
    "is:pr",
    STATE[asked.state],
    asked.author ? `author:${asked.author}` : "",
    (asked.search ?? "").trim(),
    "sort:updated-desc",
  ]
    .filter(Boolean)
    .join(" ");
}

export function partOfLogin(login: string, typed: string): boolean {
  return login.toLowerCase().includes(typed.toLowerCase());
}

export async function findPulls<T>(
  asked: PullAsk,
  sources: {
    search: (query: string) => Promise<T[] | undefined>;
    recent: (limit: number) => Promise<T[] | undefined>;
    loginOf: (pull: T) => string;
  },
): Promise<T[] | undefined> {
  if (!searching(asked)) return sources.recent(50);
  const found = await sources.search(pullQuery(asked));
  if (found && found.length > 0) return found;
  if (!asked.author || asked.search) return found;
  const recent = await sources.recent(RECENT);
  return recent?.filter((pull) => partOfLogin(sources.loginOf(pull), asked.author));
}
