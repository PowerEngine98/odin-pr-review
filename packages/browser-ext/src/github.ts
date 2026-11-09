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

export async function readPull(
  place: Required<Place>,
  api: Api = {},
): Promise<{ pull: PullJson; diff: string }> {
  const path = `/repos/${place.owner}/${place.repo}/pulls/${place.number}`;
  const [pull, diff] = await Promise.all([
    call(api, path, "application/vnd.github+json").then((r) => r.json() as Promise<PullJson>),
    call(api, path, "application/vnd.github.diff").then((r) => r.text()),
  ]);
  return { pull, diff };
}

export type Asked = "open" | "merged" | "closed" | "all";

export async function listPulls(
  place: Place,
  api: Api = {},
  asked: { state: Asked; author: string } = { state: "open", author: "" },
): Promise<PullJson[]> {
  const state = asked.state === "merged" ? "closed" : asked.state;
  const path = `/repos/${place.owner}/${place.repo}/pulls?state=${state}&per_page=100&sort=updated&direction=desc`;
  const pulls = await (await call(api, path, "application/vnd.github+json")).json() as PullJson[];
  const author = asked.author.toLowerCase();
  return pulls.filter((pull) => {
    if (asked.state === "merged" && !pull.merged_at) return false;
    if (asked.state === "closed" && pull.merged_at) return false;
    return !author || pull.user?.login.toLowerCase() === author;
  });
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
