import {
  buildGraph,
  DARK_THEME,
  layoutGraph,
  LIGHT_THEME,
  parseUnifiedDiff,
  withoutTests,
  type ChangeGraph,
  type Snippet,
} from "@odin/core";
import { loadHighlighter } from "@odin/highlight";
import { renderHtml } from "@odin/webview";

import { stateOf, type PullJson } from "./github.js";

export const GENERATOR = "odin-pr-review-browser/0.1.0";

export function graphOf(pull: PullJson, diff: string): ChangeGraph {
  return buildGraph(parseUnifiedDiff(diff), {
    meta: {
      baseRef: pull.base.ref,
      headRef: pull.head.ref,
      baseSha: pull.base.sha,
      headSha: pull.head.sha,
      generator: GENERATOR,
      pullRequest: {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        draft: pull.draft === true,
        state: stateOf(pull),
        baseRefName: pull.base.ref,
        headRefName: pull.head.ref,
        ...(pull.merge_commit_sha && pull.merged_at ? { mergeCommit: pull.merge_commit_sha } : {}),
      },
    },
  });
}

export async function pageOf(
  pull: PullJson,
  everything: ChangeGraph,
  options: {
    dark: boolean;
    snippets?: [string, Snippet[]][];
    locked?: Record<string, string>;
    unlock?: boolean;
  },
): Promise<string> {
  const graph = withoutTests(everything);
  const snippets = new Map(options.snippets ?? []);
  const shape = (g: ChangeGraph, unified: boolean) =>
    layoutGraph(g, { snippets, unified, includeImports: true });
  const highlight = await loadHighlighter(
    everything.nodes.map((n) => n.language ?? "plaintext"),
    { dark: options.dark },
  );
  return renderHtml(graph, shape(graph, false), {
    theme: options.dark ? DARK_THEME : LIGHT_THEME,
    title: `#${pull.number} ${pull.title} · Odin`,
    includeImports: true,
    withTests: shape(everything, false),
    alternate: {
      layout: shape(graph, true),
      withTests: shape(everything, true),
    },
    highlight,
    ...(options.locked ? { locked: options.locked } : {}),
    ...(options.unlock ? { unlock: true } : {}),
  });
}
