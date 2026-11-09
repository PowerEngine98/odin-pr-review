import { model, notify, settings } from "../state.svelte.js";
import { attachFrame, startTour } from "./player.svelte.js";
import { tour } from "./state.svelte.js";

/**
 * Asking for the Tour tab from somewhere that is not the agent's console.
 *
 * The agent whose console should turn to it, and cleared by that console once
 * it has: the console may not exist yet when it is asked for, and one that
 * mounts a beat later still has to find the request waiting.
 */
export const tourPanel = $state({
  wanted: null as string | null,
  /** The console that should open its log on an attached frame, cleared once it has. */
  discussing: null as string | null,
});

/**
 * Argue with what the tour just said: the frame paused and attached to an
 * agent's composer, its log opened, the tour left running underneath.
 */
export function discussFrame(): void {
  if (!attachFrame()) return;
  const agents = model.current.agents ?? [];
  const open = settings.terminals ?? [];
  const target = open.find((id) => agents.some((agent) => agent.id === id)) ?? agents[0]?.id;
  if (!target) return;
  if (!open.includes(target)) settings.terminals = [target, ...open];
  settings.terminalsFolded = (settings.terminalsFolded ?? []).filter((id) => id !== target);
  tourPanel.discussing = target;
}

/**
 * The bar's "Give me a tour": play it if there is one, otherwise open the place
 * where one is made.
 *
 * The Tour tab lives in an agent's console, so the first agent's console is
 * opened and unfolded if none is. With no agent to show it in, the host is
 * asked to make one directly, and the button says how that is going.
 */
export function openTour(): void {
  if (tour.status === "ready" && tour.data) {
    startTour();
    return;
  }
  const agents = model.current.agents ?? [];
  const open = settings.terminals ?? [];
  const showing = open.find((id) => agents.some((agent) => agent.id === id));
  const target = showing ?? agents[0]?.id;
  if (!target || model.current.meta.worktree !== true) {
    if (tour.status !== "making") notify("tourMake", {});
    return;
  }
  if (!showing) settings.terminals = [target, ...open];
  settings.terminalsFolded = (settings.terminalsFolded ?? []).filter((id) => id !== target);
  tourPanel.wanted = target;
}
