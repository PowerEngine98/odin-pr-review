import type { ChangeGraph, Edge, FileNode, FileStatus } from "@odin/core";
import * as vscode from "vscode";

import { decorationUri } from "./decorations.js";

/** A row in the sidebar: either a changed file or one reference leaving it. */
type Item =
  | { kind: "file"; node: FileNode }
  | { kind: "edge"; edge: Edge; target: FileNode | undefined };

const STATUS_ICON: Record<FileStatus, string> = {
  added: "diff-added",
  modified: "diff-modified",
  deleted: "diff-removed",
  renamed: "diff-renamed",
  phantom: "circle-outline",
};

const STATUS_COLOR: Record<FileStatus, string | undefined> = {
  added: "gitDecoration.addedResourceForeground",
  modified: "gitDecoration.modifiedResourceForeground",
  deleted: "gitDecoration.deletedResourceForeground",
  renamed: "gitDecoration.renamedResourceForeground",
  phantom: "disabledForeground",
};

/**
 * The graph as a list.
 *
 * The canvas answers "what shape is this change"; this answers "what is in it,
 * and what does each part reach". Keeping both means the reviewer can scan or
 * explore without choosing up front, and the sidebar stays usable on a change
 * far too large to take in visually.
 */
export class ChangeTreeProvider implements vscode.TreeDataProvider<Item> {
  private readonly changed = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private graph: ChangeGraph | undefined;

  setGraph(graph: ChangeGraph | undefined): void {
    this.graph = graph;
    this.changed.fire(undefined);
  }

  getChildren(item?: Item): Item[] {
    if (!this.graph) return [];

    if (!item) {
      return this.graph.nodes.map((node) => ({ kind: "file" as const, node }));
    }
    if (item.kind === "edge") return [];

    const byId = new Map(this.graph.nodes.map((n) => [n.id, n]));
    return this.graph.edges
      .filter((edge) => edge.from.nodeId === item.node.id)
      .map((edge) => ({
        kind: "edge" as const,
        edge,
        target: byId.get(edge.to.nodeId),
      }));
  }

  getTreeItem(item: Item): vscode.TreeItem {
    return item.kind === "file" ? this.fileItem(item.node) : this.edgeItem(item);
  }

  private fileItem(node: FileNode): vscode.TreeItem {
    const outgoing =
      this.graph?.edges.filter((e) => e.from.nodeId === node.id).length ?? 0;

    const treeItem = new vscode.TreeItem(
      basename(node.path),
      outgoing > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    const colour = STATUS_COLOR[node.status];
    treeItem.iconPath = new vscode.ThemeIcon(
      STATUS_ICON[node.status],
      colour ? new vscode.ThemeColor(colour) : undefined,
    );

    const stats =
      node.status === "phantom"
        ? "untouched"
        : `+${node.stats.additions} −${node.stats.deletions}`;
    // Without this a file nothing could read is indistinguishable from one that
    // genuinely references nothing.
    treeItem.description =
      node.resolution === "unsupported"
        ? `${stats} · no ${node.language} resolver`
        : stats;

    // Lets the decoration provider tint the row when nothing could read it.
    if (node.resolution === "unsupported") {
      treeItem.resourceUri = decorationUri(node.path);
    }

    treeItem.tooltip = new vscode.MarkdownString(
      [
        `**${node.path}**`,
        node.prevPath ? `renamed from \`${node.prevPath}\`` : undefined,
        `${node.status} · ${node.language}`,
        node.resolution === "unsupported"
          ? `⚠ no ${node.language} resolver — this file has no references`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );

    treeItem.command = {
      command: "odin.openFile",
      title: "Open",
      arguments: [node.path],
    };
    treeItem.contextValue = `odinFile.${node.status}`;
    return treeItem;
  }

  private edgeItem(item: Extract<Item, { kind: "edge" }>): vscode.TreeItem {
    const { edge, target } = item;
    const treeItem = new vscode.TreeItem(
      edge.to.symbolName ?? "reference",
      vscode.TreeItemCollapsibleState.None,
    );

    // The arrow's direction of travel is what the reviewer is scanning for, so
    // it leads the row rather than the symbol's kind.
    const icon =
      edge.change === "added"
        ? "diff-added"
        : edge.change === "removed"
          ? "diff-removed"
          : "arrow-small-right";
    const colour =
      edge.change === "added"
        ? "gitDecoration.addedResourceForeground"
        : edge.change === "removed"
          ? "gitDecoration.deletedResourceForeground"
          : "disabledForeground";

    treeItem.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(colour));
    treeItem.description = target
      ? `${basename(target.path)}:${edge.to.line}`
      : `line ${edge.to.line}`;
    treeItem.tooltip = new vscode.MarkdownString(
      [
        edge.label ? `\`${edge.label}\`` : undefined,
        target ? `→ \`${target.path}:${edge.to.line}\`` : undefined,
        `${edge.change} ${edge.kind} · ${edge.confidence}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );

    treeItem.command = {
      command: "odin.followEdge",
      title: "Follow",
      arguments: [
        {
          toPath: target?.path ?? "",
          toLine: edge.to.line,
          toSide: edge.to.side,
        },
      ],
    };
    return treeItem;
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
