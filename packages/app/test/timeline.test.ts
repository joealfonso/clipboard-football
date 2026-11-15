// The animation reads the PlayResult and decides nothing (design spec A1 to A4): timeline() is
// pure, the ball ends where the engine says, the offense lines up below the line, the engine's
// ball holder and tackler are the marks at the ball, every field label states a result field,
// diagram marks never touch the ball, and unknown facts are drawn neutral.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readDetail, type PlayEvent } from "../src/engine/types";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { MID_X, at, timeline, type Timeline, type TimelineCtx } from "../src/ui/timeline";
import { ALL_FIXTURES, COMPLETE, FALSE_START, FIELD_GOAL_MISS, INCOMPLETE, INTERCEPTION, KICKOFF_RETURN, RUN_OUT_OF_BOUNDS, SACK, UNNAMED_COMPLETE } from "./fixtures";
import { playGame } from "./support";

const templates = parseTemplates(JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/ui/templates.json"), "utf8")));
const personnel = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/engine/personnel.json"), "utf8")) as { presetPackage: Record<string, string> };
const motion = parseMotion(JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/ui/motion.json"), "utf8")));
const ctx: TimelineCtx = { presetPackage: personnel.presetPackage, endZoneYards: 10, numbers: {}, motion };

const build = (event: PlayEvent, runoffSeconds = 0): Timeline => timeline({ event, runoffSeconds }, templates, ctx);

/** The player the engine says holds the ball when it's dead (null when nobody does). */
function engineHolder(ev: PlayEvent): string | null {
  const p = ev.play;
  const parts = readDetail(p).participants ?? {};
  const end = "end" in p ? p.end : undefined;
  const fumbled = readDetail(p).class === "fumble" || readDetail(p).class === "fumbleCatch" || ("turnover" in p && p.turnover === "fumble");
  const leaf = ev.offense.twoPointPlay ?? "";
  // A two-point try is drawn as the run or pass it was.
  const kind = p.kind === "twoPoint" ? (["insideRun", "outsideRun", "qbSneak"].includes(leaf) ? "run" : "pass") : p.kind;
  if (p.kind === "twoPoint" && kind === "pass") return p.incomplete === true ? null : fumbled ? (parts.fumbleRecoverer ?? null) : (parts.receiver ?? null);
  switch (kind) {
    case "run":
    case "scramble":
    case "kneel":
      return fumbled ? (parts.fumbleRecoverer ?? null) : (parts.ballCarrier ?? (p.kind === "run" ? null : (parts.passer ?? null)));
    case "pass":
      if ("incomplete" in p && p.incomplete === true) return null;
      if ("turnover" in p && p.turnover === "interception") return end?.possession === "defense" ? (parts.interceptor ?? null) : (parts.fumbleRecoverer ?? null);
      return fumbled ? (parts.fumbleRecoverer ?? null) : (parts.receiver ?? null);
    case "sack":
      return fumbled ? (parts.fumbleRecoverer ?? null) : (parts.passer ?? null);
    case "punt":
      return readDetail(p).class === "blocked" ? null : (parts.returner ?? null);
    case "kickoff":
    case "onsideKick":
      return end === undefined ? null : (parts.returner ?? (p.kind === "onsideKick" ? (parts.fumbleRecoverer ?? null) : null));
    default:
      return null;
  }
}

/** Each label's text must be backed by the result field it names. */
function labelHolds(text: string, source: string, ev: PlayEvent): boolean {
  const p = ev.play;
  const d = readDetail(p);
  const off = ev.before.possession;
  const def = off === "home" ? "away" : "home";
  const gOff = ev.after.score[off] - ev.before.score[off];
  const gDef = ev.after.score[def] - ev.before.score[def];
  switch (text) {
    case "Incomplete":
      return source === "incomplete" && "incomplete" in p && p.incomplete === true;
    case "Interception":
      return source === "turnover" && "turnover" in p && p.turnover === "interception";
    case "Touchdown":
      return source === "after.score" && (gOff >= 6 || gDef >= 6);
    case "Safety":
      return source === "after.score" && gDef === 2 && ev.after.safetyKick;
    case "Two-point try good":
      return source === "after.score" && p.kind === "twoPoint" && gOff === 2;
    case "No good":
      return source === "good" ? "good" in p && !p.good : source === "after.score" && p.kind === "twoPoint" && gOff !== 2;
    case "Good":
    case "Field goal good":
      return source === "good" && "good" in p && p.good;
    case "Kneel":
      return source === "kind" && p.kind === "kneel";
    case "Spike":
      return source === "kind" && p.kind === "spike";
    case "Touchback":
      return (source === "outcome" && "outcome" in p && p.outcome.startsWith("touchback")) || (source === "detail.class" && d.class === "touchback");
    case "Out of bounds":
      return (source === "outcome" && "outcome" in p && p.outcome === "outOfBounds") || (source === "detail.class" && d.class?.startsWith("outOfBounds") === true);
    case "Fair catch":
      return (source === "outcome" && "outcome" in p && p.outcome === "fairCatch") || (source === "detail.class" && d.class?.startsWith("fairCatch") === true);
    case "Downed":
      return source === "detail.class" && d.class?.startsWith("downed") === true;
    case "Muffed":
      return source === "detail.class" && d.class === "muffed";
    case "Blocked":
      return source === "detail.class" && d.class === "blocked";
    case "Standout":
      // M2 F (lead, code review): the loop's final standout (GameEvent `standout`), the detail hook in fixtures.
      return source === "standout" && (ev.standout ?? d.standout) !== undefined;
    case "Recovered by the kicking team":
      return source === "end.possession" && "end" in p && p.end?.possession === "offense";
    case "Recovered by the receivers":
      return source === "end.possession" && "end" in p && p.end?.possession === "defense";
    default:
      if (text.startsWith("Fumble")) {
        const fumbled = d.class === "fumble" || d.class === "fumbleCatch" || ("turnover" in p && p.turnover === "fumble") || ("defensePossessedDuringPlay" in p && p.defensePossessedDuringPlay === true);
        const m = /#(\d+)$/.exec(text);
        return fumbled && (m === null || (d.participants?.fumbleRecoverer !== undefined && String(ctx.numbers[d.participants.fumbleRecoverer]) === m[1]));
      }
      return false;
  }
}

function checkPlay(ev: PlayEvent, label: string): void {
  const tl = build(ev, 12);
  const p = ev.play;
  // A2: the ball's final y is the engine's dead-ball spot.
  const fin = at(tl.ball, tl.liveEnd);
  if ("end" in p && p.end !== undefined) expect(fin.y, `${label}: ball y`).toBeCloseTo(p.end.spot, 6);
  // A2: at the set every offense mark is below the line (the offense attacks up).
  for (const m of tl.marks) if (m.side === "O") expect(at(m.keys, tl.snapAt).y, `${label}: ${m.slot} at set`).toBeLessThan(tl.los);
  // A2: the mark with the ball at the whistle is the engine's ball holder; the tackler is at the ball.
  expect(tl.holder, `${label}: holder`).toBe(engineHolder(ev));
  if (tl.holder !== null) {
    const m = tl.marks.find((x) => x.playerId === tl.holder);
    const pos = at(m?.keys ?? [], tl.liveEnd);
    expect(Math.hypot(pos.x - fin.x, pos.y - fin.y), `${label}: holder at the ball`).toBeLessThan(1e-6);
  }
  const tackler = readDetail(p).participants?.tackler;
  if (tackler !== undefined && tl.marks.some((m) => m.playerId === tackler)) {
    expect(tl.tackler).toBe(tackler);
    const pos = at(tl.marks.find((m) => m.playerId === tackler)?.keys ?? [], tl.liveEnd);
    expect(Math.hypot(pos.x - fin.x, pos.y - fin.y), `${label}: tackler at the ball`).toBeLessThan(1e-6);
  }
  // A2: every field label states a result field.
  for (const l of [...tl.labels, ...tl.flags]) {
    if (l.text === "Flag") expect((p.fouls ?? []).length, `${label}: flag`).toBeGreaterThan(0);
    else expect(labelHolds(l.text, l.source, ev), `${label}: label "${l.text}" from ${l.source}`).toBe(true);
  }
  // A3, amended (motion spec, contract 3): after the snap window, no unnamed defender comes within
  // the 2.5-yard ring of the ball on any drawn key, nor into the carrier's lane (2 yards either side
  // of his next 1.0 s of path); no unnamed mark touches the ball (1 yard) even between keys.
  // (Plain loop: an expect per sample is too slow.)
  const ring = templates.field.clearOfBallYards;
  const touches: string[] = [];
  const ballBefore = (t: number) => at(tl.ball, Math.min(t, tl.liveEnd - 1));
  for (const m of tl.marks) {
    if (m.fact) continue;
    for (let t = tl.snapWindowEnd; t < tl.liveEnd - 1; t += 12.5) {
      const onKey = Math.abs(t / 25 - Math.round(t / 25)) < 1e-6;
      const a = at(m.keys, t);
      const b = ballBefore(t);
      const r = Math.hypot(a.x - b.x, a.y - b.y);
      if (r < 1) touches.push(`${m.slot} touches the ball at ${t.toFixed(0)} ms`);
      else if (onKey && m.side === "X" && r < ring - 1e-6) touches.push(`${m.slot} inside the ring at ${t.toFixed(0)} ms (${r.toFixed(2)} yd)`);
    }
  }
  expect(touches, `${label}: diagram marks too close to the ball`).toEqual([]);
  // A4, amended (decision 11): live time from geometry, 1.5 to 4 s at 1x; kneel and spike fixed; no live phase for no play.
  const live = tl.liveEnd - tl.snapAt;
  if (p.kind === "noPlay") expect(live).toBe(0);
  else if (p.kind === "kneel") expect(live).toBe(motion.live.kneelMs);
  else if (p.kind === "spike") expect(live).toBe(motion.live.spikeMs);
  else {
    expect(live).toBeGreaterThanOrEqual(motion.live.minMs - 1e-6);
    expect(live).toBeLessThanOrEqual(motion.live.maxMs + 1e-6);
  }
  expect(tl.total).toBeGreaterThanOrEqual(tl.liveEnd);
}

describe("timeline purity (A1)", () => {
  it("the same event gives a deep-equal timeline", () => {
    for (const ev of Object.values(ALL_FIXTURES)) expect(build(ev, 20)).toEqual(build(structuredClone(ev), 20));
  });

  it("imports no Rng, no sim and no DOM, and never calls Math.random", () => {
    // Amended: also the motion builder and playArt.
    for (const f of ["timeline.ts", "templates.ts", "motion.ts", "art.ts"]) {
      // Code only: comments may say "window" or "Rng" in plain words.
      const src = readFileSync(join(import.meta.dirname, "../src/ui", f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const imports = ts.preProcessFile(src, true, true).importedFiles.map((x) => x.fileName);
      for (const i of imports) expect(["@clipboard-football/shared", "../engine/types", "./templates", "./art", "./motion"], `${f} imports ${i}`).toContain(i);
      expect(src).not.toMatch(/Math\.random|document\.|window\.|performance\.|Date\./);
    }
  });
});

describe("timeline facts (A2, A3) on fixtures shaped like the spec", () => {
  it.each(Object.entries(ALL_FIXTURES))("%s", (name, ev) => checkPlay(ev, name));

  it("a completion: the receiver carries the ball to the end spot and the tackler meets him", () => {
    const tl = build(COMPLETE);
    expect(tl.holder).toBe("H-WR2");
    expect(tl.tackler).toBe("A-CB2");
    expect(tl.involved).toEqual(expect.arrayContaining(["H-QB1", "H-WR2", "A-CB2"]));
  });

  it("an incompletion: the ball goes back to the previous spot, labelled Incomplete, no holder", () => {
    const tl = build(INCOMPLETE);
    expect(tl.labels.map((l) => l.text)).toContain("Incomplete");
    expect(at(tl.ball, tl.liveEnd)).toEqual({ x: MID_X, y: 40 });
    expect(tl.holder).toBeNull();
  });

  it("an interception runs back down the screen", () => {
    const tl = build(INTERCEPTION);
    const caught = at(tl.ball, tl.labels.find((l) => l.text === "Interception")?.t ?? 0);
    expect(at(tl.ball, tl.liveEnd).y).toBeLessThanOrEqual(caught.y);
  });

  it("a sack: the sacker reaches the QB at the end spot", () => {
    const tl = build(SACK);
    const sacker = tl.marks.find((m) => m.playerId === "A-DL2");
    expect(at(sacker?.keys ?? [], tl.liveEnd)).toEqual(at(tl.ball, tl.liveEnd));
  });

  it("out of bounds goes to a sideline (the near one of the diagram when the side is unknown)", () => {
    const x = at(build(RUN_OUT_OF_BOUNDS).ball, Infinity).x;
    expect([0, 53.3]).toContain(x);
  });

  it("a kickoff is drawn in the kicking team's frame: the kick goes up the screen", () => {
    const tl = build(KICKOFF_RETURN);
    const land = tl.paths.find((p) => p.kind === "ball")?.points[1];
    expect(land?.y).toBeGreaterThan(tl.los);
  });

  it("a pre-snap foul: no snap, the flag at the line, the fouler ringed", () => {
    const tl = build(FALSE_START);
    expect(tl.flags).toHaveLength(1);
    expect(tl.flags[0]?.at.y).toBe(40);
    expect(tl.rings).toContain("H-OL2");
    for (const m of tl.marks) expect(m.keys).toHaveLength(1);
  });
});

describe("unknown facts are drawn neutral and never named (A3)", () => {
  it("with no participants nobody holds the ball and the catch is in the middle", () => {
    const tl = build(UNNAMED_COMPLETE);
    expect(tl.holder).toBeNull();
    expect(tl.tackler).toBeNull();
    expect(tl.involved).toEqual([]);
    expect(at(tl.ball, tl.liveEnd).x).toBe(MID_X);
    for (const l of tl.labels) expect(l.text).not.toMatch(/#/);
  });

  it("a missed field goal reaches the posts in the middle and says only No good", () => {
    const tl = build(FIELD_GOAL_MISS);
    expect(tl.labels.map((l) => l.text)).toEqual(["No good"]);
    expect(at(tl.ball, tl.liveEnd)).toEqual({ x: MID_X, y: 110 });
  });
});

describe("timeline over simulated games (A2, A3, A4)", () => {
  it("every play of 12 games through the engine's step-wise loop, players named", { timeout: 120_000 }, () => {
    let plays = 0;
    let named = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = playGame(seed, seed % 2 === 0 ? "home" : "away", seed);
      for (const ev of g.events) {
        if (ev.t !== "play") continue;
        checkPlay(ev, `seed ${seed} play ${plays}`);
        if (build(ev).holder !== null) named++;
        plays++;
      }
    }
    expect(plays).toBeGreaterThan(1000);
    // With the engine naming players, most plays end with a named ball holder.
    expect(named / plays).toBeGreaterThan(0.5);
  });
});
