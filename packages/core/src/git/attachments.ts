import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { forgeEnv } from "./pullRequest.js";

export interface Attachment {
  name: string;
  data: string;
}

export interface Stored {
  name: string;
  url: string;
  image: boolean;
}

export type Gh = (args: string[], input?: string) => Promise<string>;

export const ATTACHMENT_LIMIT = 25 * 1024 * 1024;

export function ghAt(cwd?: string): Gh {
  return (args, input) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        "gh",
        args,
        { cwd, env: forgeEnv(), timeout: 120_000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || stdout || error.message).trim()));
            return;
          }
          resolve(stdout);
        },
      );
      if (input !== undefined) child.stdin?.end(input);
    });
}

export function decodeAttachment(file: Attachment): { name: string; bytes: Buffer; type: string } {
  const match = /^data:([\w.+-]+\/[\w.+-]+)(?:;[^,]*)?;base64,(.*)$/s.exec(file.data);
  if (!match) throw new Error(`${file.name} is not a file Odin can attach.`);
  const type = match[1]!.toLowerCase();
  if (!/^(image|video)\//.test(type)) throw new Error(`${file.name} is not an image or a video.`);
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length > ATTACHMENT_LIMIT) throw new Error(`${file.name} is over 25 MB.`);
  return { name: file.name, bytes, type };
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "attachment";
}

async function json<T>(gh: Gh, args: string[], body?: unknown): Promise<T> {
  const out = await gh(body === undefined ? args : [...args, "--input", "-"], body === undefined ? undefined : JSON.stringify(body));
  return JSON.parse(out) as T;
}

export const GH_ATTACH_VERSION = "2.99.0";

export function versionOf(said: string): string | undefined {
  return /gh version (\d+\.\d+\.\d+)/.exec(said)?.[1];
}

export function atLeast(version: string | undefined, wanted: string): boolean {
  if (!version) return false;
  const have = version.split(".").map(Number);
  const need = wanted.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== (need[i] ?? 0)) return (have[i] ?? 0) > (need[i] ?? 0);
  }
  return true;
}

export class AttachDenied extends Error {
  constructor(readonly repo: string) {
    super(`Attaching files needs write access to ${repo}; GitHub only takes uploads from its collaborators.`);
  }
}

async function writableRepo(gh: Gh, repo: string): Promise<number> {
  const seen = await json<{ id: number; permissions?: { push?: boolean } }>(gh, ["api", `repos/${repo}`]);
  if (seen.permissions?.push !== true) throw new AttachDenied(repo);
  return seen.id;
}

async function onDisk<T>(files: { name: string; bytes: Buffer }[], use: (paths: string[]) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), "odin-attach-"));
  try {
    const paths: string[] = [];
    for (const [index, file] of files.entries()) {
      const path = join(folder, `${index + 1}-${safeName(file.name)}`);
      await writeFile(path, file.bytes);
      paths.push(path);
    }
    return await use(paths);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export async function uploadAttachments(gh: Gh, repo: string, files: Attachment[]): Promise<Stored[]> {
  if (files.length === 0) return [];
  const decoded = files.map(decodeAttachment);
  const id = await writableRepo(gh, repo);
  return onDisk(decoded, async (paths) => {
    const stored: Stored[] = [];
    for (const [index, file] of decoded.entries()) {
      const query = new URLSearchParams({
        name: safeName(file.name),
        content_type: file.type,
        repository_id: String(id),
      });
      const answer = await gh([
        "api",
        "-X",
        "POST",
        `https://uploads.github.com/user-attachments/assets?${query}`,
        "-H",
        "Content-Type: application/octet-stream",
        "--input",
        paths[index]!,
      ]);
      const url = (JSON.parse(answer) as { url?: string }).url;
      if (!url) throw new Error(`GitHub did not return a link for ${file.name}.`);
      stored.push({ name: file.name, url, image: file.type.startsWith("image/") });
    }
    return stored;
  });
}

export function attachmentMarkdown(stored: Stored[]): string {
  return stored
    .map((one) => {
      const label = one.name.replace(/[[\]]/g, "");
      return one.image ? `![${label}](${one.url})` : one.url;
    })
    .join("\n\n");
}

export function withAttachments(body: string, stored: Stored[]): string {
  if (stored.length === 0) return body;
  return `${body.trimEnd()}\n\n${attachmentMarkdown(stored)}`;
}

export const SUPPORT_REPO = "PowerEngine98/odin-pr-review";

export const SUPPORT_LABELS = {
  bug: "Bug",
  suggestion: "Suggestion",
  feature: "Ask for features",
} as const;

export type SupportKind = keyof typeof SUPPORT_LABELS;

export interface GhStatus {
  ok: boolean;
  login?: string;
  version?: string;
  problem?: "missing" | "signed-out" | "outdated";
}

export async function ghStatus(gh: Gh): Promise<GhStatus> {
  let version: string | undefined;
  try {
    version = versionOf(await gh(["--version"]));
  } catch {
    return { ok: false, problem: "missing" };
  }
  try {
    const login = (await gh(["api", "user", "--jq", ".login"])).trim();
    if (!login) return { ok: false, ...(version ? { version } : {}), problem: "signed-out" };
    if (!atLeast(version, GH_ATTACH_VERSION)) return { ok: false, login, ...(version ? { version } : {}), problem: "outdated" };
    return { ok: true, login, ...(version ? { version } : {}) };
  } catch {
    return { ok: false, ...(version ? { version } : {}), problem: "signed-out" };
  }
}

export function repoOfUrl(url: string): string | undefined {
  const match = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/.exec(url);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

export async function openIssue(
  gh: Gh,
  repo: string,
  issue: { title: string; body: string; label: string },
): Promise<string> {
  const made = await json<{ html_url: string }>(gh, ["api", "-X", "POST", `repos/${repo}/issues`], {
    title: issue.title,
    body: issue.body,
    labels: [issue.label],
  });
  return made.html_url;
}

export async function openIssueWithMedia(
  gh: Gh,
  repo: string,
  issue: { title: string; body: string; label: string },
  files: Attachment[],
): Promise<{ url: string; left: number }> {
  if (files.length === 0) return { url: await openIssue(gh, repo, issue), left: 0 };
  const decoded = files.map(decodeAttachment);
  try {
    await writableRepo(gh, repo);
  } catch (error) {
    if (!(error instanceof AttachDenied)) throw error;
    return { url: await openIssue(gh, repo, issue), left: files.length };
  }
  return onDisk([...decoded, { name: "body.md", bytes: Buffer.from(issue.body) }], async (paths) => {
    const body = paths[paths.length - 1]!;
    const attach = decoded.flatMap((file, index) => [
      "--attach",
      file.type.startsWith("image/") ? `${paths[index]}#${file.name.replace(/#/g, "")}` : paths[index]!,
    ]);
    const said = await gh([
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      issue.title,
      "--body-file",
      body,
      "--label",
      issue.label,
      ...attach,
    ]);
    const url = said.trim().split("\n").reverse().find((line) => /^https:\/\//.test(line.trim()))?.trim();
    if (!url) throw new Error("GitHub did not say where the issue went.");
    return { url, left: 0 };
  });
}
