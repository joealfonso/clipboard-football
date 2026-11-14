// M2 milestone D, the why headline (docs/specs/m2-engine-and-game-loop.md D1-D4; D5 is the outcome
// digest, which keeps detail.why). Over 10,000 step 4 C1 plays with numbered players.

import { describe, expect, it, vi } from "vitest";
import { whySchema } from "../../packages/shared/src/engine-schema";
import { TRACE_FIELDS, type Player, type WhyTemplate } from "../../packages/shared/src/engine";
import type { Participants, PlayResult, TeamPool } from "../../packages/shared/src/types";
import { EngineError } from "../../packages/sim/src/engine/errors";
import { createEngine } from "../../packages/sim/src/engine/resolve";
import { headlineSlotsOf, renderHeadline, type TraceEntry } from "../../packages/sim/src/engine/why";
import type { GameState } from "../../packages/sim/src/game/types";
import { leagueFromSeed } from "../../packages/sim/src/loop/league";
import { Rng } from "../../packages/sim/src/rng";
import { callsFor } from "../../packages/sim/test/support/engine-calls";
import { randomGame } from "../../packages/sim/test/support/random-game";
import { loadRules } from "../../packages/sim/test/support/rules";
import { data } from "./support";

// Whole games per test: the default 5 s is too short when the full suite runs in parallel.
vi.setConfig({ testTimeout: 120_000 });

const why = data.engine.why;
const { rules, hash } = loadRules();
const ROLE_FACTORS = new Set(["passer", "target", "receiver", "ballCarrier", "tackler", "sacker", "interceptor", "fumbleForcer", "fumbleRecoverer", "kicker", "punter", "returner"]);

interface Detail {
  why: string;
  whyTemplate: string;
  headline: string;
  trace: TraceEntry[];
  participants: Participants;
}

describe("D1: every template has a headline", () => {
  it("every template in why.json has a non-empty headline", () => {
    expect(why.templates.length).toBeGreaterThan(10);
    for (const t of why.templates) expect(typeof t.headline === "string" && t.headline.trim().length > 0, t.id).toBe(true);
  });

  it("the schema rejects a template without one", () => {
    const raw = JSON.parse(JSON.stringify({ ...why })) as { templates: Record<string, unknown>[] };
    expect(() => whySchema.parse(raw)).not.toThrow();
    const missing = { ...raw, templates: raw.templates.map((t, i) => (i === 3 ? Object.fromEntries(Object.entries(t).filter(([k]) => k !== "headline")) : t)) };
    expect(() => whySchema.parse(missing)).toThrow();
    const empty = { ...raw, templates: raw.templates.map((t, i) => (i === 3 ? { ...t, headline: "" } : t)) };
    expect(() => whySchema.parse(empty)).toThrow();
  });
});

