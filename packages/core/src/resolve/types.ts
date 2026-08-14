import type {
  Confidence,
  EdgeKind,
  LineKind,
  ResolverId,
  Side,
} from "../model/types.js";

/**
 * A request to find outgoing references on one line of one file.
 *
 * Probes are line-granular rather than position-granular because the diff only
 * tells us which lines changed, not where within them anything interesting
 * sits. Finding the actual call expressions is the resolver's job, since only
 * it knows the language.
 */
export interface LineProbe {
  /** Repository-relative path on `side`. */
  path: string;
  side: Side;
  /** 1-based line number on `side`. */
  line: number;
  /**
   * Role this line plays in the diff. Resolvers ignore it and pass it through;
   * edge assembly uses it to decide whether a reference is being added,
   * removed, or was there all along.
   */
  changeKind: LineKind;
}

/** One outgoing reference discovered on a probed line. */
export interface ResolvedTarget {
  /** Repository-relative path of the definition. */
  path: string;
  /** 1-based line of the definition. */
  line: number;
  /** 0-based column of the definition name. */
  column?: number;
  /** Which checkout the definition was found in. */
  side: Side;
  symbolName: string;
  symbolKind?: string;
  kind: EdgeKind;
  confidence: Confidence;
  /** 0-based column of the reference within the probed line. */
  fromColumn?: number;
  /** Name of the declaration containing the reference, when known. */
  fromSymbolName?: string;
  /** Trimmed source text of the reference, for hover labels. */
  label?: string;
  /** Which resolver produced this, when several are in play. */
  resolver?: ResolverId;
}

export interface ProbeResult {
  probe: LineProbe;
  targets: ResolvedTarget[];
}

/**
 * The seam between the change graph and language intelligence.
 *
 * Implementations exist for the TypeScript compiler API (works headlessly, so
 * the CLI gets real resolution) and, later, for the VS Code language server
 * (covers whatever languages the user has extensions for). Nothing in `@odin/core`
 * knows which one it is talking to.
 */
export interface ReferenceResolver {
  readonly id: string;
  /**
   * Languages this resolver can answer for, as VS Code language ids.
   *
   * Declared rather than discovered so the graph can say which files nothing
   * was able to look at. A file with no arrows is ambiguous otherwise: it might
   * reference nothing, or nothing might have been able to tell.
   */
  readonly languages: readonly string[];
  /**
   * Answers what every one of these lines points at.
   *
   * `onProbe` is called once per line looked at, whether or not anything was
   * found. Resolving is the slow half of a build — seconds, on a change of any
   * size — and this is the only place that knows how far through it is. A
   * resolver that does not report simply says nothing, and the caller falls
   * back to saying that work is happening without saying how much is left.
   */
  resolve(probes: LineProbe[], onProbe?: () => void): Promise<ProbeResult[]>;
  dispose?(): void | Promise<void>;
}
