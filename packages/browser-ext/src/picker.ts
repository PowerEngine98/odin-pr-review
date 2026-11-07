import type { PullRequestSummary } from "@odin/core";
import { DARK_THEME, LIGHT_THEME } from "@odin/core";
import { renderSidebar, type PickerView, type SidebarModel } from "@odin/webview";

import type { Asked, PullJson } from "./github.js";

export function ago(iso: string | undefined, now = Date.now()): string {
  const then = Date.parse(iso ?? "");
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor((now - then) / 86_400_000);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

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

const NARROW = "<style>body{max-width:760px;margin:0 auto;}</style>";

export function pickerPage(picker: PickerView, dark: boolean): string {
  const model: SidebarModel = { loading: false, picker };
  return renderSidebar(model, dark ? DARK_THEME : LIGHT_THEME).replace("</head>", `${NARROW}</head>`);
}
