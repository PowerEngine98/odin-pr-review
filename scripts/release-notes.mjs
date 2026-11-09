export const SECTIONS = ["New features", "UI/UX", "Quality of life", "Bug fixes"];

const PLACEHOLDER = /^(none|n\/a|-|nothing|tbd|\.\.\.)\.?$/i;

export function sectionOf(heading) {
  const text = heading.toLowerCase();
  if (/feature/.test(text)) return "New features";
  if (/\bui\b|\bux\b|design|look/.test(text)) return "UI/UX";
  if (/quality|qol|improve/.test(text)) return "Quality of life";
  if (/bug|fix/.test(text)) return "Bug fixes";
  return undefined;
}

export function changelogOf(body) {
  const found = new Map(SECTIONS.map((one) => [one, []]));
  const text = String(body ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/\r/g, "");
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#{1,3}\s*changelog\b/i.test(line.trim()));
  if (start < 0) return found;
  const depth = lines[start].trim().match(/^#+/)[0].length;
  let section;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    const heading = line.match(/^(#+)\s*(.+)$/);
    if (heading) {
      if (heading[1].length <= depth) break;
      section = sectionOf(heading[2]);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (!bullet || !section) continue;
    const said = bullet[1].trim();
    if (!said || PLACEHOLDER.test(said)) continue;
    found.get(section).push(said);
  }
  return found;
}

export function isWritten(body) {
  return [...changelogOf(body).values()].some((list) => list.length > 0);
}

const SKIPPED = /^(chore|docs|test|tests|ci|build|style|release)(\(|!|:)/i;

export function fromSubject(subject) {
  const line = String(subject).split("\n")[0].trim();
  if (!line || SKIPPED.test(line) || /^Merge /.test(line)) return undefined;
  const match = line.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/);
  if (!match) return undefined;
  const kind = match[1].toLowerCase();
  const said = match[2].replace(/\s*\(#\d+\)\s*/g, " ").trim();
  const text = said.charAt(0).toUpperCase() + said.slice(1);
  if (kind === "feat") return { section: "New features", text };
  if (kind === "fix") return { section: "Bug fixes", text };
  if (kind === "perf" || kind === "refactor") return { section: "Quality of life", text };
  return undefined;
}

export function pullOf(subject) {
  const merged = String(subject).match(/^Merge pull request #(\d+)/);
  if (merged) return Number(merged[1]);
  const squashed = [...String(subject).split("\n")[0].matchAll(/\(#(\d+)\)/g)];
  return squashed.length ? Number(squashed[squashed.length - 1][1]) : undefined;
}

export function notesOf(commits, bodies) {
  const merged = new Map(SECTIONS.map((one) => [one, []]));
  const add = (section, text) => {
    const list = merged.get(section);
    if (!list.some((one) => one.toLowerCase() === text.toLowerCase())) list.push(text);
  };
  const used = new Set();
  for (const subject of commits) {
    const pull = pullOf(subject);
    const body = pull !== undefined ? bodies.get(pull) : undefined;
    if (body !== undefined && isWritten(body)) {
      if (used.has(pull)) continue;
      used.add(pull);
      for (const [section, list] of changelogOf(body)) for (const text of list) add(section, text);
      continue;
    }
    const guessed = fromSubject(subject);
    if (guessed) add(guessed.section, guessed.text);
  }
  const parts = [];
  for (const [section, list] of merged) {
    if (list.length === 0) continue;
    parts.push(`### ${section}\n\n${list.map((one) => `- ${one}`).join("\n")}`);
  }
  return parts.length ? parts.join("\n\n") : "- Maintenance release.";
}

export function withEntry(changelog, version, date, notes) {
  const rest = String(changelog ?? "").replace(/^# Changelog\s*/, "").trimStart();
  return `# Changelog\n\n## ${version} — ${date}\n\n${notes}\n${rest ? `\n${rest}` : ""}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { execFileSync } = await import("node:child_process");
  const run = (command, args) => {
    try {
      return execFileSync(command, args, { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const mode = process.argv[2];
  if (mode === "check") {
    const body = process.env.PR_BODY ?? "";
    if (isWritten(body)) {
      console.log("Changelog written.");
    } else {
      console.log(
        `::error::Write the changelog in this pull request's description: a "## Changelog" section with at least one bullet under ${SECTIONS.map((one) => `"### ${one}"`).join(", ")}. A pull request with nothing for users to read can carry the "skip changelog" label instead.`,
      );
      process.exit(1);
    }
  } else {
    const since = mode ?? run("git", ["tag", "--list", "v*", "--sort=-version:refname"]).split("\n")[0];
    const until = process.argv[3] ?? "HEAD";
    const log = run("git", ["log", "--format=%B%x1e", since ? `${since}..${until}` : until]);
    const commits = log.split("\x1e").map((one) => one.trim()).filter(Boolean);
    const bodies = new Map();
    for (const subject of commits) {
      const pull = pullOf(subject);
      if (pull === undefined || bodies.has(pull)) continue;
      const body = run("gh", ["pr", "view", String(pull), "--json", "body", "-q", ".body"]);
      bodies.set(pull, body);
    }
    console.log(notesOf(commits, bodies));
  }
}
