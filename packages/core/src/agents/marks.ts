/**
 * A face for each agent, so a thread reads as a conversation.
 *
 * Everybody else in a thread has a picture — the forge hands one over with
 * every comment — and an agent that writes into the same thread without one
 * reads as a system message rather than as somebody talking. The whole point of
 * putting agents in the comments was that the reader could audit them the way
 * they audit a colleague, and a wall of identical grey initials is not that.
 *
 * Drawn rather than fetched. A webview will not load a remote image, these are
 * wanted before any network call has been made, and a mark that arrives a
 * second late is a face that pops in after the message it belongs to.
 *
 * Deliberately not the providers' logos. These are simple geometric marks in
 * each provider's own colour: enough for a reader to tell Claude from Codex at
 * a glance without this shipping copies of anybody's trademark.
 */

export interface AgentMark {
  /** The provider's colour, which is what actually does the telling apart. */
  color: string;
  /** Ink for anything drawn on top of that colour. */
  ink: string;
  /** The glyph, as SVG path data on a 24×24 grid. */
  path: string;
  /** Whether the glyph is stroked rather than filled. */
  stroke?: boolean;
}

const MARKS: Record<string, AgentMark> = {
  claude: {
    color: "#d97757",
    ink: "#ffffff",
    // A burst: six strokes from the middle.
    path: "M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7",
    stroke: true,
  },
  codex: {
    color: "#10a37f",
    ink: "#ffffff",
    // A ring.
    path: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
    stroke: true,
  },
  gemini: {
    color: "#4285f4",
    ink: "#ffffff",
    // A four-pointed spark.
    path: "M12 3c.6 4.5 1.9 5.9 6.4 6.5-4.5.6-5.8 2-6.4 6.5-.6-4.5-1.9-5.9-6.4-6.5C10.1 8.9 11.4 7.5 12 3z",
  },
  cursor: {
    color: "#8b8b93",
    ink: "#ffffff",
    // A pointer.
    path: "M7 4l11 8-5 1 3 5-2 1-3-5-4 3z",
  },
  antigravity: {
    color: "#f9ab00",
    ink: "#20140a",
    // Up, which is the whole joke.
    path: "M12 5l6 7h-4v7h-4v-7H6z",
  },
  aider: {
    color: "#14b8a6",
    ink: "#ffffff",
    // Two things working on one thing.
    path: "M9.5 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM14.5 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
    stroke: true,
  },
};

/** A mark for an agent, and something plausible for one nobody planned for. */
export function markOf(id: string): AgentMark {
  return (
    MARKS[id] ?? {
      color: "#7d8590",
      ink: "#ffffff",
      // A full stop: an agent this build has never heard of still needs a face,
      // and a shape that means nothing is better than one that means something
      // else.
      path: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    }
  );
}

/**
 * The mark as a whole image, ready to be a source.
 *
 * A data URI rather than a file, because every surface that wants one refuses
 * to fetch: a webview blocks remote images outright, and the page `odin view`
 * writes is a single document that has to work with no server behind it.
 *
 * Encoded rather than base64'd. SVG is text, the escaping needed is three
 * characters, and the result is both smaller and readable in a stack trace.
 */
export function avatarFor(id: string): string {
  const mark = markOf(id);
  const glyph = mark.stroke
    ? `<path d="${mark.path}" fill="none" stroke="${mark.ink}" stroke-width="2" stroke-linecap="round"/>`
    : `<path d="${mark.path}" fill="${mark.ink}"/>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">` +
    `<rect width="24" height="24" rx="12" fill="${mark.color}"/>` +
    glyph +
    `</svg>`;

  return `data:image/svg+xml,${encode(svg)}`;
}

/**
 * The few characters that cannot travel in a URI as themselves.
 *
 * `encodeURIComponent` would work and would triple the length: almost every
 * character in an SVG is one it escapes. These are the ones that actually end
 * the attribute or the URI.
 */
function encode(svg: string): string {
  return svg
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/"/g, "'");
}
