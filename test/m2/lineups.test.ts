// The human side's own lineups on call requests (docs/specs/m2-play-calling-and-motion.md, Need 1
// and P2; a shared type change Joseph approved): every offenseCall, try and defenseCall request
// carries, for each formation or package on offer, exactly the players resolvePlay puts on the
// field at the snap, and only the human team's players. Formation-first screens: a run or pass is
// formation > formation id > run|pass > play.

import { describe, expect, it } from "vitest";
import type { GameEvent } from "../../packages/sim/src/loop/play";
import { offenseAnswer } from "../../packages/sim/src/loop/requests";
import { sessionRecord } from "../../packages/sim/src/loop/session";
import { kit, playSession, scriptedBot, setupFor } from "./support";

describe("lineups on call requests", () => {
  const games = [3, 8, 13].map((seed) => {
    const setup = setupFor(seed);
    const human = seed % 2 === 0 ? ("home" as const) : ("away" as const);
    const played = playSession(setup, kit, human, scriptedBot(seed, { two: 0.3 }));
    return { setup, human, played, record: sessionRecord(played.session, setup, kit) };
  });

  it("every call request carries a lineup for every formation or package, from the human's pool only", () => {
    let n = 0;
    for (const g of games) {
      const own = new Set(g.setup[g.human].pool.players.map((p) => p.id));
      for (const a of g.played.asked) {
        const r = a.request;
        if (r.kind !== "offenseCall" && r.kind !== "try" && r.kind !== "defenseCall") continue;
        const groups = r.kind === "defenseCall" ? kit.data.engine.personnel.packages : kit.data.engine.personnel.offense;
        expect(Object.keys(r.lineups ?? {}).sort()).toEqual(Object.keys(groups).sort());
        for (const side of Object.values(r.lineups ?? {})) for (const ids of Object.values(side)) for (const id of ids ?? []) expect(own.has(id), id).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it("the lineup for the call made is the engine's onField at the snap", () => {
    let checked = 0;
    for (const g of games) {
      const plays = g.record.events.filter((e): e is Extract<GameEvent, { t: "play" }> => e.t === "play");
      for (const a of g.played.asked) {
        const r = a.request;
        if (r.kind !== "offenseCall" && r.kind !== "try" && r.kind !== "defenseCall") continue;
        // The snap this request led to: the first play whose state matches the request's.
        const ev = plays.find((e) => e.before.period === r.state?.period && e.before.clock <= (r.state?.clock ?? -1) && e.before.spot === r.state?.spot && e.before.possession === r.state?.possession);
        if (ev === undefined || ev.play.kind === "noPlay") continue;
        const detail = ev.play.detail as { onField?: { offense: Record<string, string[]>; defense: Record<string, string[]> } };
        if (r.kind === "defenseCall") {
          if (ev.defense === null) continue;
          const pkg = kit.data.engine.personnel.presetPackage[ev.defense] as string;
          expect(detail.onField?.defense).toEqual(r.lineups?.[pkg]);
        } else {
          const f = ev.offense.formation;
          if (f === undefined) continue;
          expect(detail.onField?.offense).toEqual(r.lineups?.[f]);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("formation-first answer paths", () => {
  it("assemble the same call the old run-or-pass-first paths did", () => {
    expect(offenseAnswer(["formation", "shotgun", "pass", "deepPass"], null)).toEqual({ call: { call: "deepPass", formation: "shotgun" } });
    expect(offenseAnswer(["formation", "heavy", "run", "qbSneak"], null)).toEqual({ call: { call: "qbSneak", formation: "heavy" } });
    expect(offenseAnswer(["goForTwo", "formation", "empty", "pass", "shortPass"], null)).toEqual({ call: { call: "goForTwo", twoPointPlay: "shortPass", formation: "empty" } });
    expect(offenseAnswer(["kick", "punt"], null)).toEqual({ call: { call: "punt" } });
  });
});
