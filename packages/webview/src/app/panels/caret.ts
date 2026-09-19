/**
 * Where the list of names opens, given where the `@` that summoned it is.
 *
 * Split out of `Editor.svelte` for the reason `heading.ts` and `bars.ts` were:
 * the component can only measure, and measuring is the half that cannot be got
 * wrong quietly. What to do with the measurement — which edge to hang from,
 * how far it may go before it runs off the side — is plain arithmetic, and
 * arithmetic in a template is arithmetic nobody tests.
 *
 * The list opens under the `@`, not under the caret. The caret moves with every
 * letter of the name being typed, and a menu that slid sideways a character at
 * a time would be harder to read than one that stayed put; the `@` is where the
 * name begins and does not move while it is being written. It opens on the line
 * below the one the `@` is on, as measured with that line's wrapping, so a long
 * line that has run on to a second row puts the menu under the row the reader
 * is actually on rather than over the text they are writing.
 */

/** Where the `@` is inside the field, as the field lays it out. */
export interface Anchor {
  /** The top of the line the `@` is on, from the field's border edge. */
  top: number;
  /** The left of the `@`, from the field's border edge. */
  left: number;
}

/** The field the name is typed into, as it sits in the block the menu is in. */
export interface Field {
  offsetTop: number;
  offsetLeft: number;
  scrollTop: number;
  scrollLeft: number;
  /** How wide the field is inside its border. */
  clientWidth: number;
  /** One line of the field's text. */
  lineHeight: number;
}

/** The gap between the line being written and the top of the list. */
const BELOW = 4;

/**
 * The list's top-left corner, in the coordinates of the block the field sits
 * in.
 *
 * Kept inside the field sideways. An `@` near the right edge would otherwise
 * hang the list off the end of the editor, over whatever is beside it and cut
 * off by the panel's own edge — so it is moved back left by as much as it
 * would overrun, and no further than the field's own left edge. Never above
 * the field either, which a scrolled box would otherwise give.
 */
export function menuPlace(
  at: Anchor,
  field: Field,
  menuWidth: number,
): { top: number; left: number } {
  const top = field.offsetTop + at.top + field.lineHeight - field.scrollTop + BELOW;
  const wanted = field.offsetLeft + at.left - field.scrollLeft;
  const furthest = field.offsetLeft + field.clientWidth - menuWidth;
  return {
    top: Math.max(field.offsetTop, top),
    left: Math.max(field.offsetLeft, Math.min(wanted, furthest)),
  };
}
