#!/usr/bin/env node
/**
 * The version the next release is published as.
 *
 * Read from the commits since the last release, the way their subjects already
 * say what kind of change each was: a breaking change bumps major (minor while
 * still 0.x, where major has not been promised), a feature bumps minor, anything
 * else bumps patch. Counted from whichever is newer, what is live or what the
 * manifest says — and a manifest bumped by hand past what is live is taken as
 * it stands, because somebody chose that number.
 */

const parse = (version) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);

export function newer(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export function bumpOf(messages) {
  let bump = "patch";
  for (const message of messages) {
    const subject = message.split("\n")[0] ?? "";
    if (/^\w+(\([^)]*\))?!:/.test(subject) || /^BREAKING[ -]CHANGE:/m.test(message)) return "major";
    if (/^feat(\([^)]*\))?:/.test(subject)) bump = "minor";
  }
  return bump;
}

/**
 * What has been published, as far as anything can tell: the store lists a
 * version only once it has been verified, minutes after the upload, so a merge
 * landing in between reads an older version than the one just sent. The last
 * release tag says what was sent.
 */
export function publishedOf(live, tagged) {
  if (!live) return tagged || "";
  if (!tagged) return live;
  return newer(tagged, live) ? tagged : live;
}

export function nextVersion({ manifest, live, messages }) {
  if (!live) return manifest;
  if (newer(manifest, live)) return manifest;
  const [major, minor, patch] = parse(live);
  const bump = bumpOf(messages);
  if (bump === "major" && major > 0) return `${major + 1}.0.0`;
  if (bump === "major" || bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { execFileSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const git = (...args) => {
    try {
      return execFileSync("git", args, { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const manifest = JSON.parse(readFileSync("packages/vscode-ext/package.json", "utf8")).version;
  const live = process.env.LIVE ?? "";
  const since = git("describe", "--tags", "--abbrev=0", "--match", "v*");
  const published = publishedOf(live, since.replace(/^v/, ""));
  const log = git("log", "--format=%B%x1e", since ? `${since}..HEAD` : "HEAD");
  const messages = log.split("\x1e").map((one) => one.trim()).filter(Boolean);
  console.log(nextVersion({ manifest, live: published, messages }));
}
