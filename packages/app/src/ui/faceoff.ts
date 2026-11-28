// The face-off (DESIGN.md Prime Time: Pregame `pregame.faceoff`, Halftime and end of game
// `menu.scoreHero`, Moments `moment.matchupIntro`): the away and home halves in their team fills,
// the tale of the tape, and the line score. DOM builders, rebuilt from state like the rest of the
// panel; the numbers they show are given, never computed here (lineScore is moments.ts).

import { h, swatch } from "./dom";
import { darkTier } from "./tokens";

export type Side = "away" | "home";

/** One team as the face-off shows it: its colors and words (team.<id>.color, outline, name). */
export interface FaceoffTeam {
  readonly fill: string;
  /** The slot's outline color: every word on the half is in it. */
  readonly ring: string;
  readonly place: string;
  readonly nickname: string;
}

/**
 * The face-off band: away half left, home half right, meeting at a 12-degree seam, the VS disc on
 * the seam. `scores` (halftime, final) puts each score beside its nickname; `you` tags the human's
 * half. The band is `aria-label`led as one sentence so a screen reader hears the matchup once.
 */
export function faceoffBand(teams: Readonly<Record<Side, FaceoffTeam>>, o: { readonly you: Side | null; readonly scores?: Readonly<Record<Side, number>> }): HTMLElement {
  const sentence = o.scores === undefined ? `${teams.away.place} ${teams.away.nickname} at ${teams.home.place} ${teams.home.nickname}` : `${teams.away.nickname} ${o.scores.away}, ${teams.home.nickname} ${o.scores.home}`;
  const half = (side: Side): HTMLElement => faceoffHalf(side, teams[side], o.you === side, o.scores?.[side]);
  return h("div", { class: "faceoff", role: "img", "aria-label": sentence }, half("away"), half("home"), h("div", { class: "fo-vs", "aria-hidden": "true" }, "VS"));
}

/** One half of the face-off: "Away" or "Home" (with the You tag), the city, the nickname, and the score when given. */
export function faceoffHalf(side: Side, t: FaceoffTeam, you: boolean, score?: number): HTMLElement {
  const el = h(
    "div",
    { class: `fo-half ${side}${darkTier(t.fill) ? " dark" : ""}`, "aria-hidden": "true" },
    h("div", { class: "fo-words" }, h("span", { class: "fo-side" }, side === "away" ? "Away" : "Home", you ? h("span", { class: "you" }, "You") : null), h("span", { class: "fo-city" }, t.place), h("span", { class: "fo-name" }, t.nickname)),
    score === undefined ? null : h("span", { class: "fo-score", "data-to": String(score) }, String(score)),
  );
  el.style.setProperty("--team-fill", t.fill);
  el.style.color = t.ring;
  return el;
}

export interface TapeRow {
  readonly label: string;
  readonly away: number;
  readonly home: number;
}

/**
 * The tale of the tape: per unit, the away value far left and the home value far right (display
 * 700, the higher in chalk and the lower in chalkSoft, both chalk on a tie), with bars growing
 * outward from the center in each team's fill, `value / 100` of the space. Values always printed.
 */
export function taleOfTape(rows: readonly TapeRow[], fills: Readonly<Record<Side, string>>): HTMLElement {
  const tape = h("div", { class: "tape" });
  for (const r of rows) {
    const cls = (mine: number, theirs: number): string => (mine >= theirs ? "tape-val lead" : "tape-val");
    const barFor = (side: Side, v: number): HTMLElement => {
      const fill = h("span", { class: `tape-fill${darkTier(fills[side]) ? " dark" : ""}` });
      fill.style.background = fills[side];
      fill.style.width = `${Math.max(0, Math.min(100, v))}%`;
      return h("span", { class: `tape-bar ${side}`, "aria-hidden": "true" }, fill);
    };
    tape.append(
      h(
        "div",
        { class: "tape-row", role: "group", "aria-label": `${r.label}: away ${r.away}, home ${r.home}` },
        h("span", { class: cls(r.away, r.home) }, String(r.away)),
        barFor("away", r.away),
        h("span", { class: "tape-label" }, r.label),
        barFor("home", r.home),
        h("span", { class: `${cls(r.home, r.away)} home` }, String(r.home)),
      ),
    );
  }
  return tape;
}

/**
 * hud.lineScore under the score hero: team swatch and nickname, one column per period (OT when
 * played), then the total. Display 700 22 px tabular; quarters chalkSoft, totals chalk.
 */
export function lineScoreTable(o: { readonly heads: readonly string[]; readonly rows: Readonly<Record<Side, { readonly fill: string; readonly nickname: string; readonly byPeriod: readonly number[]; readonly total: number }>> }): HTMLElement {
  const row = (side: Side): HTMLElement => {
    const r = o.rows[side];
    return h("tr", {}, h("th", { scope: "row" }, swatch(r.fill), ` ${r.nickname}`), ...r.byPeriod.map((n) => h("td", { class: "ls-q" }, String(n))), h("td", { class: "ls-total" }, String(r.total)));
  };
  return h("table", { class: "line-score hero", "aria-label": "Score by quarter" }, h("tr", {}, h("th", {}, ""), ...o.heads.map((x) => h("th", { scope: "col" }, x)), h("th", { scope: "col" }, "T")), row("away"), row("home"));
}

/** The halftime and final scores count up from 0 over 600 ms, ease.out (DESIGN.md Halftime and end of game). */
export const COUNT_UP_MS = 600;