describe("D2, D3 over 10,000 C1 plays", () => {
  const league = leagueFromSeed(data, 31).teams;
  const players = { home: league[4]?.pool as TeamPool, away: league[5]?.pool as TeamPool };
  const byId = new Map<string, Player>();
  for (const p of [...players.home.players, ...players.away.players]) byId.set(p.id, p);
  const resolve = createEngine(data.engine);
  const r = Rng.fromSeed(8);
  const plays: PlayResult[] = [];
  for (let g = 0; plays.length < 10_000; g++) {
    for (const s of randomGame(rules, { gameType: "regularSeason", seed: 50 + g, rulesHash: hash }, 80 + g).states) {
      if (s.phase !== "scrimmage" && s.phase !== "try" && s.phase !== "kickoff") continue;
      const c = callsFor(s as GameState, rules, data.engine.caller, r, plays.length % 3 === 0);
      plays.push(resolve(s, c.offense, c.defense, players, r));
      if (plays.length === 10_000) break;
    }
  }

  it("D2: every headline renders from its template and trace, and every factor and player it names is in the trace with the value shown", () => {
    const bad: string[] = [];
    const used = new Set<string>();
    for (const p of plays) {
      const d = p.detail as unknown as Detail;
      const t = why.templates.find((x) => x.id === d.whyTemplate) as WhyTemplate;
      used.add(t.id);
      if (typeof d.headline !== "string" || d.headline.length === 0 || d.headline.includes("\n")) bad.push(`${t.id}: no one-line headline`);
      if (renderHeadline(t, d.trace) !== d.headline) bad.push(`${t.id}: headline is not its template rendered from the trace`);
      for (const [factor, field] of headlineSlotsOf(t)) {
        const e = d.trace.find((x) => x.factor === factor && x[field] !== undefined);
        if (e === undefined) {
          bad.push(`${t.id}: {${factor}.${field}} not in the trace`);
          continue;
        }
        if (!d.headline.includes(String(e[field]))) bad.push(`${t.id}: {${factor}.${field}} value not shown`);
        if (ROLE_FACTORS.has(factor)) {
          // The named player is the one credited with that role, by number and name.
          const id = (d.participants as Record<string, string>)[factor];
          const pl = byId.get(String(e["id"]));
          if (e["id"] !== id) bad.push(`${t.id}: names ${factor} ${String(e["id"])}, credited ${id}`);
          if (pl === undefined || e["number"] !== pl.number || e["name"] !== pl.name) bad.push(`${t.id}: ${factor} number or name is not the player's`);
        }
        if (factor === "fouler") {
          const pl = byId.get(String(e["id"]));
          if (pl === undefined || !(d.participants.foulers ?? []).includes(pl.id) || e["number"] !== pl.number || e["name"] !== pl.name) bad.push(`${t.id}: fouler is not a credited fouler`);
          // The fouler named is the one who committed the penalty named.
          const pen = d.trace.find((x) => x.factor === "penalty");
          if (pen !== undefined && t.headline.includes("{penalty.") && pen["id"] !== e["penalty"]) bad.push(`${t.id}: names ${String(pen["id"])} but the fouler committed ${String(e["penalty"])}`);
        }
      }
      // Any "#n Name" in the headline is a player in this play's trace.
      for (const m of d.headline.matchAll(/#(\d+) /g)) {
        const n = Number(m[1]);
        const e = d.trace.find((x) => (ROLE_FACTORS.has(x.factor) || x.factor === "fouler") && x["number"] === n && d.headline.includes(`#${n} ${String(x["name"])}`));
        if (e === undefined) bad.push(`${t.id}: #${n} is no player in the trace`);
      }
    }
    expect([...new Set(bad)].slice(0, 20)).toEqual([]);
    // The plays reach the templates that name players.
    for (const id of ["noPlay", "penalty", "punt", "fieldGoal", "extraPoint", "kickoff", "onside", "kneel", "spike"]) expect(used, id).toContain(id);
  });

  it("D3: no headline has a multiplier, a percentage or a raw factor id", () => {
    const ids = new Set<string>(Object.keys(TRACE_FIELDS));
    const camel = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/;
    const classIds = /\b(?:[rc]\d+(?:_\d+)?|inc|int|fumbleCatch)\b/;
    const bad: string[] = [];
    for (const p of plays) {
      const h = (p.detail as unknown as Detail).headline;
      if (/%|percent/i.test(h)) bad.push(`percentage: ${h}`);
      if (/\d+\.\d+|\d\s*x\b|×|multiplier/i.test(h)) bad.push(`multiplier: ${h}`);
      if (/[{}]/.test(h)) bad.push(`unrendered slot: ${h}`);
      if (camel.test(h.replace(/#\d+ [^,:.]+/g, ""))) bad.push(`raw id: ${h}`);
      if (classIds.test(h)) bad.push(`class id: ${h}`);
      if (/\bmatchup\b/i.test(h)) bad.push(`factor id matchup: ${h}`);
      for (const w of h.toLowerCase().match(/[a-z]+/g) ?? []) if (ids.has(w) && !["call", "class", "rating", "formation", "penalty", "fluke", "special", "cell", "kicker", "punter", "passer", "target", "receiver", "tackler", "sacker", "interceptor", "returner"].includes(w)) bad.push(`factor id ${w}: ${h}`);
    }
    expect([...new Set(bad)].slice(0, 20)).toEqual([]);
  });
});

describe("D4: an unbound headline slot throws a typed error, no fallback", () => {
  const trace: TraceEntry[] = [{ factor: "call", label: "A run", leaf: "insideRun", kind: "insideRun" }];
  const t = { ...(why.templates[0] as WhyTemplate), id: "x", headline: "{call.label} by #{kicker.number} {kicker.name}" };

  it("renderHeadline throws EngineError unboundSlot", () => {
    expect(() => renderHeadline(t, trace)).toThrow(EngineError);
    try {
      renderHeadline(t, trace);
    } catch (e) {
      expect((e as EngineError).code).toBe("unboundSlot");
    }
  });

  it("every real template with slots throws when its trace lacks a slot's factor", () => {
    let n = 0;
    for (const tpl of why.templates) {
      const slots = headlineSlotsOf(tpl);
      if (slots.length === 0) continue;
      const full: TraceEntry[] = slots.map(([f, field]) => ({ factor: f as TraceEntry["factor"], [field]: "v" }) as TraceEntry);
      expect(() => renderHeadline(tpl, full), tpl.id).not.toThrow();
      const [drop] = slots[slots.length - 1] as [string, string];
      expect(() => renderHeadline(tpl, full.filter((e) => e.factor !== drop)), tpl.id).toThrow(EngineError);
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });

  it("an engine whose headline slot cannot bind fails the play rather than fall back", () => {
    const broken = { ...data.engine, why: { ...why, templates: why.templates.map((x) => (x.id === "kickoff" ? { ...x, headline: "Kickoff by {punter.name}" } : x)) } };
    const resolve = createEngine(broken);
    const league = leagueFromSeed(data, 31).teams;
    const s = randomGame(rules, { gameType: "regularSeason", seed: 50, rulesHash: hash }, 80).states.find((x) => x.phase === "kickoff") as GameState;
    expect(() => resolve(s, { call: "kickoff" }, null, { home: league[0]?.pool as TeamPool, away: league[1]?.pool as TeamPool }, Rng.fromSeed(1))).toThrow(EngineError);
  });
});
