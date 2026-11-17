// Calling screen pass U3 (docs/specs/m2-calling-screen-pass.md): Last play details in plain words.
// Every trace factor the engine emits lands in its group with the spec's copy and no debug text
// (DT1); every multiplier is shown once as the spec's percent (DT2); the headline shows once,
// detail.why never, and Copy details keeps today's raw JSON (DT3).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { whyHeadline } from "../src/engine/headline";
import { readDetail, type PlayEvent, type TraceEntry } from "../src/engine/types";
import { detailSheet, EDGES_NOTE, percentOf } from "../src/ui/details";
import { playerRef, type TextCtx } from "../src/ui/text";
import { appHarness, appLabels, installFakeDom, type FakeEl } from "./fake-dom";
import { COMPLETE } from "./fixtures";
import { ctxOf, simGames } from "./sim-games";

const GAMES = 200;
const players = new Map([
  ["H-QB1", { name: "Jalen Pratt", number: 12 }],
  ["H-WR2", { name: "Dami Okafor", number: 81 }],
  ["A-CB2", { name: "Kei Moss", number: 24 }],
  ["H-RB1", { name: "Ray Vance", number: 22 }],
  ["H-OL2", { name: "Bo Smith", number: 74 }],
]);
const ctx: TextCtx = {
  human: "home",
  teams: { home: { name: "Riverbend Pilots", nickname: "Pilots" }, away: { name: "Harborview Cranes", nickname: "Cranes" } },
  players,
  labels: { shotgun: "Shotgun", shortPass: "Short pass", nickelCover1: "Nickel Cover 1", deepPass: "Deep pass", inc: "Incomplete", sack: "Sack", yardsLong: "A rare long gain", returnedShort: "Returned", offensiveHolding: "Holding", completionToIncomplete: "Completion to incomplete", speed: "Speed" },
  regulationPeriods: 4,
  endZoneYards: 10,
};
const withTrace = (trace: readonly TraceEntry[], extra: Partial<PlayEvent> = {}): PlayEvent => ({ ...COMPLETE, offense: { call: "shortPass", formation: "shotgun" }, defense: "nickelCover1", ...extra, play: { ...COMPLETE.play, detail: { ...(COMPLETE.play.detail ?? {}), trace } } as PlayEvent["play"] });
const T = (e: Record<string, string | number | boolean>): TraceEntry => e as TraceEntry;
const STANDOUT = { player: "H-RB1", number: 22, name: "Ray Vance", rating: "speed", ratingLabel: "Speed", value: 94, kind: "breakaway", applied: 1.5 };

/** [factor, entry, group, line] from the U3 table (copy adapted to these fixture names). */
const CASES: readonly [string, TraceEntry, string, string][] = [
  ["call", T({ factor: "call", label: "Shotgun, Short pass", leaf: "shortPass", kind: "shortPass" }), "Situation", "Your call: Shotgun, Short pass."],
  ["cell", T({ factor: "cell", family: "deepPass", level: 1, key: "deepPass|1|7+|OWN" }), "Situation", "Situation table: deep pass, level 1 (0 is the most specific)."],
  ["fieldGoal", T({ factor: "fieldGoal", distance: 47, pct: 78 }), "Situation", "Kick distance: 47 yards. Make chance: 78%."],
  ["special", T({ factor: "special", event: "returnedShort", gross: 45 }), "Situation", "Kick: returned, 45 yards gross."],
  ["matchup", T({ factor: "matchup", preset: "nickelCover1", presetLabel: "Nickel Cover 1", class: "inc", multiplier: 1.14 }), "Matchup", "Their call, Nickel Cover 1: +14% toward Incomplete."],
  ["formation", T({ factor: "formation", formation: "shotgun", formationLabel: "Shotgun", package: "nickel", packageLabel: "Nickel", class: "sack", multiplier: 0.94 }), "Matchup", "Shotgun against Nickel: -6% toward Sack."],
  ["rating", T({ factor: "rating", effect: "passRush", label: "Pass rush", class: "sack", multiplier: 1.08 }), "Players", "Pass rush: +8% toward Sack."],
  ["standout", T({ factor: "standout", ...STANDOUT }), "Players", "Standout: #22 R. Vance's speed (94) made this result 50% more likely."],
  ["standoutCandidate", T({ factor: "standoutCandidate", ...STANDOUT }), "Players", "Standout: #22 R. Vance's speed (94) made this result 50% more likely. It didn't count: the play didn't stand."],
  ["fouler", T({ factor: "fouler", id: "H-OL2", number: 74, name: "Bo Smith", penalty: "offensiveHolding" }), "Players", "Flag on #74 B. Smith: holding."],
  ["class", T({ factor: "class", name: "inc", label: "Incomplete", basePct: 31, pct: 35 }), "Outcome", "Result: Incomplete. 31% before the edges, 35% after."],
  ["fluke", T({ factor: "fluke", reason: "yardsLong", what: "a gain that long", pctile: 97.5 }), "Outcome", "Fluke: a long gain, past the 97.5th percentile of gains in this situation."],
  ["penalty", T({ factor: "penalty", id: "offensiveHolding", label: "Holding", side: "Offense" }), "Outcome", "Flag: holding on the offense."],
  ["review", T({ factor: "review", kind: "completionToIncomplete", question: "completionToIncomplete" }), "Outcome", "Reviewed and reversed: the catch was ruled incomplete."],
];

