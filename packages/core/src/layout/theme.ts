import type { EdgeChange, FileStatus } from "../model/types.js";

/**
 * One palette, shared by every renderer.
 *
 * Status lives in the card's outline and edge state lives in the arrow's
 * colour, so a reviewer reads the shape of a change before reading a word of
 * it: green things arrived, red things left, grey things were already there.
 */
export interface Theme {
  background: string;
  cardBackground: string;
  text: string;
  mutedText: string;
  gutter: string;
  /** Band behind a collapsed run of unchanged code. */
  gapBackground: string;
  /**
   * Something the reviewer should know is missing.
   *
   * Reserved for gaps in Odin's own coverage — a file it could not read —
   * rather than anything about the change itself, which uses the diff colours.
   */
  warning: string;
  status: Record<FileStatus, string>;
  change: Record<EdgeChange, string>;
  lineBackground: { add: string; del: string };
}

export const DARK_THEME: Theme = {
  background: "#111113",
  cardBackground: "#0b0b0d",
  text: "#e5e7eb",
  mutedText: "#6b7280",
  gutter: "#3f3f46",
  gapBackground: "#17171b",
  warning: "#e2b341",
  status: {
    added: "#4ade80",
    // Git's own convention for a modified file, and distinct enough from the
    // warning gold that a tan border is never read as a problem.
    modified: "#e2c08d",
    deleted: "#f87171",
    renamed: "#60a5fa",
    phantom: "#52525b",
  },
  change: {
    added: "#4ade80",
    removed: "#f87171",
    unchanged: "#71717a",
  },
  lineBackground: {
    add: "#0f2417",
    del: "#2a1113",
  },
};

export const LIGHT_THEME: Theme = {
  background: "#ffffff",
  cardBackground: "#fafafa",
  text: "#18181b",
  mutedText: "#71717a",
  gutter: "#d4d4d8",
  gapBackground: "#f1f1f4",
  warning: "#a1730a",
  status: {
    added: "#16a34a",
    modified: "#895503",
    deleted: "#dc2626",
    renamed: "#2563eb",
    phantom: "#a1a1aa",
  },
  change: {
    added: "#16a34a",
    removed: "#dc2626",
    unchanged: "#a1a1aa",
  },
  lineBackground: {
    add: "#dcfce7",
    del: "#fee2e2",
  },
};
