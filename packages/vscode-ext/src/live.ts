import { watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";

import {
  git,
  graphDelta,
  historyFiles,
  unchanged,
  type ChangeGraph,
  type GraphDelta,
} from "@odin/core";
import * as vscode from "vscode";

/**
 * Paths that are not the project.
 *
 * `.git` is the loud one: an editor with a git extension in it touches the
 * index, the refs and a handful of lock files constantly, and every one of
 * those arrives here as a file event. Rebuilding the graph because git wrote
 * its own index would mean the graph rebuilt forever, each rebuild provoking
 * the next.
 *
 * Everything else is left to `git check-ignore`, which knows what this
 * project considers noise better than a list here could. A repository is
 * perfectly entitled to have a `dist` directory under review.
 */
export function isNoise(relative: string): boolean {
  const parts = relative.split("/");
  /*
   * `.worktrees` is the other one, and it is Odin's own doing.
   *
   * Reading two branches at once means a second checkout, and the second
   * checkout is kept inside the repository so that git can hide it. Hidden from
   * git is not hidden from a file watcher: without this, every save in the
   * branch being read side by side would rebuild the main reading as well, and
   * a checkout being made — thousands of files at once — would rebuild it for
   * minutes.
   */
  return (
    parts.includes(".git") ||
    parts.includes(".worktrees") ||
    parts.some((p) => p.endsWith(".swp"))
  );
}

/** How many paths one `check-ignore` is asked about, to stay under ARGV. */
const BATCH = 200;

/**
 * Which of these paths git has been told to ignore.
 *
 * Asked in batches rather than once per path: a save in a watched project can
 * arrive as a dozen events at once, and a dozen processes to answer a question
 * nobody has asked yet is the kind of cost that turns a background feature
 * into a reason to turn it off.
 *
 * The index is deliberately consulted, which is `check-ignore`'s default. A
 * file that is tracked is under review whatever the ignore rules say about its
 * name — that is what tracking means — and `--no-index` would drop it.
 */
export async function ignoredBy(
  repo: string,
  paths: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();

  for (let at = 0; at < paths.length; at += BATCH) {
    const batch = paths.slice(at, at + BATCH);
    // Exits 1 when nothing matched, which execFile reports as a failure. That
    // is an answer of "none of them", not a broken repository.
    const out = await git(["check-ignore", "--", ...batch], { cwd: repo })
      .catch(() => "");
    for (const line of out.split("\n")) {
      const path = line.trim();
      if (path) found.add(path);
    }
  }

  return found;
}

/** A rebuild's answer, whole or in two parts. */
export interface Staged {
  graph: ChangeGraph;
  /** The rest of the work, absent when this answer is already final. */
  rest?: () => Promise<ChangeGraph | undefined>;
}

export interface LiveOptions {
  /** Repository root, which is what is watched. */
  repo: string;
  /**
   * The folders the editor actually has open, which are watched as well.
   *
   * Watching the repository root alone is not enough, and the way it fails is
   * silent. A reader very often opens a subdirectory of the repository — the
   * front end of a monorepo, say — and the root is then the *parent* of the
   * workspace. A watcher based above the workspace is not the workspace's own
   * recursive watcher; the editor may decline to set one up, and what arrives
   * here is nothing at all, forever, with no error to go on.
   *
   * The folders the editor has open are the case it is certain about, so they
   * are asked for by name too. Overlapping watchers are harmless: the same
   * path arriving twice is one entry in a set.
   */
  roots?: readonly string[];
  /**
   * Rebuilds the graph from the working tree as it now is.
   *
   * May answer in two parts. The diff is a tenth of a second and the
   * references are three, so a rebuild that has to do both hands back what it
   * has and a way to finish — the reader sees the line they just typed without
   * waiting for the compiler to be told about the whole checkout again.
   */
  rebuild: () => Promise<Staged | undefined>;
  /**
   * A rebuild has started, and how many files provoked it.
   *
   * Called before the work rather than after, because the whole point of
   * saying so is to cover the seconds the work takes. Always paired with
   * `onSettled`, including when the rebuild throws or finds nothing.
   *
   * `history` says the branch itself moved — a merge committed, a rebase, a
   * checkout — which is worth saying differently: a count of files changed is
   * nonsense for a rebuild that no file provoked.
   */
  onRebuilding?: (files: number, history: boolean) => void;
  /** The rebuild is over, whatever came of it. */
  onSettled?: () => void;
  /** Called only when something a reader could see has actually moved. */
  onChange: (graph: ChangeGraph, delta: GraphDelta) => void | Promise<void>;
  /** Called when a rebuild throws, so the reader is not left guessing. */
  onError?: (error: unknown) => void;
  /**
   * Files that have actually changed, before anything is rebuilt.
   *
   * The watcher is the only thing in Odin that sees every change to this
   * checkout, whoever made it. A tool that narrates its work announces the
   * edits it makes; a tool that does not, announces nothing; a reader editing
   * by hand announces nothing either — and the ledger of what has happened to
   * this branch should not depend on which of those it was.
   *
   * Given the paths that survived the ignore rules, which is the same list the
   * rebuild is about to be run for.
   */
  onTouched?: (paths: string[]) => void | Promise<void>;
  /** How long after the last edit to wait before rebuilding. */
  settle?: number;
  /**
   * The longest the first edit in a burst may be made to wait.
   *
   * Without a ceiling the settling delay is a promise that can be broken
   * forever: every event resets it, and a repository with anything writing to
   * it in the background — a dev server, a formatter, the git worktrees some
   * projects keep inside the tree — never has a quiet six hundred milliseconds
   * to offer. The graph then stops updating and looks exactly like a watcher
   * that is not firing.
   */
  ceiling?: number;
  /**
   * The longest a single rebuild may run before it is given up on.
   *
   * Nothing else bounds it. A rebuild shells out to git several times and then
   * runs a resolver over a checkout, and any one of those can sit there: git
   * blocks on `.git/index.lock` while another command holds it — stashing,
   * rebasing, an editor's own git extension — and a resolver can be handed a
   * tree that changed underneath it. None of that throws; it simply never comes
   * back.
   *
   * What the reader sees then is the corner saying the graph is being rebuilt,
   * for ever, over a picture that is quietly out of date. A wait that has
   * plainly failed should say so and let go.
   */
  patience?: number;
  /**
   * Whether the branch's history is watched as well as its files.
   *
   * A live reading is a diff from the merge base, and the merge base moves
   * when `HEAD` does. Committing a merge moves it without writing one file of
   * the project, so a reading that heard only about files kept every file the
   * merge had brought in — `development`'s work, drawn as the branch's own —
   * until the reader reloaded by hand. With this on, a move of `HEAD` is a
   * reason to rebuild in its own right. Off by default, because only a reading
   * measured from a merge base has anything to learn from one.
   */
  history?: boolean;
  /**
   * How long history has to be quiet before a rebuild is worth doing.
   *
   * Longer than an edit's, because history moves in bursts: a pull is a fetch
   * and then a merge, and a rebase moves `HEAD` once per commit it replays. A
   * rebuild on each of those writes would be a full recompute per commit of
   * somebody's rebase, which a reader notices at once; waiting for the burst
   * to finish costs them well under a second.
   */
  historySettle?: number;
  /**
   * The longest a burst that moved history may be made to wait.
   *
   * The ordinary ceiling is there for repositories that are never quiet, and
   * history is not what keeps a repository busy — nothing moves `HEAD` in the
   * background. So a rebase gets longer to finish before the graph is rebuilt
   * underneath it, and the half-rebased picture that would come of rebuilding
   * midway is mostly not drawn at all.
   */
  historyCeiling?: number;
}

/**
 * Keeps a graph of the working tree in step with the working tree.
 *
 * Only meaningful for a local reading. The forge's copy of a change does not
 * move while you are looking at it; the files on your disk do, constantly, and
 * a picture of them that was true a minute ago is a picture of something else.
 *
 * ## Why the whole project is watched
 *
 * A reference is two files agreeing about a name. Renaming a function in a
 * file the diff never touched breaks — or makes — an arrow leaving a file the
 * diff does touch, and the diff itself does not change by one byte. Watching
 * only the files under review would miss every one of those, which is most of
 * what a resolver is for.
 *
 * That is also why there is no cheap way out. Hashing the patch and stopping
 * when it matches would skip precisely the case above, so the only honest gate
 * is to rebuild and compare the graphs. The rebuild is the expensive part, so
 * the settling delay is generous and no two rebuilds ever overlap: edits that
 * arrive while one is running fold into the next rather than starting a
 * second.
 */
export class LiveGraph implements vscode.Disposable {
  private readonly watchers: vscode.Disposable[] = [];
  private readonly settle: number;
  private readonly ceiling: number;
  private readonly patience: number;
  private readonly historySettle: number;
  private readonly historyCeiling: number;
  /**
   * The files whose writes mean this checkout's history moved.
   *
   * Absolute, because in a linked worktree none of them is under the
   * repository; and asked of git when the watching starts, and again after
   * every move, because checking out another branch changes which ref is the
   * one worth watching.
   */
  private history = new Set<string>();
  /** The same, as the editor's own watcher would name them from the root. */
  private historyWithin = new Set<string>();
  /** Watching the directories those files live in, which is all `fs.watch` can do reliably. */
  private historyWatchers: FSWatcher[] = [];
  /** History moved since the last rebuild began, whatever else did. */
  private moved = false;
  /**
   * Which rebuild is the current one.
   *
   * Given up on is not cancelled: the work carries on somewhere, holding a
   * checkout and a resolver, and it may still finish long afterwards. Its
   * answer is about a working tree two edits ago, so it is counted out rather
   * than drawn — otherwise abandoning a slow rebuild means the reader gets its
   * stale picture on top of the fresh one whenever it eventually lands.
   */
  private run = 0;
  /** When the burst now waiting to be judged began. */
  private since = 0;
  /** Paths seen since the last rebuild, waiting to be judged worth one. */
  private touched = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** A rebuild is in flight, so nothing else may start one. */
  private running = false;
  /** Something arrived mid-rebuild, so the answer is already out of date. */
  private again = false;
  /** The last graph shown, which is what a new one is judged against. */
  private previous: ChangeGraph | undefined;
  private disposed = false;
  /** What `check-ignore` has already answered, so it is asked once per path. */
  private readonly known = new Map<string, boolean>();

  constructor(private readonly options: LiveOptions) {
    // Short, because a rebuild provoked by an ordinary edit no longer costs
    // seconds: it reuses the arrows and the blobs and redraws the rows. The
    // delay is now only there to fold a save that writes several files into one
    // redraw, which is a moment's worth of waiting rather than a budget.
    this.settle = options.settle ?? 250;
    this.ceiling = options.ceiling ?? 1500;
    this.patience = options.patience ?? 90_000;
    this.historySettle = options.historySettle ?? 600;
    this.historyCeiling = options.historyCeiling ?? 4000;
    if (options.history) void this.watchHistory();

    for (const root of new Set([options.repo, ...(options.roots ?? [])])) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, "**/*"),
      );
      watcher.onDidCreate((uri) => this.touch(uri.fsPath));
      watcher.onDidChange((uri) => this.touch(uri.fsPath));
      watcher.onDidDelete((uri) => this.touch(uri.fsPath));
      this.watchers.push(watcher);
    }

    /*
     * The reader's own save, which needs no watcher at all.
     *
     * This is the case the whole feature exists for — someone editing a file
     * with the graph open beside it — and it was the case resting on the
     * shakiest foundation. A file watcher is the editor's view of the disk,
     * and it is subject to which folders are open, to `files.watcherExclude`,
     * and to the editor giving up on a directory it considers too large. None
     * of that applies here: a document saved in this window is something the
     * editor knows for certain and says so.
     *
     * So the watcher is now for everything the reader did *not* do — a branch
     * switched underneath them, a formatter, another tool — and this is for
     * what they did.
     */
    // Guarded, because everything above depends on getting through this
    // constructor. An editor that does not offer the event — an older host, a
    // stub — would otherwise take the watching down with it, and the failure
    // would look like the graph never updating rather than like a missing API.
    const saved = vscode.workspace.onDidSaveTextDocument;
    if (typeof saved === "function") {
      this.watchers.push(
        saved((document) => {
          if (document.uri.scheme === "file") this.touch(document.uri.fsPath);
        }),
      );
    }
  }

  /** The graph the next rebuild is compared against. */
  seed(graph: ChangeGraph): void {
    this.previous = graph;
  }

  private touch(path: string): void {
    if (this.disposed) return;
    // Before the noise rule, which would otherwise throw it away with the rest
    // of `.git`. The editor's own watcher does report these for a checkout
    // whose `.git` is a directory under the workspace; a worktree's are heard
    // by `watchHistory` instead.
    if (this.history.has(path)) return this.historyMoved();
    if (!path.startsWith(this.options.repo)) return;

    const relative = path.slice(this.options.repo.length + 1);
    if (this.historyWithin.has(relative)) return this.historyMoved();
    if (relative === "" || isNoise(relative)) return;

    this.touched.add(relative);
    this.arm();
  }

  /** History moved: the next rebuild has to happen even if no file did. */
  private historyMoved(): void {
    if (this.disposed) return;
    this.moved = true;
    this.arm();
  }

  /**
   * Sets the timer for the burst now arriving.
   *
   * Waited for, but not indefinitely: whatever else is writing to this
   * repository, the edit that arrived first gets looked at within the ceiling.
   * Otherwise a project with a watcher-visible background process in it never
   * rebuilds at all, and the reader has no way to tell that from a broken
   * watcher. A burst in which history moved waits longer on both counts, for
   * the reasons given where those two are declared.
   */
  private arm(): void {
    if (this.since === 0) this.since = Date.now();
    const settle = this.moved ? this.historySettle : this.settle;
    const ceiling = this.moved ? Math.max(this.ceiling, this.historyCeiling) : this.ceiling;
    const waited = Date.now() - this.since;
    const wait = Math.max(0, Math.min(settle, ceiling - waited));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.fire(), wait);
  }

  /**
   * Listens for this checkout's history moving, wherever git keeps it.
   *
   * With `fs.watch` on the directories rather than the editor's watcher,
   * because the editor's watcher is for the workspace and a linked worktree's
   * `HEAD` is not in it: it lives in the main repository's `.git/worktrees`,
   * which the reader very often does not have open at all. What the editor
   * cannot see it cannot report, and this was the case the reader was in.
   *
   * Directories rather than the files themselves, because git never writes
   * one of these in place. It writes `HEAD.lock` and renames it over `HEAD`,
   * and a watch on the old file is a watch on an inode that has just been
   * thrown away — it fires once and never again. Only the reflog is appended
   * to, and a watch on its directory hears that as well.
   *
   * Every failure here is swallowed. A directory that does not exist yet — no
   * reflog, a branch whose ref has only ever been packed — is simply not
   * watched, and the editor's watcher and the next edit are still there.
   */
  private async watchHistory(): Promise<void> {
    const files = await historyFiles({ cwd: this.options.repo });
    if (this.disposed) return;

    for (const watcher of this.historyWatchers.splice(0)) watcher.close();
    this.history = new Set(files);
    const root = `${this.options.repo}/`;
    this.historyWithin = new Set(
      files.filter((file) => file.startsWith(root)).map((file) => file.slice(root.length)),
    );

    for (const dir of new Set(files.map((file) => dirname(file)))) {
      try {
        const watcher = watch(dir, { persistent: false }, (_event, name) => {
          // No name is no way to tell `HEAD` from `index`, and `index` is
          // rewritten every time anything asks git for its status. Treating the
          // unknown as a move would rebuild on every one of those.
          if (!name) return;
          if (this.history.has(join(dir, name.toString()))) this.historyMoved();
        });
        watcher.on("error", () => watcher.close());
        this.historyWatchers.push(watcher);
      } catch {
        // Not there, or not watchable. See above.
      }
    }
  }

  /**
   * Decides whether the edits that have arrived are worth a rebuild, and if so
   * does one and reports what moved.
   */
  private async fire(): Promise<void> {
    this.timer = undefined;
    if (this.disposed) return;

    // Already working. The edits stay in the set and the run in flight is told
    // its answer is stale before it has finished producing it.
    if (this.running) {
      this.again = true;
      return;
    }

    const arrived = [...this.touched];
    this.touched.clear();
    this.since = 0;
    const moved = this.moved;
    this.moved = false;
    /*
     * A move of history is worth a rebuild by itself, whatever the files say.
     *
     * The case that has to work is the one where no file changed at all:
     * committing a merge leaves the working tree as it was, and what it changes
     * is the point the diff is measured from. The rebuild asks git for the
     * merge base afresh, as it always has; it simply was never being asked.
     *
     * And the watch is renewed, because the move may have been a checkout of
     * another branch, whose ref is now the one worth listening to.
     */
    if (moved) void this.watchHistory();
    const worth = await this.worthRebuilding(arrived);
    if (!worth && !moved) return;

    /*
     * What changed, told before the rebuild rather than after it.
     *
     * The rebuild may find nothing worth redrawing — most edits do not move an
     * arrow — and `onChange` is deliberately silent then. A change that moved
     * no arrow is still a change, and the record of what happened to this
     * branch is exactly the thing that must not be filtered by whether the
     * picture moved.
     */
    const interesting = arrived.filter((path) => this.known.get(path) === false);
    try {
      // Nothing to write down for a move of history alone: the ledger is of
      // files, and `HEAD` is not one of the project's.
      if (interesting.length > 0) await this.options.onTouched?.(interesting);
    } catch {
      // A ledger that cannot write itself down is not worth losing a rebuild
      // over: the picture is what the reader is waiting for.
    }

    this.running = true;
    const mine = ++this.run;
    /** Whether this rebuild is still the one the reader is waiting for. */
    const current = () => !this.disposed && this.run === mine;

    this.options.onRebuilding?.(arrived.length, moved);
    try {
      const staged = await this.bounded(this.options.rebuild());
      if (!current() || !staged) return;

      await this.report(staged.graph);
      if (!staged.rest) return;

      // The expensive half, delivered on its own. Held inside the same run so
      // that an edit arriving meanwhile folds into the next rebuild rather
      // than starting a second one on top of this — two resolvers over one
      // checkout is how a machine that was merely busy becomes one that has
      // stopped answering.
      const settled = await this.bounded(staged.rest());
      if (!current() || !settled) return;
      await this.report(settled);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      // Only the run that is still current hands the corner back. A rebuild
      // given up on has already had that done for it, and one that finishes
      // afterwards must not clear a wait that belongs to its successor.
      if (this.run === mine) {
        this.running = false;
        this.options.onSettled?.();
      }
      // Edits that landed while that was running have not been looked at.
      if (this.again && !this.disposed) {
        this.again = false;
        this.timer = setTimeout(
          () => void this.fire(),
          this.moved ? this.historySettle : this.settle,
        );
      }
    }
  }

  /**
   * Puts one answer on screen, if it says anything the last one did not.
   *
   * A rebuild that produced the same picture is not news. Redrawing here would
   * take the reader's place on the page away from them in exchange for nothing
   * at all — and with a build that answers twice, the second answer is very
   * often identical to the first, because most edits do not move an arrow.
   */
  private async report(graph: ChangeGraph): Promise<void> {
    const delta = graphDelta(this.previous, graph);
    this.previous = graph;
    if (unchanged(delta)) return;
    await this.options.onChange(graph, delta);
  }

  /**
   * A rebuild, or nothing if it took too long to be worth waiting for.
   *
   * Nothing is cancelled — there is no way to take back a git process or a
   * resolver mid-pass — so the work goes on and its answer is discarded when it
   * arrives. What is bought is the reader getting their page back, and the next
   * edit getting a rebuild rather than folding into one that will never end.
   */
  private async bounded<T>(work: Promise<T>): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const patience = new Promise<undefined>((give) => {
      timer = setTimeout(() => give(undefined), this.patience);
    });
    try {
      const answer = await Promise.race([work, patience]);
      if (answer === undefined) {
        // Counted out, so a late answer from this run is ignored, and reported,
        // because a graph that stopped updating with nothing said is the
        // failure this whole watcher is most often accused of.
        this.run += 1;
        this.running = false;
        this.options.onSettled?.();
        this.options.onError?.(
          new Error(`gave up rebuilding after ${Math.round(this.patience / 1000)}s`),
        );
      }
      return answer as T | undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Whether anything git would admit to caring about has been touched. */
  private async worthRebuilding(paths: readonly string[]): Promise<boolean> {
    if (paths.length === 0) return false;

    const unknown = paths.filter((p) => !this.known.has(p));
    if (unknown.length > 0) {
      const ignored = await ignoredBy(this.options.repo, unknown);
      for (const path of unknown) this.known.set(path, ignored.has(path));
    }
    return paths.some((path) => this.known.get(path) === false);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const watcher of this.watchers.splice(0)) watcher.dispose();
    for (const watcher of this.historyWatchers.splice(0)) watcher.close();
  }
}
