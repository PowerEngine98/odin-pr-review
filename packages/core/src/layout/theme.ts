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
  status: {
    added: "#4ade80",
    modified: "#d4d4d8",
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
  status: {
    added: "#16a34a",
    modified: "#52525b",
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
