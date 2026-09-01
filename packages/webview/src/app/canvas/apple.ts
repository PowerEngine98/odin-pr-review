/**
 * Whether this is a machine whose pointing device already zooms.
 *
 * Asked of the platform rather than of the event, because there is no honest
 * way to ask the event: a trackpad and a wheel arrive as the same kind of
 * message, and the folklore for telling them apart — fractional deltas,
 * multiples of a hundred and twenty — is wrong often enough to be worse than
 * choosing by platform, where it is right nearly always.
 *
 * On a Mac the gesture is almost always a trackpad, which has both already: two
 * fingers pan and a pinch zooms. Everywhere else it is almost always a mouse,
 * which has one wheel and no pinch — and on a drawing, or on a picture being
 * looked at closely, scrolling down means nothing and nearer means everything.
 *
 * Answered once. The hardware does not change under a window, and a page
 * rendered where there is no navigator at all is a page nobody is scrolling.
 */
let apple: boolean | undefined;

export function onApple(): boolean {
  if (apple === undefined) {
    const said =
      typeof navigator === "undefined"
        ? ""
        : `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
    apple = /Mac|iPad|iPhone|iPod/.test(said);
  }
  return apple;
}

/** Whether a plain wheel — no modifier — should zoom rather than pan. */
export function wheelZooms(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  if (event.ctrlKey || event.metaKey) return true;
  return !onApple();
}
