import type { ChangeGraph, PullRequestSummary } from "@odin/core";
import { DARK_THEME, LIGHT_THEME } from "@odin/core";
import { ago, changeView, renderSidebar, type PickerView, type SidebarModel } from "@odin/webview";

import type { Asked, PullJson } from "./github.js";
import { editorVariables } from "./vscode-vars.js";

export { ago };

export function summaryOf(pull: PullJson): PullRequestSummary {
  const state: "open" | "merged" | "closed" = pull.merged_at ? "merged" : pull.state === "closed" ? "closed" : "open";
  return {
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    draft: pull.draft === true,
    state,
    baseRefName: pull.base.ref,
    headRefName: pull.head.ref,
    branch: pull.head.ref,
    author: pull.user?.login ?? "",
    createdAt: pull.created_at ?? "",
    ...(pull.updated_at ? { updatedAt: pull.updated_at } : {}),
    headSha: pull.head.sha,
    ...(pull.user?.avatar_url ? { avatarUrl: pull.user.avatar_url } : {}),
    requestedFrom: [
      ...(pull.requested_reviewers ?? []).map((r) => r.login),
      ...(pull.requested_teams ?? []).map((t) => t.slug),
    ],
  };
}

export function pickerOf(
  pulls: PullJson[],
  viewer: string,
  asked: { state: Asked; author: string },
  reached = true,
): PickerView {
  const summaries = pulls.map(summaryOf);
  const mine = viewer
    ? summaries.filter((pr) => (pr.requestedFrom ?? []).includes(viewer))
    : [];
  const row = (pr: PullRequestSummary) => ({
    pr,
    current: false,
    moved: false,
    when: ago(pr.updatedAt ?? pr.createdAt),
    opened: ago(pr.createdAt),
  });
  return {
    mine: mine.map(row),
    everythingElse: summaries.filter((pr) => !mine.includes(pr)).map(row),
    asked,
    viewer,
    reached,
    browser: true,
  };
}

export function changeModel(graph: ChangeGraph, viewed: ReadonlySet<string>, picker: PickerView): SidebarModel {
  const change = changeView(graph, (path) => viewed.has(path));
  return { loading: false, picker, change: { ...change, reading: { ...change.reading, browser: true } } };
}

export function sidebarPage(model: SidebarModel, dark: boolean): string {
  return renderSidebar(model, dark ? DARK_THEME : LIGHT_THEME).replace("</head>", `${editorVariables(dark)}</head>`);
}
