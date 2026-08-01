import { git } from "@odin/core";
import * as vscode from "vscode";

export const BASE_SCHEME = "odin-base";

/**
 * Serves file contents as they were at the merge base.
 *
 * A removed reference points at code that no longer exists in the working tree,
 * so following one has to open something other than a workspace file. Rather
 * than write the blob to a temporary file, it is served as a read-only virtual
 * document: nothing lands on disk, and the editor makes it obvious that the
 * buffer is historical and cannot be edited.
 */
export class BaseContentProvider implements vscode.TextDocumentContentProvider {
  private readonly cache = new Map<string, string>();

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const key = uri.toString();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const { repo, sha } = parseQuery(uri.query);
    if (!repo || !sha) return "";

    // `uri.path` is the repository-relative path with a leading slash.
    const path = uri.path.replace(/^\//, "");

    let content: string;
    try {
      content = await git(["show", `${sha}:${path}`], { cwd: repo });
    } catch {
      content = `// ${path} does not exist at ${sha.slice(0, 12)}\n`;
    }

    this.cache.set(key, content);
    return content;
  }

  /** Contents at a commit are immutable, so nothing needs invalidating. */
  readonly onDidChange = undefined;
}

/** Builds the URI that identifies one file at one commit. */
export function baseUri(
  repo: string,
  sha: string,
  path: string,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: BASE_SCHEME,
    path: `/${path}`,
    query: `repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(sha)}`,
  });
}

function parseQuery(query: string): { repo?: string; sha?: string } {
  const out: { repo?: string; sha?: string } = {};
  for (const pair of query.split("&")) {
    const [key, value] = pair.split("=");
    if (key === "repo") out.repo = decodeURIComponent(value ?? "");
    if (key === "sha") out.sha = decodeURIComponent(value ?? "");
  }
  return out;
}
