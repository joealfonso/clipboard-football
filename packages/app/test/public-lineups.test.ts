// Code review R2 (calling screen pass U1, What it draws): a public lineup on the board (their punt,
// field goal, extra point, kneel or spike, your Kick rows on focus) is exactly where the play's
// timeline lines both units up, so the snap moves no mark. Checked on real plays of simulated games
// at the same layout (only the kickoff was checked before), and the extra point at the try's kick
// spot, not the two-point spot the state carries during a try.

import { beforeAll, describe, expect, it } from "vitest";
import type { DecisionRequest, PlayEvent } from "../src/engine/types";
import { Animator } from "../src/ui/animator";
import { layoutFor } from "../src/ui/layout";
import { openMenu } from "../src/ui/menu";
import { publicLineupFrame, type PublicCall } from "../src/ui/presnap";
import { at, timeline, type Timeline } from "../src/ui/timeline";
import { appHarness, FakeEl, installFakeDom, MOTION, TEMPLATES } from "./fake-dom";
import { prepared } from "./support";
import { simGames } from "./sim-games";

const px = 10;
const markPx = Math.max(TEMPLATES.field.markMinPx, TEMPLATES.field.markYards * px);
const rules = prepared().data.engine.rules;
const personnel = prepared().data.engine.personnel as unknown as { presetPackage: Record<string, string>; offense: Record<string, Record<string, number>>; packages: Record<string, Record<string, number>> };
/** The try's kick spot in the kicking team's frame (sim game/draft.ts: flip(rules.try.kickSpot)). */
const kickSpot = 100 - (rules as unknown as { try: { kickSpot: number } }).try.kickSpot;

const callOf = (e: PlayEvent): PublicCall | null => {
  const c = e.offense.call;
  if (e.play.kind === "noPlay") return null;
  return c === "punt" || c === "fieldGoal" || c === "extraPoint" || c === "kneel" || c === "spike" ? c : null;
};

beforeAll(() => installFakeDom(1280, 720));

describe("publicLineupFrame equals the timeline's first frame for the same play", () => {
  const found = new Map<PublicCall, PlayEvent>();
  for (const g of simGames(30)) for (const e of g.plays) {
    const c = callOf(e);
    if (c !== null && !found.has(c)) found.set(c, e);
  }

  it("the games reach every public call", () => {
    expect([...found.keys()].sort()).toEqual(["extraPoint", "fieldGoal", "kneel", "punt", "spike"].sort());
  });

  it.each(["punt", "fieldGoal", "extraPoint", "kneel", "spike"] as const)("%s", (call) => {
    const ev = found.get(call) as PlayEvent;
    const los = call === "extraPoint" ? kickSpot : ev.before.spot;
    const tl: Timeline = timeline({ event: ev, runoffSeconds: 0, human: "defense", ...(call === "extraPoint" ? { tryKickSpot: kickSpot } : {}) }, TEMPLATES, { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: px, markPx, motion: MOTION });
    expect(tl.los).toBe(los);
    const f = publicLineupFrame({ los, humanKicks: false, templates: TEMPLATES, pxPerYard: px, call, counts: { offense: personnel.offense["underCenter"] ?? {}, defense: personnel.packages["base"] ?? {} } });
    expect(f.marks.filter((m) => m.side === "O")).toHaveLength(11);
    expect(f.marks.filter((m) => m.side === "X")).toHaveLength(11);
    for (const m of f.marks) {
      const live = tl.marks.find((x) => x.side === m.side && x.slot === m.slot);
      expect(live, `${call} ${m.side} ${m.slot}`).toBeDefined();
      const a = at(m.keys, 0);
      const b = at(live?.keys ?? [], 0);
      expect(Math.hypot(a.x - b.x, a.y - b.y), `${call} ${m.side} ${m.slot}`).toBeLessThan(1e-6);
    }
  });
});

describe("the App lines their extra point up at the try's kick spot", () => {
  it("a theyLineUp extraPoint request previews both units at trySpots.kick", () => {
    let pick: { g: ReturnType<typeof simGames>[number]; req: DecisionRequest } | null = null;
    for (const g of simGames(30)) {
      const r = g.requests.find((x) => x.kind === "continue" && x.about.what === "theyLineUp" && x.about.call === "extraPoint");
      if (r !== undefined) {
        pick = { g, req: r };
        break;
      }
    }
    if (pick === null) throw new Error("no extra point line-up in 30 games");
    const { g, req } = pick;
    const h = appHarness({ matchup: g.matchup, human: g.human });
    const layout = layoutFor(1280, 720, TEMPLATES.field);
    const animator = new Animator(new FakeEl("canvas") as unknown as HTMLCanvasElement, () => layout, () => TEMPLATES, () => (h.app as unknown as { frameOpts(): never }).frameOpts());
    Object.assign(h.app, { animator, previewKey: "", previewFrame: null, layoutNow: layout });
    const st = req.state as NonNullable<DecisionRequest["state"]>;
    expect(st.phase).toBe("try");
    h.game["state"] = { ...st, trySpots: { kick: kickSpot, twoPoint: st.spot }, playCount: 1 };
    h.game["request"] = req;
    h.game["menu"] = openMenu(req);
    h.game["framePossession"] = st.possession;
    h.call("updatePreview");
    const f = h.app["previewFrame"] as Timeline;
    expect(st.spot).not.toBe(kickSpot);
    expect(f.los).toBe(kickSpot);
    expect(animator.shown()?.tl).toBe(f);
  });
});
