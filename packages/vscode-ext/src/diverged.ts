import { currentBranch, git } from "@odin/core";

export type DivergedFix = "theirs" | "rebase" | "mine";

export interface DivergedFacts {
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  sameFiles: boolean;
}

export class Diverged extends Error {
  constructor(readonly facts: DivergedFacts) {
    super(divergedText(facts));
    this.name = "Diverged";
  }
}

export function divergedText(facts: DivergedFacts): string {
  const mine = `${facts.ahead} commit${facts.ahead === 1 ? "" : "s"}`;
  const theirs = `${facts.behind} commit${facts.behind === 1 ? "" : "s"}`;
  if (facts.sameFiles) {
    return `${facts.branch} was rewritten on GitHub, probably rebased, and your local copy still has the commits from before. The files are the same on both, so taking GitHub's version changes nothing on disk.`;
  }
  return `Your local ${facts.branch} and GitHub's have gone separate ways: ${mine} only here, ${theirs} only on GitHub.`;
}

export const DIVERGED = /not possible to fast-forward|diverging branches|non-fast-forward|have diverged/i;

export async function upstreamOf(repo: string, branch: string): Promise<string> {
  const named = (await git(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], { cwd: repo }).catch(() => "")).trim();
  return named || `origin/${branch}`;
}

export async function divergenceOf(repo: string, branch: string): Promise<DivergedFacts | undefined> {
  const upstream = await upstreamOf(repo, branch);
  const [remote, ...rest] = upstream.split("/");
  await git(["fetch", "--quiet", remote!, rest.join("/")], { cwd: repo }).catch(() => "");
  const counts = (await git(["rev-list", "--left-right", "--count", `${upstream}...${branch}`], { cwd: repo }).catch(() => ""))
    .trim()
    .split(/\s+/)
    .map(Number);
  const behind = counts[0] ?? 0;
  const ahead = counts[1] ?? 0;
  if (!Number.isFinite(behind) || !Number.isFinite(ahead) || ahead === 0 || behind === 0) return undefined;
  const sameFiles = await git(["diff", "--quiet", upstream, branch], { cwd: repo }).then(
    () => true,
    () => false,
  );
  return { branch, upstream, ahead, behind, sameFiles };
}

export async function fixDivergence(repo: string, branch: string, fix: DivergedFix): Promise<string | undefined> {
  const here = await currentBranch({ cwd: repo }).catch(() => undefined);
  if (here !== branch) await git(["switch", branch], { cwd: repo });
  if (fix === "mine") return undefined;
  const dirty = (await git(["status", "--porcelain"], { cwd: repo })).trim();
  if (dirty) throw new Error(`${repo} has uncommitted changes, so Odin left ${branch} as it is. Commit or stash them, then try again.`);
  const upstream = await upstreamOf(repo, branch);
  const [remote, ...rest] = upstream.split("/");
  await git(["fetch", "--quiet", remote!, rest.join("/")], { cwd: repo }).catch(() => "");
  if (fix === "rebase") {
    try {
      await git(["rebase", upstream], { cwd: repo });
    } catch {
      await git(["rebase", "--abort"], { cwd: repo }).catch(() => "");
      throw new Error(`Your commits and GitHub's change the same lines, so they could not be put one after the other. Nothing was changed. Use GitHub's version (yours are kept on a backup branch) or go live on yours.`);
    }
    return undefined;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const backup = `odin-backup/${branch}-${stamp}`;
  await git(["branch", backup, branch], { cwd: repo });
  await git(["reset", "--hard", upstream], { cwd: repo });
  return backup;
}

