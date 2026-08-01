import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import * as vscode from "vscode";

import { stripJsonc } from "./jsonc.js";

/**
 * The colour theme the reviewer is actually using, as Shiki can consume it.
 *
 * The editor publishes its workbench colours to a webview as CSS variables but
 * says nothing about token colours, so the only way to colour code the way the
 * editor next to it colours code is to read the theme the same way the editor
 * does: find the extension contributing it, and read its file.
 *
 * Everything here is best-effort. A theme that cannot be found or parsed leaves
 * the caller to fall back on VS Code's own default, which is a close relative of
 * most themes and a good deal better than no colour at all.
 */
export async function activeTheme(): Promise<Record<string, unknown> | undefined> {
  const label = vscode.workspace
    .getConfiguration("workbench")
    .get<string>("colorTheme");
  if (!label) return undefined;

  const found = findTheme(label);
  if (!found) return undefined;

  const theme = await readTheme(found.path);
  if (!theme) return undefined;

  // The file may not say; the manifest always does, and Shiki needs to know
  // which way round the defaults go.
  if (!theme.type) theme.type = found.dark ? "dark" : "light";
  theme.name = label;
  return theme;
}

/** Which extension contributes the named theme, and where its file is. */
function findTheme(label: string): { path: string; dark: boolean } | undefined {
  for (const extension of vscode.extensions.all) {
    const contributed = (extension.packageJSON as {
      contributes?: {
        themes?: { id?: string; label?: string; uiTheme?: string; path: string }[];
      };
    }).contributes?.themes;
    if (!contributed) continue;

    for (const theme of contributed) {
      if (theme.label !== label && theme.id !== label) continue;
      return {
        path: resolve(extension.extensionPath, theme.path),
        dark: theme.uiTheme !== "vs" && theme.uiTheme !== "hc-light",
      };
    }
  }
  return undefined;
}

/**
 * Reads a theme file, following whatever it includes.
 *
 * Themes are routinely a thin file that includes a thicker one — Dark+ is
 * exactly that — so a reader that stops at the first file gets a handful of
 * overrides and none of the colours they override.
 *
 * The files are JSON with comments and trailing commas, which is why this does
 * not use JSON.parse.
 */
async function readTheme(
  path: string,
  seen = new Set<string>(),
): Promise<Record<string, unknown> | undefined> {
  if (seen.has(path)) return undefined;
  seen.add(path);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }

  let theme: Record<string, unknown> | undefined;
  try {
    theme = JSON.parse(stripJsonc(raw)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!theme || typeof theme !== "object") return undefined;

  const include = theme.include;
  if (typeof include !== "string") return theme;

  const base = await readTheme(resolve(dirname(path), include), seen);
  if (!base) return theme;

  // The including file wins, and the two token lists are concatenated with the
  // override last, which is the order a TextMate matcher resolves them in.
  return {
    ...base,
    ...theme,
    colors: { ...(base.colors as object), ...(theme.colors as object) },
    tokenColors: [
      ...((base.tokenColors as unknown[]) ?? []),
      ...((theme.tokenColors as unknown[]) ?? []),
    ],
  };
}
