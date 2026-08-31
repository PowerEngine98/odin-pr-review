/**
 * How far through building a reading we are, as one number.
 *
 * Every phase used to report in its own words and only one of them — resolving
 * references — could say how far along it was. So a large change showed a note
 * that sat still for six seconds, then a percentage that ran to a hundred, then
 * another note that sat still for three, and the reader had no way to tell any
 * of that from the thing having stopped. On a change the size of a hundred and
 * thirty files that is most of a minute of not knowing.
 *
 * The weights are measured rather than guessed, on a real change of that size:
 *
 *     read the diff              441 ms
 *     materialise the base       260 ms
 *     resolve references        5981 ms
 *     read the code around it   3266 ms
 *     colour it                 2068 ms
 *     lay it out and draw        342 ms
 *
 * They do not have to be right to the millisecond — a percentage that moves at
 * a slightly wrong rate is still a percentage that moves — but they do have to
 * be right about which phases are the long ones, or the bar sits at 4% through
 * half the wait and then jumps.
 */

/** The phases of a build, in the order they happen. */
export const PHASES = [
  { key: "diff", note: "Reading the diff", weight: 4 },
  { key: "base", note: "Materialising the merge base", weight: 2 },
  { key: "resolve", note: "Resolving references", weight: 48 },
  { key: "context", note: "Reading the code around it", weight: 26 },
  { key: "colour", note: "Colouring", weight: 17 },
  { key: "draw", note: "Laying it out", weight: 3 },
] as const;

export type Phase = (typeof PHASES)[number]["key"];

const TOTAL = PHASES.reduce((sum, phase) => sum + phase.weight, 0);

/** What is happening, and how far through the whole of it that is. */
export interface Told {
  note: string;
  /** 0 to 100, over the build rather than over the phase. */
  percent: number;
}

/**
 * A build, reporting itself.
 *
 * Phases that cannot say how far along they are still move the number when they
 * finish, which is the honest thing: "this is happening" and "that much of it is
 * done" are different claims, and a phase with nothing to count should make the
 * second only once.
 */
export class Progress {
  private at = 0;
  /** Whole percent last said, so a phase counting lines does not say it twice. */
  private said = -1;
  private note = "";

  constructor(private readonly tell: (told: Told) => void) {}

  /**
   * Starts a phase.
   *
   * Everything before it is counted as done — a phase that is starting means
   * the one before it is over, whether or not it said so.
   */
  begins(key: Phase, detail?: string): void {
    const found = PHASES.findIndex((phase) => phase.key === key);
    if (found < 0) return;
    this.at = PHASES.slice(0, found).reduce((sum, phase) => sum + phase.weight, 0);
    const phase = PHASES[found]!;
    this.note = detail ? `${phase.note} — ${detail}` : phase.note;
    this.say(0);
  }

  /** How far through the current phase, for a phase that can count. */
  within(done: number, total: number): void {
    if (total <= 0) return;
    this.say(Math.max(0, Math.min(1, done / total)));
  }

  /** Everything is drawn. Said once, so a reader sees it land on a hundred. */
  done(): void {
    this.said = 100;
    this.tell({ note: "Ready", percent: 100 });
  }

  private say(fraction: number): void {
    const phase = PHASES.find((one) => {
      const before = PHASES.slice(0, PHASES.indexOf(one)).reduce(
        (sum, each) => sum + each.weight,
        0,
      );
      return before === this.at;
    });
    const weight = phase?.weight ?? 0;
    const percent = Math.min(
      99,
      Math.round(((this.at + weight * fraction) / TOTAL) * 100),
    );
    // Whole percent, and only when it moves: a change of any size is tens of
    // thousands of lines, and a message per line is a channel full of
    // arithmetic nobody can read.
    if (percent === this.said) return;
    this.said = percent;
    this.tell({ note: this.note, percent });
  }
}
