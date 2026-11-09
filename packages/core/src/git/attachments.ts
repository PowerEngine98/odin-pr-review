import { execFile } from "node:child_process";

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

export function attachmentBranch(reviewed: string | undefined, login: string): string {
  const clean = (part: string) =>
    part
      .replace(/^refs\/heads\//, "")
      .replace(/^origin\//, "")
      .replace(/[^\w./-]+/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/\/{2,}/g, "/")
      .replace(/^[./-]+|[./-]+$/g, "");
  return `odin-attachments/${clean(reviewed ?? "") || "issues"}/${clean(login) || "someone"}`;
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

async function writable(gh: Gh, repo: string): Promise<string> {
  const pushable = (await gh(["api", `repos/${repo}`, "--jq", ".permissions.push"]).catch(() => "false")).trim();
  if (pushable === "true") return repo;
  const fork = await json<{ full_name: string }>(gh, ["api", "-X", "POST", `repos/${repo}/forks`], {
    default_branch_only: true,
  });
  for (let tries = 0; tries < 10; tries++) {
    const ready = await gh(["api", `repos/${fork.full_name}`, "--jq", ".full_name"]).catch(() => "");
    if (ready.trim()) return fork.full_name;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return fork.full_name;
}

export async function storeAttachments(
  gh: Gh,
  repo: string,
  branch: string,
  files: Attachment[],
  now = Date.now(),
): Promise<Stored[]> {
  if (files.length === 0) return [];
  const decoded = files.map(decodeAttachment);
  const target = await writable(gh, repo);

  const head = (await gh(["api", `repos/${target}/git/ref/heads/${branch}`, "--jq", ".object.sha"]).catch(() => "")).trim();
  const baseTree = head
    ? (await gh(["api", `repos/${target}/git/commits/${head}`, "--jq", ".tree.sha"])).trim()
    : undefined;

  const entries: { path: string; mode: string; type: string; sha: string }[] = [];
  const stored: Stored[] = [];
  for (const [index, file] of decoded.entries()) {
    const blob = await json<{ sha: string }>(gh, ["api", "-X", "POST", `repos/${target}/git/blobs`], {
      content: file.bytes.toString("base64"),
      encoding: "base64",
    });
    const path = `${now}-${index + 1}-${safeName(file.name)}`;
    entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    const encoded = branch.split("/").map(encodeURIComponent).join("/");
    stored.push({
      name: file.name,
      url: `https://github.com/${target}/blob/${encoded}/${encodeURIComponent(path)}?raw=true`,
      image: file.type.startsWith("image/"),
    });
  }

  const tree = await json<{ sha: string }>(gh, ["api", "-X", "POST", `repos/${target}/git/trees`], {
    ...(baseTree ? { base_tree: baseTree } : {}),
    tree: entries,
  });
  const commit = await json<{ sha: string }>(gh, ["api", "-X", "POST", `repos/${target}/git/commits`], {
    message: `Attachments from Odin (${decoded.length})`,
    tree: tree.sha,
    parents: head ? [head] : [],
  });
  if (head) {
    await gh(["api", "-X", "PATCH", `repos/${target}/git/refs/heads/${branch}`, "--input", "-"], JSON.stringify({ sha: commit.sha }));
  } else {
    await gh(
      ["api", "-X", "POST", `repos/${target}/git/refs`, "--input", "-"],
      JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    );
  }
  return stored;
}

export function attachmentMarkdown(stored: Stored[]): string {
  return stored
    .map((one) => {
      const label = one.name.replace(/[[\]]/g, "");
      return one.image ? `![${label}](${one.url})` : `[▶ ${label}](${one.url})`;
    })
    .join("\n");
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
  problem?: "missing" | "signed-out";
}

export async function ghStatus(gh: Gh): Promise<GhStatus> {
  try {
    const login = (await gh(["api", "user", "--jq", ".login"])).trim();
    return login ? { ok: true, login } : { ok: false, problem: "signed-out" };
  } catch (error) {
    const said = String((error as Error).message ?? error);
    return { ok: false, problem: /ENOENT|not found|command not found/i.test(said) ? "missing" : "signed-out" };
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
