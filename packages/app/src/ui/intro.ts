// The matchup intro (DESIGN.md Moments, `moment.matchupIntro`): once per game, at its start. A
// face-off band 240 px tall across the window; the halves wipe in from their edges, the names slam
// in, the VS disc fades in, a hold, then each half shrinks into its name plate in the score bug
// while the rest of the bug fades in. Any key or click skips to the end at once (input never waits
// on it). Reduced motion: no intro. The timings are DESIGN's, mirrored in styles.css (--intro-*).

import { h } from "./dom";
import { faceoffHalf, type FaceoffTeam, type Side } from "./faceoff";

/** DESIGN.md Matchup intro, ms at 1x. */
export const INTRO = { wipeMs: 300, slamAt: 200, slamMs: 220, vsAt: 500, shrinkAt: 1900, shrinkMs: 400, totalMs: 2300, holdMs: 2400 } as const;

export interface PlateRects {
  readonly away: DOMRect | null;
  readonly home: DOMRect | null;
}

/**
 * The intro's overlay. `plates` reads the bug's name plates once laid out; each half gets the
 * translate and scale that lands it on its plate (DESIGN step 5). `done` runs once, at the end or
 * on a skip.
 */
export function matchupIntro(teams: Readonly<Record<Side, FaceoffTeam>>, you: Side, plates: () => PlateRects, done: () => void): { readonly el: HTMLElement; land(): void; skip(): void } {
  const slot = (side: Side): HTMLElement => h("div", { class: `intro-slot ${side}` }, faceoffHalf(side, teams[side], you === side));
  const away = slot("away");
  const home = slot("home");
  const band = h("div", { class: "faceoff intro-band" }, away, home, h("div", { class: "fo-vs", "aria-hidden": "true" }, "VS"));
  const el = h("div", { class: "intro", role: "img", "aria-label": `${teams.away.place} ${teams.away.nickname} at ${teams.home.place} ${teams.home.nickname}` }, band);
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    el.remove();
    done();
  };
  const timer = window.setTimeout(finish, INTRO.totalMs);
  return {
    el,
    /** Measures the halves and the plates and sets each half's landing (call once both are laid out). */
    land(): void {
      const r = plates();
      for (const [side, s] of [["away", away], ["home", home]] as const) {
        const to = r[side];
        const from = s.getBoundingClientRect();
        if (to === null || from.width === 0 || from.height === 0) continue;
        s.style.setProperty("--to-x", `${Math.round(to.left - from.left)}px`);
        s.style.setProperty("--to-y", `${Math.round(to.top - from.top)}px`);
        s.style.setProperty("--to-sx", String(to.width / from.width));
        s.style.setProperty("--to-sy", String(to.height / from.height));
      }
    },
    skip: finish,
  };
}
