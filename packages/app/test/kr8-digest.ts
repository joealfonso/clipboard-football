// KR8 ("Unchanged where there is no return"): a digest of every drawn key on the plays the
// kickoff return pass must not touch, so the test can compare the build against the build before
// the pass. kr8-baseline.json was captured from this digest on 2026-11-15, before any kickReturn
// code or data existed (motion.json version 3, no kickReturn block). It is a fixed reference: it is
// recaptured only by a person who has checked that a change to punts, touchbacks, fair catches,
// kicks out of bounds or onside kicks was intended, never to make KR8 pass.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlayEvent } from "../src/engine/types";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { timeline, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { FAIR_CATCH, KICKOFF_TOUCHBACK, PUNT_RETURNED } from "./fixtures";
import { KO_FAIR, KO_OOB, KO_SHORT, ONSIDE_KICKERS, ONSIDE_RECEIVERS } from "./kickoff-return.fixtures";
import { playGame } from "./support";

const read = (p: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", p), "utf8"));

/** A play with no kickoff return: every punt, and every kickoff or onside kick nobody returns. */
export function noReturn(ev: PlayEvent): boolean {
  const p = ev.play;
  if (p.kind === "punt" || p.kind === "onsideKick") return true;
  if (p.kind !== "kickoff") return false;
  return p.outcome !== "inPlay";
}

export const KR8_FIXTURES: Readonly<Record<string, PlayEvent>> = { KICKOFF_TOUCHBACK, PUNT_RETURNED, FAIR_CATCH, KO_FAIR, KO_OOB, KO_SHORT, ONSIDE_KICKERS, ONSIDE_RECEIVERS };
export const KR8_SEEDS = [1, 2, 3, 4];

const h = (x: unknown): string => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

export function digestOf(tl: Timeline): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tl.marks) out[`${m.side}:${m.slot}`] = h(m.keys);
  out["ball"] = h({ ball: tl.ball, scale: tl.ballScale, paths: tl.paths, liveEnd: tl.liveEnd, total: tl.total });
  return out;
}

export function kr8Digest(): Record<string, Record<string, string>> {
  const templates = parseTemplates(read("data/ui/templates.json"));
  // The motion file may have gained a kickReturn block since the capture: parse it as the app does.
  const motion = parseMotion(read("data/ui/motion.json"));
  const personnel = read("data/engine/personnel.json") as { presetPackage: Record<string, string> };
  const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, pxPerYard: 9.26, markPx: 14, motion };
  const tlOf = (ev: PlayEvent): Timeline => timeline({ event: ev, runoffSeconds: 0 }, templates, ctx);
  const out: Record<string, Record<string, string>> = {};
  for (const [name, ev] of Object.entries(KR8_FIXTURES)) out[name] = digestOf(tlOf(ev));
  for (const seed of KR8_SEEDS) {
    let i = 0;
    for (const ev of playGame(seed, seed % 2 === 0 ? "home" : "away", seed).events) {
      if (ev.t !== "play") continue;
      i++;
      const e = ev as PlayEvent;
      if (!noReturn(e)) continue;
      out[`seed ${seed} play ${i} ${e.play.kind}`] = digestOf(tlOf(e));
    }
  }
  return out;
}
