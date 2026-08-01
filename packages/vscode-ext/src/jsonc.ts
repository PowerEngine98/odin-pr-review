/**
 * JSON with the liberties theme files take: comments, and trailing commas.
 *
 * Written here rather than pulled in, after the obvious library turned out to
 * require a file lazily and so could not be bundled into a single-file
 * extension. String state is tracked, because `"// not a comment"` appears in
 * these files constantly — a scope selector is full of slashes.
 */
export function stripJsonc(source: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;

    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }

    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }

    out += c;
  }

  // A comma before a closing brace or bracket, with only whitespace between.
  return out.replace(/,(\s*[}\]])/g, "$1");
}
