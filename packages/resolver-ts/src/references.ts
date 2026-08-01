import ts from "typescript";

/** A reference found in the source text, before its target is resolved. */
export interface ReferenceSite {
  /** The identifier to resolve: a callee name, a type name, or a specifier. */
  node: ts.Node;
  kind: "call" | "instantiation" | "import" | "type";
  /** 0-based column of the reference on its line. */
  column: number;
  /** Trimmed source text of the whole expression, for hover labels. */
  label: string;
}

/**
 * Finds every outgoing reference that starts on a given line.
 *
 * Anchoring on the line where the reference *starts* keeps a multi-line call
 * attached to the line the reviewer sees changed, rather than to whichever
 * line happens to hold the closing parenthesis.
 */
export function findReferencesOnLine(
  source: ts.SourceFile,
  line: number,
): ReferenceSite[] {
  const found: ReferenceSite[] = [];
  const zeroBased = line - 1;
  if (zeroBased < 0) return found;

  const visit = (node: ts.Node): void => {
    const site = classify(node);
    if (site) {
      const { line: startLine, character } =
        source.getLineAndCharacterOfPosition(site.node.getStart(source));
      if (startLine === zeroBased) {
        found.push({ ...site, column: character });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  found.sort((a, b) => a.column - b.column);
  return found;
}

function classify(node: ts.Node): Omit<ReferenceSite, "column"> | undefined {
  if (ts.isCallExpression(node)) {
    const callee = calleeIdentifier(node.expression);
    if (callee) return { node: callee, kind: "call", label: text(node) };
    return undefined;
  }

  if (ts.isNewExpression(node)) {
    const callee = calleeIdentifier(node.expression);
    if (callee) return { node: callee, kind: "instantiation", label: text(node) };
    return undefined;
  }

  // A component written into a page is a call: `<Header />` runs Header. The
  // arrow is worth as much as any other, and on a React codebase it is most of
  // them — a file that renders six components and calls two functions would
  // otherwise show two.
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = componentTag(node.tagName);
    if (tag) {
      return { node: tag, kind: "instantiation", label: `<${text(node.tagName)}>` };
    }
    return undefined;
  }

  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    if (specifier && ts.isStringLiteral(specifier)) {
      return { node: specifier, kind: "import", label: specifier.text };
    }
    return undefined;
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = ts.isQualifiedName(node.typeName)
      ? node.typeName.right
      : node.typeName;
    return { node: name, kind: "type", label: text(node) };
  }

  return undefined;
}

/**
 * The identifier a JSX tag names, when it names a component at all.
 *
 * `<div>` is not a reference to anything a reviewer can open: it resolves into
 * React's own intrinsic-element declarations, which is noise. The convention
 * that tells them apart is the capital letter, and it is the same convention
 * the compiler itself uses.
 */
function componentTag(tag: ts.JsxTagNameExpression): ts.Node | undefined {
  if (ts.isIdentifier(tag)) {
    const first = tag.text.charAt(0);
    return first && first === first.toUpperCase() && first !== first.toLowerCase()
      ? tag
      : undefined;
  }
  // `<Icons.Chevron />` names Chevron, the same way a property call does.
  if (ts.isPropertyAccessExpression(tag)) return tag.name;
  return undefined;
}

/** The identifier a call ultimately names, seeing through property access. */
function calleeIdentifier(expression: ts.Expression): ts.Node | undefined {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression)) return expression.name;
  if (ts.isElementAccessExpression(expression)) {
    // `obj["method"]()` carries a resolvable name only when it is a literal.
    const arg = expression.argumentExpression;
    return ts.isStringLiteral(arg) ? arg : undefined;
  }
  // Immediately-invoked expressions and calls on call results have no single
  // name to point an arrow at.
  return undefined;
}

function text(node: ts.Node): string {
  const raw = node.getText();
  const firstLine = raw.split("\n", 1)[0] ?? raw;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine.trim();
}
