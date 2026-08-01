import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GitOptions } from "./exec.js";

export interface Checkout {
  /** Absolute path to the materialised tree. */
  dir: string;
  /** Removes the tree. Safe to call more than once. */
  dispose(): void;
}

/**
 * Materialises a commit into a throwaway directory.
 *
 * Uses `git archive` piped into `tar` rather than `git worktree add`, because a
 * worktree mutates the user's repository state (it registers an entry, takes a
 * lock, and leaves debris if the process is killed). Reviewing a pull request
 * should never touch the repository it is reading.
 *
 * `node_modules` from the live checkout is symlinked in when present, so that a
 * type-aware resolver can still follow imports. Its contents are excluded from
 * results anyway; the link only stops resolution failing outright.
 */
export function materializeTree(sha: string, options: GitOptions): Promise<Checkout> {
  const dir = mkdtempSync(join(tmpdir(), "odin-base-"));

  return new Promise((resolve, reject) => {
    const child = execFile(
      "bash",
      ["-c", 'git archive --format=tar "$1" | tar -x -C "$2"', "--", sha, dir],
      { cwd: options.cwd, maxBuffer: 1024 * 1024 },
      (error) => {
        if (error) {
          rmSync(dir, { recursive: true, force: true });
          reject(new Error(`could not materialise ${sha}: ${error.message}`));
          return;
        }

        const modules = join(options.cwd, "node_modules");
        if (existsSync(modules) && !existsSync(join(dir, "node_modules"))) {
          try {
            symlinkSync(modules, join(dir, "node_modules"), "dir");
          } catch {
            // Optional convenience; resolution degrades but still works.
          }
        }

        let disposed = false;
        resolve({
          dir,
          dispose() {
            if (disposed) return;
            disposed = true;
            rmSync(dir, { recursive: true, force: true });
          },
        });
      },
    );
    child.on("error", reject);
  });
}
