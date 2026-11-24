import { findPulls } from "@odin/core";
export interface Place {
  owner: string;
  repo: string;
  number?: number;
}

const NOT_REPOSITORIES = new Set([
  "about", "apps", "codespaces", "collections", "customer-stories", "dashboard",
  "enterprise", "events", "explore", "features", "gist", "issues", "login",
  "logout", "marketplace", "new", "notifications", "orgs", "organizations",
  "pricing", "pulls", "search", "settings", "signup", "site", "sponsors",
  "topics", "trending", "users",
]);

export function placeOf(pathname: string): Place | undefined {
  const [owner, repo, kind, number] = pathname.split("/").filter(Boolean);
  if (!owner || !repo || NOT_REPOSITORIES.has(owner.toLowerCase())) return undefined;
  if (kind === "pull" && number && /^\d+$/.test(number)) {
    return { owner, repo, number: Number(number) };
  }
  return { owner, repo };
}

export interface PullJson {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  user?: { login: string; avatar_url?: string } | null;
  changed_files?: number;
  created_at?: string;
  updated_at?: string;
  requested_reviewers?: { login: string }[];
  requested_teams?: { slug: string }[];
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: "missing" | "denied" | "limited" | "too-large" | "failed",
  ) {
    super(message);
  }
}

export interface Api {
  token?: string;
  fetch?: typeof fetch;
  via?: (path: string, accept: string) => Promise<Response>;
}

async function call(api: Api, path: string, accept: string): Promise<Response> {
  const headers: Record<string, string> = {
    accept,
    "x-github-api-version": "2022-11-28",
  };
  if (api.token) headers.authorization = `Bearer ${api.token}`;
  const response = api.via
    ? await api.via(path, accept)
    : await (api.fetch ?? fetch)(`https://api.github.com${path}`, { headers });
  if (response.ok) return response;
  const body = await response.text().catch(() => "");
  const said = (() => {
    try {
      return String(JSON.parse(body).message ?? "");
    } catch {
      return body.slice(0, 200);
    }
  })();
  if (response.status === 404) {
    throw new GitHubError(said || "Not found", 404, "missing");
  }
  if (response.status === 401) throw new GitHubError(said || "Bad credentials", 401, "denied");
  if (response.status === 403 || response.status === 429) {
    const limited = response.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(said);
    throw new GitHubError(said || "Forbidden", response.status, limited ? "limited" : "denied");
  }
  if (response.status === 406 || response.status === 422) {
    throw new GitHubError(said || "Too large", response.status, "too-large");
  }
  throw new GitHubError(said || `GitHub answered ${response.status}`, response.status, "failed");
}

export interface PullFile {
  filename: string;
  previous_filename?: string;
  status: string;
  patch?: string;
}

export const FILES_PER_PAGE = 100;

export const MOST_FILES = 3000;

export function diffOfFiles(files: readonly PullFile[]): string {
  return files
    .map((file) => {
      const from = file.previous_filename ?? file.filename;
      const to = file.filename;
      const added = file.status === "added";
      const removed = file.status === "removed";
      const lines = [`diff --git a/${from} b/${to}`];
      if (added) lines.push("new file mode 100644");
      if (removed) lines.push("deleted file mode 100644");
      if (from !== to) lines.push(`rename from ${from}`, `rename to ${to}`);
      if (file.patch === undefined) {
        if (added || removed || from === to) lines.push(`Binary files ${added ? "/dev/null" : `a/${from}`} and ${removed ? "/dev/null" : `b/${to}`} differ`);
        return lines.join("\n");
      }
      lines.push(added ? "--- /dev/null" : `--- a/${from}`, removed ? "+++ /dev/null" : `+++ b/${to}`, file.patch);
      return lines.join("\n");
    })
    .join("\n")
    .concat(files.length ? "\n" : "");
}

export async function pullFiles(place: Required<Place>, count: number, api: Api = {}): Promise<PullFile[]> {
  const pages = Math.max(1, Math.ceil(Math.min(count, MOST_FILES) / FILES_PER_PAGE));
  const path = `/repos/${place.owner}/${place.repo}/pulls/${place.number}/files`;
  const read = await Promise.all(
    Array.from({ length: pages }, (_, at) =>
      call(api, `${path}?per_page=${FILES_PER_PAGE}&page=${at + 1}`, "application/vnd.github+json").then(
        (r) => r.json() as Promise<PullFile[]>,
      ),
    ),
  );
  return read.flat();
}

export async function readPull(
  place: Required<Place>,
  api: Api = {},
): Promise<{ pull: PullJson; diff: string }> {
  const path = `/repos/${place.owner}/${place.repo}/pulls/${place.number}`;
  const asked = call(api, path, "application/vnd.github+json").then((r) => r.json() as Promise<PullJson>);
  const whole = call(api, path, "application/vnd.github.diff").then(
    (r) => r.text(),
    (error: unknown) => {
      if (!(error instanceof GitHubError) || error.reason !== "too-large") throw error;
      return asked.then((pull) => pullFiles(place, pull.changed_files ?? MOST_FILES, api)).then(diffOfFiles);
    },
  );
  const [pull, diff] = await Promise.all([asked, whole]);
  return { pull, diff };
}

export type Asked = "open" | "merged" | "closed" | "all";

interface FoundIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  user?: { login: string; avatar_url?: string } | null;
  created_at?: string;
  updated_at?: string;
  pull_request?: { merged_at?: string | null };
}

function fromSearch(found: FoundIssue): PullJson {
  return {
    number: found.number,
    title: found.title,
    html_url: found.html_url,
    state: found.state,
    ...(found.draft !== undefined ? { draft: found.draft } : {}),
    merged_at: found.pull_request?.merged_at ?? null,
    user: found.user ?? null,
    ...(found.created_at ? { created_at: found.created_at } : {}),
    ...(found.updated_at ? { updated_at: found.updated_at } : {}),
    base: { ref: "", sha: "" },
    head: { ref: "", sha: "" },
  };
}

export async function listPulls(
  place: Place,
  api: Api = {},
  asked: { state: Asked; author: string; search?: string } = { state: "open", author: "" },
): Promise<PullJson[]> {
  const repo = `${place.owner}/${place.repo}`;
  const found = await findPulls<PullJson>(asked, {
    search: async (query) => {
      const path = `/search/issues?q=${encodeURIComponent(`repo:${repo} ${query}`)}&per_page=50`;
      const answer = await (await call(api, path, "application/vnd.github+json")).json() as { items?: FoundIssue[] };
      return (answer.items ?? []).map(fromSearch);
    },
    recent: async (limit) => {
      const state = asked.state === "merged" ? "closed" : asked.state;
      const path = `/repos/${repo}/pulls?state=${state}&per_page=${Math.min(limit, 100)}&sort=updated&direction=desc`;
      const pulls = await (await call(api, path, "application/vnd.github+json")).json() as PullJson[];
      return pulls.filter((pull) => {
        if (asked.state === "merged" && !pull.merged_at) return false;
        if (asked.state === "closed" && pull.merged_at) return false;
        return true;
      });
    },
    loginOf: (pull) => pull.user?.login ?? "",
  });
  return found ?? [];
}

export async function whoAmI(api: Api): Promise<string> {
  if (!api.token && !api.via) return "";
  const user = await (await call(api, "/user", "application/vnd.github+json")).json() as { login?: string };
  return user.login ?? "";
}

export function stateOf(pull: PullJson): string {
  if (pull.merged_at) return "MERGED";
  return pull.state.toUpperCase();
}
