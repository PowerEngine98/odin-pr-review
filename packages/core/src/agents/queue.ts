/**
 * Who takes the next message, and what waits.
 *
 * Pure, and separate from anything that spawns a process, because this is the
 * part with rules in it. Everything the reader described about how a team of
 * agents behaves is here: order is priority, a busy agent is passed over, a
 * named agent is not passed over, and nothing is dropped.
 */

/** A message from the reader, waiting for somebody to take it. */
export interface Ask {
  /** Stable, so a reply can be attached to the message that provoked it. */
  id: string;
  /** What was written, with any @name still in it. */
  body: string;
  /** When it landed. Ordering is by this and nothing else. */
  at: string;
  /**
   * The agent it was addressed to, if one was named.
   *
   * Held rather than re-derived, because who is installed can change between
   * the message being written and the message being taken — and an ask that
   * silently loses its addressee goes to the wrong agent rather than waiting.
   */
  addressee?: string;
  /**
   * The agent that already answered in this conversation, if one has.
   *
   * A follow-up belongs to whoever took the first message: it has the thread in
   * mind, it made whatever changes are on disk, and the reader writing "and the
   * edge case too" is talking to it rather than to the room. Handing that to a
   * different agent produces two of them working the same files from different
   * assumptions, which is the failure this whole ordering exists to avoid.
   */
  owner?: string;
}

/** What an agent is doing, as far as the queue is concerned. */
export type AgentState = "idle" | "working";

/**
 * The agent a message is addressed to, if any.
 *
 * Matched against the names actually switched on rather than against a pattern,
 * so `@later` in a sentence is a word and `@Claude` is an address only while
 * Claude is one of the agents that could answer. Case-insensitive: nobody
 * capitalises consistently in a comment, and refusing to match `@claude`
 * teaches an inconsistency rather than a rule.
 *
 * The first name mentioned wins. A message naming two agents is a message to
 * both in the reader's head and to nobody under any rule that has to pick one,
 * and going to the first is at least the one they wrote first.
 */
export function addressedTo(
  body: string,
  names: { id: string; name: string }[],
): string | undefined {
  /*
   * `@` followed by the name and nothing that continues it.
   *
   * A word boundary is not enough: `\b` sits happily between the `x` and the
   * `-` of `@codex-bot`, so a tool with a longer name would have every mention
   * of it taken as an address to a different tool. The character before matters
   * for the same reason in the other direction — `ada@claude.example` is an
   * email address, not a request.
   */
  let best: { at: number; id: string } | undefined;
  for (const who of names) {
    const pattern = new RegExp(`(^|[^\\w@])@${escape(who.name)}(?![\\w-])`, "i");
    const found = pattern.exec(body);
    if (!found) continue;
    const at = found.index;
    if (!best || at < best.at) best = { at, id: who.id };
  }
  return best?.id;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The agent that should take this message, or nobody.
 *
 * The named one when it was named, whatever its priority and however many
 * agents above it are free — being asked directly is the reader overriding the
 * order, and an address that got answered by somebody else would make naming an
 * agent pointless. It waits when busy rather than being handed off, for the
 * same reason.
 *
 * Otherwise the first switched-on agent that is idle, in the reader's order.
 * That is the whole of the priority rule: the top one takes the work unless it
 * already has some, and then the next one does.
 */
export function takerOf(
  ask: Ask,
  order: string[],
  state: Map<string, AgentState>,
): string | undefined {
  /*
   * Named beats owning, and owning beats free.
   *
   * Both of the first two wait when busy rather than being handed on. That is
   * the point of each: an address answered by somebody else makes naming an
   * agent meaningless, and a follow-up answered by somebody else means two
   * agents editing the same files with different pictures of what is going on.
   * Waiting is the correct outcome — the reader gets their answer a minute
   * later from the agent that has the context, rather than immediately from one
   * that does not.
   */
  const first = ask.addressee ?? ask.owner;
  if (first) {
    if (!order.includes(first)) {
      // Switched off since it claimed the thread. The conversation is not held
      // hostage to an agent that can no longer answer at all.
      return ask.addressee ? undefined : order.find((id) => state.get(id) !== "working");
    }
    return state.get(first) === "working" ? undefined : first;
  }
  return order.find((id) => state.get(id) !== "working");
}

/**
 * Who has claimed this conversation, which is whoever spoke in it first.
 *
 * First in, and it cannot be taken away: an agent that answered has already
 * started changing files, and a claim that could be overridden by a faster
 * second agent would be no claim at all. The reader can still override it by
 * naming somebody, which is the one authority above the agents themselves.
 */
export function ownerOf(
  said: { agent?: string; createdAt?: string }[],
): string | undefined {
  const spoken = said
    .filter((one): one is { agent: string; createdAt?: string } => !!one.agent)
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  return spoken[0]?.agent;
}

/**
 * As many of the waiting messages as there are free agents to take them.
 *
 * In landing order, and a message that nobody can take does not hold up the
 * ones behind it — an ask addressed to a busy agent would otherwise stop the
 * whole queue while three idle agents watched. It keeps its place; the ones
 * behind it are simply also considered.
 *
 * Handing back pairs rather than acting on them: what to do with an assignment
 * is the host's business, and a function that spawned processes could not be
 * tested against anything.
 */
export function assign(
  waiting: Ask[],
  order: string[],
  state: Map<string, AgentState>,
): { ask: Ask; agent: string }[] {
  const busy = new Map(state);
  const taken: { ask: Ask; agent: string }[] = [];

  for (const ask of [...waiting].sort((a, b) => a.at.localeCompare(b.at))) {
    const agent = takerOf(ask, order, busy);
    if (!agent) continue;
    busy.set(agent, "working");
    taken.push({ ask, agent });
  }
  return taken;
}
