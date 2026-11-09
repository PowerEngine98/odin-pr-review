import { arrowsOf, highlightsOf, type Frame, type Tour } from "@odin/core/tour/tour.js";

function base(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function where(frame: Frame): string {
  switch (frame.kind) {
    case "go":
    case "focus":
      return base(frame.file);
    case "highlight":
      return highlightsOf(frame).map((one) => base(one.file)).join(", ");
    case "arrow":
      return arrowsOf(frame).map((one) => `${base(one.from.file)} → ${base(one.to.file)}`).join(", ");
    default:
      return "";
  }
}

/** The tour as lines a reader and an agent can both follow: topic, then what each frame says and where. */
export function outline(tour: Tour): string {
  return tour.topics
    .map((topic, t) => {
      const frames = topic.frames
        .filter((frame) => frame.say && frame.kind !== "title")
        .map((frame, f) => {
          const at = where(frame);
          return `   ${f + 1}. ${at ? `[${at}] ` : ""}${frame.say}`;
        });
      return [`${t + 1}. ${topic.title} — ${topic.summary}`, ...frames].join("\n");
    })
    .join("\n\n");
}

/**
 * Asks the agent to turn on its own work: the tour is its account of the
 * change, and every claim in it is a thing to check rather than to trust.
 * It ends in a plan and a stop, never in edits.
 */
export function reflectPrompt(tour: Tour): string {
  return `Reflect on the changes. Act as the strictest reviewer this change will meet, not as its author.

Below is the guided tour of the change: its own account of what was done and why. Call the odin tour_read tool for the full tour with its exact code anchors. Then read the code each frame points at.

How to read it
- Treat every sentence as a claim to verify, not a fact. Check it against the code; say which claims are wrong, overstated, or hiding a cost.
- Detach from ownership: assume someone else wrote this and you have to sign off on it.
- Look for: simpler shapes, needless indirection or abstractions, duplicated logic, unclear names, missing or wrong edge cases, concurrency or transaction gaps, performance costs (extra queries, N+1, locks held too long), and code that reads worse than it needs to.
- Where the tour had to work hard to explain something, ask whether the code should be easier instead.

What to answer
- A short critique: each finding with file, what is wrong or weak, and why it matters.
- A plan: the concrete changes you propose, ordered by value, each with its trade-off. Say what you would leave alone and why.
- Then stop. This is planning only: do not edit files, run commands that change anything, or update the tour. Wait for my explicit go-ahead on the plan before implementing any of it.

The tour: "${tour.title}"

${outline(tour)}`;
}
