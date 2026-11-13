// M1 step 5d: the pre-registered checks (data/game/step5d-checks.json) under their pass rules,
// from the count files of both sides (scripts/game/checks5d.ts, pipeline/game/checks5d.py). No
// imports, so the report renderer can use it. `d.kneel.thenPlay.lead9` is reported only (the
// lead's Resolved 1).

export interface Check5dRow {
  readonly id: string;
  readonly unit: "pp" | "perGame" | "count";
  readonly sim: number;
  readonly real: number | null;
  readonly n: string;
  readonly rule: string;
  readonly gated: boolean;
  readonly pass: boolean;
}

export interface Sim5dCounts {
  readonly counts: Readonly<Record<string, number>>;
  readonly ot: { readonly games: number; readonly tries: number; readonly two: number } | null;
}

export function evaluate5d(sim: Sim5dCounts, real: Readonly<Record<string, number>>): Check5dRow[] {
  const s = sim.counts;
  const g = (c: Readonly<Record<string, number>>, k: string): number => c[k] ?? 0;
  const per = (c: Readonly<Record<string, number>>, k: string): number => g(c, k) / Math.max(1, g(c, "games"));
  const share = (c: Readonly<Record<string, number>>, k: string, d: string): number => (100 * g(c, k)) / Math.max(1, g(c, d));
  const rows: Check5dRow[] = [];
  const nS = (k: string): string => `${g(s, k)} / ${g(real, k)}`;
  const abs = (id: string, unit: "pp" | "perGame", sv: number, rv: number, tol: number, n: string, gated = true): void => {
    rows.push({ id, unit, sim: sv, real: rv, n, rule: gated ? `abs(sim - real) <= ${tol}${unit === "pp" ? " pp" : ""}` : `reported only (Resolved 1; table rule abs(sim - real) <= ${tol})`, gated, pass: Math.abs(sv - rv) <= tol + 1e-9 });
  };
  abs("d.spike.trail0TO", "perGame", per(s, "spike.trail0TO"), per(real, "spike.trail0TO"), 0.015, nS("spike.trail0TO"));
  abs("d.spike.running0TO", "pp", share(s, "spike.running0TO.spikes", "spike.running0TO.snaps"), share(real, "spike.running0TO.spikes", "spike.running0TO.snaps"), 6,
    `${g(s, "spike.running0TO.spikes")}/${g(s, "spike.running0TO.snaps")} vs ${g(real, "spike.running0TO.spikes")}/${g(real, "spike.running0TO.snaps")}`);
  {
    const sv = share(s, "spike.stopped0TO.spikes", "spike.stopped0TO.snaps");
    const rv = share(real, "spike.stopped0TO.spikes", "spike.stopped0TO.snaps");
    rows.push({ id: "d.spike.stopped0TO", unit: "pp", sim: sv, real: rv, n: `${g(s, "spike.stopped0TO.spikes")}/${g(s, "spike.stopped0TO.snaps")} vs ${g(real, "spike.stopped0TO.spikes")}/${g(real, "spike.stopped0TO.snaps")}`, rule: "sim <= real + 1 pp", gated: true, pass: sv <= rv + 1 + 1e-9 });
  }
  abs("d.gap.trail0TO", "pp", share(s, "gap.trail0TO.hits", "gap.trail0TO.gaps"), share(real, "gap.trail0TO.hits", "gap.trail0TO.gaps"), 4,
    `${g(s, "gap.trail0TO.hits")}/${g(s, "gap.trail0TO.gaps")} vs ${g(real, "gap.trail0TO.hits")}/${g(real, "gap.trail0TO.gaps")}`);
  abs("d.kneel.notLeading", "perGame", per(s, "kneel.notLeading"), per(real, "kneel.notLeading"), 0.005, nS("kneel.notLeading"));
  abs("d.kneel.thenPlay.lead1to8", "perGame", per(s, "kneel.thenPlay.lead1to8"), per(real, "kneel.thenPlay.lead1to8"), 0.004, nS("kneel.thenPlay.lead1to8"));
  abs("d.kneel.thenPlay.lead9", "perGame", per(s, "kneel.thenPlay.lead9"), per(real, "kneel.thenPlay.lead9"), 0.004, nS("kneel.thenPlay.lead9"), false);
  {
    const sv = per(s, "kneel.thenPlay.notLeading");
    const rv = per(real, "kneel.thenPlay.notLeading");
    rows.push({ id: "d.kneel.thenPlay.notLeading", unit: "perGame", sim: sv, real: rv, n: nS("kneel.thenPlay.notLeading"), rule: "sim <= real + 0.002", gated: true, pass: sv <= rv + 0.002 + 1e-12 });
  }
  abs("d.kneel.4thLate", "perGame", per(s, "kneel.4thLate"), per(real, "kneel.4thLate"), 0.004, nS("kneel.4thLate"));
  {
    const ot = sim.ot;
    const tries = g(s, "try.otDown2.tries") + (ot?.tries ?? 0);
    const two = g(s, "try.otDown2.two") + (ot?.two ?? 0);
    rows.push({
      id: "d.try.otDown2",
      unit: "count",
      sim: tries - two,
      real: g(real, "try.otDown2.tries") - g(real, "try.otDown2.two"),
      n: `sim ${two}/${tries} two-point (in-sample ${g(s, "try.otDown2.two")}/${g(s, "try.otDown2.tries")}, postseason soak ${ot === null ? "not run" : `${ot.two}/${ot.tries}`}); real ${g(real, "try.otDown2.two")}/${g(real, "try.otDown2.tries")}`,
      rule: "every such sim try is a two-point try (kicks shown)",
      gated: true,
      pass: ot !== null && tries === two,
    });
  }
  return rows;
}
