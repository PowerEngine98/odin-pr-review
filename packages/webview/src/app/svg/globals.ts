/**
 * The one browser global the application reaches for before it is asked to
 * render anything.
 *
 * `state.svelte.ts` seeds its model from `window.__ODIN__` at module scope, so
 * loading the application outside a browser threw `window is not defined`
 * before a single component had been constructed — not while rendering, where
 * a guard would have caught it, but while the module graph was still being
 * evaluated. Nothing on this side can catch that, and no `ssr` flag can be
 * consulted early enough to prevent it.
 *
 * So the server entry declares the global it is about to be read from, and
 * declares it first: a module's imports are evaluated before its body, which is
 * why this is a file rather than a line at the top of `ssr.ts`.
 *
 * Deliberately empty. It is not a pretend browser and must not become one — the
 * real model arrives as a prop, which is what lets both halves draw the same
 * thing. An object with methods on it would let a component that reaches for a
 * document on this side fail quietly instead of loudly.
 */
const globals = globalThis as unknown as { window?: unknown };
globals.window ??= {};

export {};
