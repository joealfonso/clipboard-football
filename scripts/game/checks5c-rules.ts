// M1 step 5c: the 17 pre-registered checks (data/game/step5c-checks.json) under their pass rules,
// from the count files of both sides (scripts/game/checks5c.ts, pipeline/game/checks5c.py). No
// imports, so the report renderer can use it.

export interface OtSoakCounts {
  readonly games: number;
  readonly noRecord: number;
  readonly ties: number;
}

export interface CheckRow {
  readonly id: string;
  readonly unit: "pp" | "perGame" | "count";
  readonly sim: number;
  readonly real: number | null;
  readonly n: string;
  readonly rule: string;
  readonly pass: boolean;
}

/** The 17 checks under their pre-registered pass rules (data/game/step5c-checks.json). */
export function evaluate(sim: { readonly counts: Readonly<Record<string, number>>; readonly ot: OtSoakCounts | null }, real: Readonly<Record<string, number>>): CheckRow[] {
  const s = sim.counts;
  const g = (c: Readonly<Record<string, number>>, k: string): number => c[k] ?? 0;
  const per = (c: Readonly<Record<string, number>>, k: string): number => g(c, k) / Math.max(1, g(c, "games"));
  const share = (c: Readonly<Record<string, number>>, k: string, d: string): number => (100 * g(c, k)) / Math.max(1, g(c, d));
  const rows: CheckRow[] = [];
  const ot = sim.ot;
  rows.push({ id: "c.ot.complete", unit: "count", sim: ot === null ? NaN : ot.noRecord + ot.ties, real: null, n: ot === null ? "not run" : `${ot.games} games: ${ot.noRecord} without a record, ${ot.ties} tied`, rule: "both 0", pass: ot !== null && ot.noRecord === 0 && ot.ties === 0 });
  const absRule = (id: string, unit: "pp" | "perGame", sv: number, rv: number, tol: number, n: string): void => {
    rows.push({ id, unit, sim: sv, real: rv, n, rule: `abs(sim - real) <= ${tol}${unit === "pp" ? " pp" : ""}`, pass: Math.abs(sv - rv) <= tol + 1e-9 });
  };
  const nS = (k: string): string => `${g(s, k)} / ${g(real, k)}`;
  absRule("c.trail.lastSnap", "pp", share(s, "trail.lastSnap", "games"), share(real, "trail.lastSnap", "games"), 0.6, nS("games"));
  absRule("c.trail.longGap", "pp", share(s, "trail.longGap.hits", "trail.longGap.gaps"), share(real, "trail.longGap.hits", "trail.longGap.gaps"), 3, nS("trail.longGap.gaps"));
  absRule("c.spike.stopped", "perGame", per(s, "spike.stopped"), per(real, "spike.stopped"), 0.02, nS("spike.stopped"));
  absRule("c.kneel.ballBack", "pp", share(s, "kneel.ballBack", "kneel.games"), share(real, "kneel.ballBack", "kneel.games"), 2, nS("kneel.games"));
  absRule("c.kneel.shortGap0TO", "pp", share(s, "kneel.shortGap0TO.hits", "kneel.shortGap0TO.gaps"), share(real, "kneel.shortGap0TO.hits", "kneel.shortGap0TO.gaps"), 3, nS("kneel.shortGap0TO.gaps"));
  {
    const sv = per(s, "kneel.early");
    const rv = per(real, "kneel.early");
    rows.push({ id: "c.kneel.early", unit: "perGame", sim: sv, real: rv, n: nS("kneel.early"), rule: "sim <= real + 0.001", pass: sv <= rv + 0.001 + 1e-12 });
  }
  absRule("c.fg.60", "perGame", per(s, "fg.60"), per(real, "fg.60"), 0.015, nS("fg.60"));
  absRule("c.fg.63", "perGame", per(s, "fg.63"), per(real, "fg.63"), 0.008, nS("fg.63"));
  {
    const sv = per(s, "fg.70");
    rows.push({ id: "c.fg.70", unit: "perGame", sim: sv, real: per(real, "fg.70"), n: nS("fg.70"), rule: "sim <= 0.002", pass: sv <= 0.002 + 1e-12 });
  }
  absRule("c.fg.50to59", "perGame", per(s, "fg.50to59"), per(real, "fg.50to59"), 0.05, nS("fg.50to59"));
  for (const [id, k, d, tol] of [["c.try.down2GF", "try.down2GF.two", "try.down2GF.tries", 15], ["c.try.tiedG5", "try.tiedG5.kick", "try.tiedG5.tries", 10]] as const) {
    const sv = share(s, k, d);
    const rv = share(real, k, d);
    rows.push({ id, unit: "pp", sim: sv, real: rv, n: `${g(s, k)}/${g(s, d)} vs ${g(real, k)}/${g(real, d)}`, rule: `sim >= real - ${tol} pp`, pass: sv >= rv - tol - 1e-9 });
  }
  absRule("c.to.kickoffQ13", "perGame", per(s, "to.kickoffQ13"), per(real, "to.kickoffQ13"), 0.02, nS("to.kickoffQ13"));
  absRule("c.to.tryQ13", "perGame", per(s, "to.tryQ13"), per(real, "to.tryQ13"), 0.02, nS("to.tryQ13"));
  absRule("c.to.kickoffAll", "perGame", per(s, "to.kickoffAll"), per(real, "to.kickoffAll"), 0.03, nS("to.kickoffAll"));
  absRule("c.rough.scramble", "perGame", per(s, "rough.scramble"), per(real, "rough.scramble"), 0.005, nS("rough.scramble"));
  return rows;
}
