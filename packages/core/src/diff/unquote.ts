/**
 * Git quotes paths containing control characters, quotes, backslashes or
 * non-ASCII bytes (unless `core.quotepath=false`) using C-style escapes wrapped
 * in double quotes. Octal escapes are byte-wise, so they must be collected as
 * bytes and decoded as UTF-8 at the end rather than one character at a time.
 */
export function unquotePath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;

  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") {
      // Non-escaped run: push its UTF-8 bytes verbatim.
      for (const b of encoder.encode(ch)) bytes.push(b);
      continue;
    }

    const next = body[++i];
    if (next === undefined) break;

    switch (next) {
      case "a": bytes.push(0x07); break;
      case "b": bytes.push(0x08); break;
      case "f": bytes.push(0x0c); break;
      case "n": bytes.push(0x0a); break;
      case "r": bytes.push(0x0d); break;
      case "t": bytes.push(0x09); break;
      case "v": bytes.push(0x0b); break;
      case '"': bytes.push(0x22); break;
      case "\\": bytes.push(0x5c); break;
      default: {
        if (next >= "0" && next <= "7") {
          let octal = next;
          while (octal.length < 3) {
            const d = body[i + 1];
            if (d === undefined || d < "0" || d > "7") break;
            octal += d;
            i++;
          }
          bytes.push(parseInt(octal, 8) & 0xff);
        } else {
          // Unknown escape: keep it literally rather than losing data.
          for (const b of encoder.encode(next)) bytes.push(b);
        }
      }
    }
  }

  return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
}

/** Strips the `a/` / `b/` prefix git puts on paths, honouring `/dev/null`. */
export function stripPrefix(path: string): string {
  if (path === "/dev/null") return path;
  if (path.length > 2 && (path.startsWith("a/") || path.startsWith("b/"))) {
    return path.slice(2);
  }
  return path;
}
