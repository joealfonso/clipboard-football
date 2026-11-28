// Engineer's sanity check for the kickoff return pass (code review FLAG 1, KR7): the return unit's
// hang setup comes from the lineup alone. Naming a return-team fouler, or a return-team fumble
// recoverer, changes nothing any mark does before the catch: the same keys up to the catch, and
// the named man moves in the hang like everyone else. The KR7 variants proper are test-writer's.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayResult } from "@clipboard-football/shared";
import type { PlayEvent } from "../src/engine/types";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { at, timeline, type Timeline } from "../src/ui/timeline";
import { KICKOFF_RETURN } from "./fixtures";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));
const templates = parseTemplates(read("data/ui/templates.json"));
const motion = parseMotion(read("data/ui/motion.json"));
const tlOf = (ev: PlayEvent): Timeline => timeline({ event: ev, runoffSeconds: 0 }, templates, { presetPackage: {}, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion });

type Kick = Extract<PlayResult, { kind: "kickoff" }>;
const base = KICKOFF_RETURN.play as Kick;
const detail = base.detail as Record<string, unknown>;
const parts = detail["participants"] as Record<string, unknown>;
const withParts = (extra: Record<string, unknown>, play: Partial<Kick> = {}): PlayEvent => ({ ...KICKOFF_RETURN, play: { ...base, ...play, detail: { ...detail, participants: { ...parts, ...extra } } } as PlayResult });

/** Every mark's position on every key from 0 to the catch. */
function toCatch(tl: Timeline): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tl.marks) {
    const pts: string[] = [];
    for (let t = 0; t <= tl.read + 1e-6; t += 25) {
      const p = at(m.keys, t);
      pts.push(`${p.x.toFixed(6)},${p.y.toFixed(6)}`);
    }
    out[`${m.side}${m.slot}`] = pts.join(" ");
  }
  return out;
}

describe("kickoff return: the hang setup comes from the lineup alone (KR7)", () => {
  const plain = tlOf(KICKOFF_RETURN);

  it("a return-team fouler: every mark identical to the catch, and he moves in the hang", () => {
    const fouled = tlOf(withParts({ foulers: ["A-LB2"] }));
    expect(toCatch(fouled)).toEqual(toCatch(plain));
    const m = fouled.marks.find((x) => x.playerId === "A-LB2");
    expect(m).toBeDefined();
    const a = at(m?.keys ?? [], fouled.snapAt);
    const b = at(m?.keys ?? [], fouled.read);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(motion.kickReturn.setupYards - 1e-6);
  });

  it("a return-team fumble recoverer: every mark identical to the catch", () => {
    const fumble = tlOf(withParts({ fumbleRecoverer: "A-LB3" }, { turnover: "fumble", end: { spot: 72, possession: "defense" } } as Partial<Kick>));
    expect(toCatch(fumble)).toEqual(toCatch(plain));
  });
});
