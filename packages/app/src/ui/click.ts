// Click to pick (Joseph: "don't require pressing enter to pick an option. a simple click should
// work"). A press and a release on the same row of the same screen pick that row, the same path as
// its number key or Enter, so an off row only gives its reason.
//
// The match is by row key and screen, not by element. The panel can be rebuilt between the press
// and the release (hovering a play card redrew the whole panel, and a worker reply re-renders it),
// and a browser fires no click when the pressed button is gone, so a click on a card only
// highlighted it. Pointer up does the pick. A click event picks only when no pointer made it
// (Space on a focused row, assistive tech): on touch the click comes in a later task, after the
// pick has drawn the next screen, and would pick a second row under the finger.

/** The primary button (left mouse, a touch, a pen tip). */
const PRIMARY = 0;

export class ClickPicker<S> {
  private pressed: { readonly key: string; readonly screen: S } | null = null;

  /** Pointer down on the row with this key (null off any row, or with a modifier held) on this screen. */
  down(key: string | null, screen: S, button: number): void {
    this.pressed = key === null || button !== PRIMARY ? null : { key, screen };
  }

  /** Pointer up over the row with this key (null off any row) on this screen: the key to pick, or null. */
  up(key: string | null, screen: S, button: number): string | null {
    const p = this.pressed;
    this.pressed = null;
    if (p === null || button !== PRIMARY || key === null || key !== p.key || screen !== p.screen) return null;
    return key;
  }

  /** The pointer was taken away (scroll, a system gesture): nothing picks. */
  cancel(): void {
    this.pressed = null;
  }
}

/**
 * Whether a click event on a row picks: only when no pointer made it (`detail` 0: Space on a
 * focused row, assistive tech). Mouse, touch and pen clicks were already picked on pointer up.
 */
export function clickPicks(detail: number): boolean {
  return detail === 0;
}
