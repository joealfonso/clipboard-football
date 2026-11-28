// Play-art cards (docs/specs/m2-play-calling-and-motion.md, "Play calling with cards"): the same
// menu rows drawn as cards on the Formation, Run, Pass, Package and defense play screens. The art is
// inline SVG markup from playArt (crisp at any pixel ratio, aria-hidden); every fact on it is also in
// the label, the personnel line or the catalog description. No ball, no target, no result (K3).

import { defenseArt, offenseArt, slotsFromCounts, type Art } from "./art";
import { FIELD_WIDTH, type Pt } from "./motion";
import type { Templates } from "./templates";
import { COLOR } from "./tokens";

/** Screens that draw their rows as cards. */
export function cardScreen(screen: string): "formation" | "play" | "package" | "coverage" | null {
  if (screen === "offense.formation") return "formation";
  if (screen === "offense.run" || screen === "offense.pass") return "play";
  if (screen === "defense.package") return "package";
  if (screen === "defense.base" || screen === "defense.nickel" || screen === "defense.dime" || screen === "defense.specials") return "coverage";
  return null;
}

export type Counts = Readonly<Partial<Record<string, number>>>;

/** "1 RB, 3 WR, 1 TE" or "4 DL, 2 LB, 5 DB", from personnel.json. */
export function personnelLine(counts: Counts, side: "offense" | "defense"): string {
  if (side === "offense") return (["RB", "WR", "TE"] as const).map((p) => `${counts[p] ?? 0} ${p}`).join(", ");
  const db = (counts["CB"] ?? 0) + (counts["S"] ?? 0);
  return `${counts["DL"] ?? 0} DL, ${counts["LB"] ?? 0} LB, ${db} DB`;
}

const LOS = 50;

/** The art for one card: an offense formation (play null) or play, or a defense package (preset null) or preset. */
export function cardArt(kind: "formation" | "play" | "package" | "coverage", unit: string, call: string | null, counts: Counts, templates: Templates): Art {
  const slots = slotsFromCounts(counts);
  return kind === "formation" || kind === "play" ? offenseArt(unit, call, slots, templates, LOS) : defenseArt(unit, call, slots, templates, LOS);
}

/**
 * SVG markup for card art, 4:3, up is upfield. Offense shows 12 yards behind the line to 26 past
 * it, defense 8 behind to 30 past. Marks are 8 px with a 1.5 px stroke and no numbers.
 */
export function cardSvg(art: Art, side: "offense" | "defense", w = 160, h = 120): string {
  const behind = side === "offense" ? 12 : 8;
  const ahead = side === "offense" ? 26 : 30;
  const sx = w / FIELD_WIDTH;
  const sy = h / (behind + ahead);
  const X = (x: number): number => Math.round(x * sx * 10) / 10;
  const Y = (y: number): number => Math.round((LOS + ahead - y) * sy * 10) / 10;
  const pts = (p: readonly Pt[]): string => p.map((q) => `${X(q.x)},${Y(q.y)}`).join(" ");
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">`];
  out.push(`<rect width="${w}" height="${h}" fill="${COLOR.paper}"/>`);
  for (const b of art.bands) out.push(`<rect class="band" x="0" y="${Y(b.y1)}" width="${w}" height="${Math.max(1, Y(b.y0) - Y(b.y1))}" fill="${COLOR.paperShade}"/>`);
  for (const z of art.zones)
    out.push(`<rect class="zone" x="${X(Math.min(z.x0, z.x1))}" y="${Y(Math.max(z.y0, z.y1))}" width="${Math.abs(X(z.x1) - X(z.x0))}" height="${Math.abs(Y(z.y0) - Y(z.y1))}" fill="${COLOR.paperShade}" stroke="${COLOR.inkSoft}" stroke-width="1.5" stroke-dasharray="3 2"/>`);
  out.push(`<line x1="0" y1="${Y(LOS)}" x2="${w}" y2="${Y(LOS)}" stroke="${COLOR.ink}" stroke-width="1"/>`);
  for (const p of art.paths) {
    // DESIGN.md Play cards: ink for both sides; the O and X and the dashes carry the side.
    const color = COLOR.ink;
    const dash = p.side === "X" || p.kind === "fake" ? ` stroke-dasharray="3 2"` : "";
    out.push(`<polyline class="path ${p.kind}" points="${pts(p.points)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"${dash}/>`);
    const a = p.points[p.points.length - 2];
    const b = p.points[p.points.length - 1];
    if (a === undefined || b === undefined) continue;
    const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x));
    if (p.end === "arrow") {
      const l = 5;
      out.push(`<polyline class="arrow" points="${X(b.x) - l * Math.cos(ang - 0.5)},${Y(b.y) - l * Math.sin(ang - 0.5)} ${X(b.x)},${Y(b.y)} ${X(b.x) - l * Math.cos(ang + 0.5)},${Y(b.y) - l * Math.sin(ang + 0.5)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else if (p.end === "block") {
      const n = ang + Math.PI / 2;
      out.push(`<line class="block" x1="${X(b.x) - 3 * Math.cos(n)}" y1="${Y(b.y) - 3 * Math.sin(n)}" x2="${X(b.x) + 3 * Math.cos(n)}" y2="${Y(b.y) + 3 * Math.sin(n)}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`);
    }
  }
  for (const t of art.tethers) {
    out.push(`<line class="tether" x1="${X(t.from.x)}" y1="${Y(t.from.y)}" x2="${X(t.to.x)}" y2="${Y(t.to.y)}" stroke="${COLOR.ink}" stroke-width="1.5" stroke-linecap="round"/>`);
    out.push(`<circle class="generic" cx="${X(t.to.x)}" cy="${Y(t.to.y)}" r="2.5" fill="none" stroke="${COLOR.ink}" stroke-width="1"/>`);
  }
  for (const m of art.marks) {
    const cx = X(m.x);
    const cy = Y(m.y);
    if (m.side === "O") out.push(`<circle class="mark O" cx="${cx}" cy="${cy}" r="3.25" fill="${COLOR.ink}" stroke="${COLOR.ink}" stroke-width="1.5"/>`);
    else out.push(`<path class="mark X" d="M${cx - 3},${cy - 3}L${cx + 3},${cy + 3}M${cx + 3},${cy - 3}L${cx - 3},${cy + 3}" stroke="${COLOR.ink}" stroke-width="1.75" stroke-linecap="round"/>`);
  }
  out.push("</svg>");
  return out.join("");
}