const RAW_IDS = /\b[HA]-[A-Z]+\d\b/;
const clean = (line: string, ids: ReadonlySet<string>): void => {
  expect(line).not.toMatch(/\bid /);
  expect(line).not.toContain("|");
  expect(line).not.toContain(" x1.");
  for (const id of ids) expect(line.includes(id), `${line} has the raw id ${id}`).toBe(false);
};

describe("DT1: each trace factor renders into its group and copy, with no debug text", () => {
  it.each(CASES.map((c) => [c[0], c] as const))("%s", (_f, [, entry, group, line]) => {
    const sheet = detailSheet(withTrace([entry]), ctx);
    const g = sheet.groups.find((x) => x.title === group);
    expect(g?.lines, group).toContain(line);
    for (const x of sheet.groups) for (const l of x.lines) clean(l, new Set(players.keys()));
    expect(line).not.toMatch(RAW_IDS);
  });

  it("the groups come in the order Situation, Matchup, Players, Outcome, and an empty group is left out", () => {
    const all = detailSheet(withTrace(CASES.map((c) => c[1])), ctx);
    expect(all.groups.map((g) => g.title)).toEqual(["Situation", "Matchup", "Players", "Outcome"]);
    const one = detailSheet(withTrace([CASES[10]?.[1] as TraceEntry]), ctx);
    expect(one.groups.map((g) => g.title)).not.toContain("Matchup");
  });

  it("Players names every participant in words; the calls line is in Situation", () => {
    const sheet = detailSheet(withTrace([CASES[0]?.[1] as TraceEntry]), ctx);
    expect(sheet.groups.find((g) => g.title === "Players")?.lines[0]).toBe("Passer #12 J. Pratt. Target #81 D. Okafor. Receiver #81 D. Okafor. Tackler #24 K. Moss.");
    expect(sheet.groups.find((g) => g.title === "Situation")?.lines).toContain("Calls: You: Shotgun, Short pass. They: Nickel Cover 1.");
  });

  it("the human on defense reads the matchup as his own call", () => {
    const sheet = detailSheet(withTrace([CASES[4]?.[1] as TraceEntry]), { ...ctx, human: "away" });
    expect(sheet.groups.find((g) => g.title === "Matchup")?.lines).toContain("Your call, Nickel Cover 1: +14% toward Incomplete.");
  });

  it("an unknown factor, or a fluke or review with no words, is an Other line, its player ids as names with no key (N2)", () => {
    const sheet = detailSheet(withTrace([T({ factor: "mystery", id: "H-QB1", n: 3 }), T({ factor: "fluke", reason: "oddBounce", what: "oddBounce" }), T({ factor: "review", kind: "newKind", question: "newKind" })]), ctx);
    const out = sheet.groups.find((g) => g.title === "Outcome")?.lines ?? [];
    expect(out).toContain("Other: mystery: #12 J. Pratt, n 3");
    expect(out.some((l) => l.startsWith("Other: fluke: reason oddBounce"))).toBe(true);
    expect(out.some((l) => l.startsWith("Other: review: kind newKind"))).toBe(true);
    // A fluke reason the sheet doesn't word itself uses the engine's own label (`what`).
    const late = detailSheet(withTrace([T({ factor: "fluke", reason: "late", what: "A late break" })]), ctx);
    expect(late.groups.flatMap((g) => g.lines)).toContain("Fluke: a late break.");
  });

  it("a fouler or standout with no name leaves the name out, never an unnamed player (N2)", () => {
    const sheet = detailSheet(withTrace([T({ factor: "fouler", id: "X-9", penalty: "offensiveHolding" }), T({ factor: "standout", player: "X-9", rating: "speed", ratingLabel: "Speed", value: 90, kind: "k", applied: 1.2 })]), ctx);
    const lines = sheet.groups.flatMap((g) => g.lines);
    expect(lines).toContain("Flag: holding.");
    expect(lines).toContain("Standout: a speed (90) made this result 20% more likely.");
    for (const l of lines) expect(l).not.toContain("unnamed");
  });

  // Code review S5: with the real data/engine/why.json labels, not made-up ones.
  describe("with the real why.json labels", () => {
    const real = { ...ctx, labels: appLabels() };
    const lines = (e: TraceEntry): string[] => detailSheet(withTrace([e]), real).groups.flatMap((g) => g.lines);
    it("both fluke reasons read as sentences of their own", () => {
      expect(lines(T({ factor: "fluke", reason: "yardsLong", what: real.labels["yardsLong"] ?? "", pctile: 97.5 }))).toContain("Fluke: a long gain, past the 97.5th percentile of gains in this situation.");
      expect(lines(T({ factor: "fluke", reason: "classRare", what: real.labels["classRare"] ?? "" }))).toContain("Fluke: a rare result for this call in this situation.");
    });
    it("every close-call kind's review reads in words, never an Other line", () => {
      for (const kind of ["completionToIncomplete", "fumbleToDown", "interceptionToIncomplete", "touchdownToShort", "spotLineToGain"]) {
        const out = lines(T({ factor: "review", kind, question: kind }));
        expect(out.some((l) => l.startsWith("Reviewed and reversed: ")), kind).toBe(true);
        for (const l of out) expect(l, kind).not.toMatch(/^Other:|that long|that rare/);
      }
    });
  });
});

describe(`DT2: over ${GAMES} simulated games, every multiplier is on the sheet once, as the formula`, () => {
  it("the sheet's percents equal the trace's multiplier fields, one for one", { timeout: 600_000 }, () => {
    const labels = appLabels();
    let total = 0;
    for (const g of simGames(GAMES)) {
      const c = ctxOf(g, labels);
      const ids = new Set(c.players.keys());
      for (const ev of g.plays) {
        const trace = readDetail(ev.play).trace ?? [];
        const want = trace
          .filter((e) => typeof e["multiplier"] === "number")
          .map((e) => {
            const m = e["multiplier"] as number;
            const pct = m >= 1 ? `+${Math.round((m - 1) * 100)}%` : `-${Math.round((1 - m) * 100)}%`;
            return `${pct} toward ${c.labels[String(e["class"])] ?? String(e["class"])}`;
          })
          .sort();
        const lines = detailSheet(ev, c).groups.flatMap((x) => x.lines);
        const got = lines.flatMap((l) => [...l.matchAll(/[+-]\d+% toward [^.]+/g)].map((m) => m[0])).sort();
        expect(got, `seed ${g.seed}`).toEqual(want);
        for (const l of lines) clean(l, ids);
        total += want.length;
      }
    }
    expect(total).toBeGreaterThan(GAMES * 50);
  });

  it("percentOf is the spec's formula", () => {
    expect(percentOf(1.14)).toBe("+14%");
    expect(percentOf(0.94)).toBe("-6%");
    expect(percentOf(1)).toBe("+0%");
    expect(percentOf(0.5)).toBe("-50%");
  });
});

describe("DT3: the headline once, detail.why never, Copy details unchanged", () => {
  let restore: PropertyDescriptor | undefined;
  let copied = "";
  beforeAll(() => {
    installFakeDom(1280, 720);
    restore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: (t: string) => ((copied = t), Promise.resolve()) } } });
  });
  afterAll(() => {
    if (restore !== undefined) Object.defineProperty(globalThis, "navigator", restore);
  });

  it("on every play of 20 simulated games", () => {
    for (const g of simGames(20)) {
      const h = appHarness({ matchup: g.matchup, human: g.human });
      for (const ev of g.plays.slice(0, 60)) {
        h.call("setPlayText", h.game, ev);
        const body = h.call<FakeEl[]>("detailsBody");
        const text = body.map((e) => e.textContent).join("\n");
        const head = body[0]?.textContent ?? "";
        // The first line is the why headline itself (whyHeadline, or the M2 design's fallback), not just any line.
        expect(head).toBe(whyHeadline(ev.play, ev.standout) ?? "No explanation for this play.");
        expect(head.length).toBeGreaterThan(0);
        expect(text.split(head).length - 1, `headline once: ${head}`).toBe(1);
        const why = readDetail(ev.play).why;
        if (why !== undefined && why !== head) expect(text.includes(why), "detail.why on the sheet").toBe(false);
        expect(text).toContain(EDGES_NOTE);
        expect(text).not.toMatch(/x1\.\d/);
        h.call("copyDetails", { id: "details" });
        const st = (h.game["state"] as { playCount?: number } | null)?.playCount ?? null;
        expect(copied).toBe(JSON.stringify({ seed: g.matchup.seed, leagueSeed: g.matchup.leagueSeed, playNumber: st, event: ev }));
      }
    }
  });

  it("no play yet and an empty trace keep their states", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human });
    expect(h.call<FakeEl[]>("detailsBody").map((e) => e.textContent)).toEqual(["No plays yet."]);
    h.call("setPlayText", h.game, { ...COMPLETE, play: { ...COMPLETE.play, detail: { headline: "H." } } });
    expect(h.call<FakeEl[]>("detailsBody").map((e) => e.textContent)).toContain("The engine recorded no factors for this play.");
  });

  it("player refs on the sheet are playerRef's", () => {
    expect(playerRef("H-QB1", ctx)).toBe("#12 J. Pratt");
  });
});
