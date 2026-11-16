// Test-writer spec checks for the explicit coin toss event in the game log (M2, uncommitted work in
// packages/sim/src/loop/play.ts). Written from the spec, not the implementation:
//   A1 the opening toss is events[0], period 1, winner and choice from final.toss, receiver the team
//      that receives the opening kickoff; exactly one period-1 toss.
//   A2 overtime tosses carry period = regulation + 1 (then per periodsPerCoinToss), choice "receive" by default.
//   A3 a human toss winner's choice in a session appears in the opening toss event.
//   A4 the CLI text prints "Coin toss:" for the opening toss before the first play line.
//   A5 the event costs no Rng draws: play events match a run that never logged it.
//   requestEvents never includes toss events; RECORD_SCHEMA_VERSION is 2.

import { describe, expect, it } from "vitest";
import { newGame, peekToss } from "../../src/game/machine";
import type { Team } from "../../src/game/types";
import { averageCoachFor, leagueFromSeed, setupGame } from "../../src/loop/league";
import type { PlayResult } from "../../../shared/src/types";
import { RECORD_SCHEMA_VERSION, gamePlayers, playGame, prepareGame, recordOf, requestEvents, startGame, stepGame, type GameEvent, type GameKit, type GameRecord, type GameRun } from "../../src/loop/play";
import { answerSession, sessionRecord, startSession, type Session } from "../../src/loop/session";
import { Rng } from "../../src/rng";
import { loadGameData } from "../../../../scripts/game/data";
import { eventLine, renderGame } from "../../../../scripts/game/render";

const data = loadGameData();
const kit = prepareGame(data);
const coach = averageCoachFor(data);
const { teams } = leagueFromSeed(data, 2026);
const rules = data.engine.rules;
const REG = rules.game.regulationPeriods;
type GameType = "regularSeason" | "postseason";
const setup = (seed: number, gameType: GameType = "regularSeason") => setupGame(teams, 2026, seed, () => coach, gameType);
const other = (t: Team): Team => (t === "home" ? "away" : "home");
type Toss = Extract<GameEvent, { t: "toss" }>;
const tosses = (r: GameRecord): Toss[] => r.events.filter((e): e is Toss => e.t === "toss");

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1).concat([99, 12345, 2026]);
const records = new Map<string, GameRecord>();
const game = (seed: number, gameType: GameType = "regularSeason"): GameRecord => {
  const k = `${gameType}:${seed}`;
  let r = records.get(k);
  if (r === undefined) {
    r = playGame(setup(seed, gameType), kit, Rng.fromSeed(seed));
    records.set(k, r);
  }
  return r;
};

/** Seeds found by scanning seeds 1 to 300 (league seed 2026) whose games reach overtime; the tests re-check that they do. */
const OT_SEEDS: Record<GameType, readonly number[]> = { regularSeason: [88, 91, 120, 171], postseason: [174, 257, 88, 91] };
const overtimeGames = (gameType: GameType, want: number): GameRecord[] => {
  const out = OT_SEEDS[gameType].slice(0, want).map((seed) => game(seed, gameType));
  for (const r of out) expect(r.final.period, `${gameType} seed ${r.seed} reaches overtime`).toBeGreaterThan(REG);
  return out;
};

describe("A1: the opening toss is the record's first event", { timeout: 120_000 }, () => {
  it("events[0] is a period-1 toss matching final.toss, for every seed and both game types", () => {
    for (const gameType of ["regularSeason", "postseason"] as const) {
      for (const seed of SEEDS) {
        const r = game(seed, gameType);
        const tag = `${gameType} seed ${seed}`;
        const first = r.events[0];
        expect(first?.t, tag).toBe("toss");
        const t = first as Toss;
        expect(t.period, tag).toBe(1);
        expect(t.winner, tag).toBe(r.final.toss.winner);
        expect(t.choice, tag).toBe(r.final.toss.choice);
        expect(t.choice, `${tag}: default choice`).toBe("defer");
        expect(tosses(r).filter((x) => x.period === 1), tag).toHaveLength(1);
      }
    }
  });

  it("receiver is the team that receives the opening kickoff: the first kickoff is kicked by the other team", () => {
    for (const seed of SEEDS) {
      const r = game(seed);
      const t = r.events[0] as Toss;
      const kick = r.events.find((e) => e.t === "play");
      expect(kick?.t).toBe("play");
      if (kick?.t !== "play") continue;
      expect(kick.before.phase, `seed ${seed}`).toBe("kickoff");
      expect(kick.before.period).toBe(1);
      // During a kickoff the possession team is the kicking team.
      expect(kick.before.possession, `seed ${seed}`).toBe(other(t.receiver));
      // Defer by default: the winner kicks, so the loser receives.
      expect(t.receiver, `seed ${seed}`).toBe(other(t.winner));
    }
  });

  it("the toss winner varies across seeds (the event reads the drawn toss, not a constant)", () => {
    const winners = new Set(SEEDS.map((s) => (game(s).events[0] as Toss).winner));
    expect(winners).toEqual(new Set(["home", "away"]));
  });

  it("the toss event comes before every other event, including timeouts and run-offs", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const r = game(seed);
      expect(r.events.findIndex((e) => e.t !== "toss")).toBe(1);
    }
  });

  it("RECORD_SCHEMA_VERSION is 2 and records carry it", () => {
    expect(RECORD_SCHEMA_VERSION).toBe(2);
    expect(game(1).schemaVersion).toBe(2);
  });
});

describe("A2: overtime tosses", { timeout: 120_000 }, () => {
  it("regular season: the overtime toss has period regulation + 1 and choice receive; the receiver kicks off from the other side", () => {
    const ots = overtimeGames("regularSeason", 3);
    expect(ots.length, "need at least one overtime game in the scan").toBeGreaterThan(0);
    for (const r of ots) {
      const ot = tosses(r).filter((t) => t.period !== 1);
      expect(ot.length, `seed ${r.seed}`).toBe(1);
      const t = ot[0] as Toss;
      expect(t.period).toBe(REG + 1);
      expect(t.choice).toBe("receive");
      expect(t.receiver).toBe(t.winner);
      expect(r.final.overtime?.toss.winner).toBe(t.winner);
      expect(r.final.overtime?.firstTeam).toBe(t.receiver);
      // The next event that is a play is the overtime kickoff, kicked by the non-receiver.
      const i = r.events.indexOf(t);
      const kick = r.events.slice(i + 1).find((e) => e.t === "play");
      expect(kick?.t === "play" && kick.before.phase).toBe("kickoff");
      expect(kick?.t === "play" && kick.before.period).toBe(REG + 1);
      expect(kick?.t === "play" && kick.before.possession).toBe(other(t.receiver));
      // The toss comes after the end of regulation.
      const endReg = r.events.findIndex((e) => e.t === "endPeriod" && e.period === REG);
      expect(endReg).toBeGreaterThan(0);
      expect(i).toBeGreaterThan(endReg);
    }
  });

  it("every toss opens a period that the rule set's periodsPerCoinToss says gets a toss", () => {
    const every = { regularSeason: rules.overtime.regularSeason.periodsPerCoinToss, postseason: rules.overtime.postseason.periodsPerCoinToss };
    for (const gameType of ["regularSeason", "postseason"] as const) {
      for (const r of overtimeGames(gameType, 4)) {
        const periods = tosses(r).map((t) => t.period);
        expect(periods[0]).toBe(1);
        for (const p of periods.slice(1)) {
          expect(p).toBeGreaterThan(REG);
          expect((p - REG - 1) % every[gameType], `${gameType} seed ${r.seed} toss at period ${p}`).toBe(0);
        }
        // One toss per overtime cycle reached.
        const cycles = r.final.period > REG ? Math.floor((r.final.period - REG - 1) / every[gameType]) + 1 : 0;
        expect(periods.length - 1, `${gameType} seed ${r.seed}`).toBe(cycles);
        // No toss event for a period that does not start a cycle (postseason periods 6 to 8).
        expect(new Set(periods).size).toBe(periods.length);
      }
    }
  });
});

/** The kickoff that follows a toss event: the first play after it. */
const kickAfter = (r: GameRecord, t: Toss): Extract<GameEvent, { t: "play" }> | undefined => {
  const i = r.events.indexOf(t);
  return r.events.slice(i + 1).find((e): e is Extract<GameEvent, { t: "play" }> => e.t === "play");
};

describe("A2: a postseason game forced into a second overtime cycle", { timeout: 120_000 }, () => {
  const fmt = rules.overtime.postseason;
  const k = fmt.periodsPerCoinToss;
  // Every scrimmage snap through the last period before the second overtime toss is a 15-second
  // incompletion and every kickoff a touchback: nobody scores, so the game reaches the second toss.
  const forcedThrough = REG + k;
  const forced: GameKit = {
    data,
    resolve: (s, o, d, p, rng) => {
      const r = kit.resolve(s, o, d, p, rng);
      if (s.period > forcedThrough) return r;
      if (s.phase === "scrimmage") return { kind: "pass", seconds: 15, incomplete: true, end: { spot: s.spot, possession: "offense" } } as PlayResult;
      if (s.phase === "kickoff") return { kind: "kickoff", seconds: 0, outcome: "touchbackEndZone" } as PlayResult;
      return r;
    },
  };
  const forcedGames = new Map<number, GameRecord>();
  const forcedGame = (seed: number): GameRecord => {
    let r = forcedGames.get(seed);
    if (r === undefined) {
      r = playGame(setup(seed, "postseason"), forced, Rng.fromSeed(seed));
      forcedGames.set(seed, r);
    }
    return r;
  };
  const SEEDS2 = [599, 1, 2, 3, 4, 5];

  it("toss periods are exactly 1, regulation + 1, regulation + 1 + periodsPerCoinToss, ...", () => {
    for (const seed of SEEDS2) {
      const r = forcedGame(seed);
      expect(r.final.phase).toBe("final");
      expect(r.final.period, `seed ${seed} reached the second cycle`).toBeGreaterThan(forcedThrough);
      const want = [1];
      for (let p = REG + 1; p <= r.final.period; p += k) want.push(p);
      expect(tosses(r).map((t) => t.period), `seed ${seed}`).toEqual(want);
      expect(want.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("every toss's receiver receives that toss's kickoff (the kicker is the other team), in every cycle", () => {
    for (const seed of SEEDS2) {
      const r = forcedGame(seed);
      for (const t of tosses(r)) {
        const tag = `seed ${seed} toss for period ${t.period}`;
        const kick = kickAfter(r, t);
        expect(kick, tag).toBeDefined();
        expect(kick?.before.phase, tag).toBe("kickoff");
        expect(kick?.before.period, tag).toBe(t.period);
        expect(kick?.before.possession, tag).toBe(other(t.receiver));
        if (t.period > 1) {
          expect(t.choice, tag).toBe("receive");
          expect(t.receiver, tag).toBe(t.winner);
        }
      }
    }
  });

  it("across seeds, some second-cycle toss is won by the team that did not win the first overtime toss (the stale firstTeam case is reached)", () => {
    let reached = false;
    for (const seed of SEEDS2) {
      const ot = tosses(forcedGame(seed)).filter((t) => t.period > REG);
      if (ot.length >= 2 && ot[1]?.winner !== ot[0]?.winner) reached = true;
    }
    expect(reached).toBe(true);
  });
});

describe("A3: a human toss winner's choice appears in the opening toss event", { timeout: 120_000 }, () => {
  /** Answers the opening toss with `choice`, then plays the rest by taking the first legal option. */
  const humanGame = (seed: number, human: Team, choice: string): { session: Session; first: GameEvent | undefined } => {
    const st = setup(seed);
    let s = startSession(st, kit, human);
    const req = s.request;
    expect(req?.kind).toBe("toss");
    const r = answerSession(s, st, kit, { seq: req?.seq ?? 0, path: [choice] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    s = r.session;
    return { session: s, first: s.run?.events[0] };
  };

  for (const choice of ["receive", "defer"] as const) {
    it(`a human winner choosing ${choice} is logged with the right receiver`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const human = peekToss(Rng.fromSeed(seed));
        const { session, first } = humanGame(seed, human, choice);
        expect(first?.t, `seed ${seed}`).toBe("toss");
        const t = first as Toss;
        expect(t.period).toBe(1);
        expect(t.winner).toBe(human);
        expect(t.choice).toBe(choice);
        expect(t.receiver).toBe(choice === "receive" ? human : other(human));
        expect(session.run?.state.toss.choice).toBe(choice);
        // Exactly one opening toss in the session's log.
        expect(session.run?.events.filter((e) => e.t === "toss" && e.period === 1)).toHaveLength(1);
      }
    });
  }

  it("a human who loses the toss sees the default (defer) logged with the AI winner", () => {
    for (const seed of [1, 2, 3, 4]) {
      const winner = peekToss(Rng.fromSeed(seed));
      const st = setup(seed);
      const s = startSession(st, kit, other(winner));
      expect(s.request?.kind).not.toBe("toss");
      const r = answerSession(s, st, kit, { seq: s.request?.seq ?? 0, path: [s.request?.screens[0]?.options.find((o) => o.legal)?.id ?? ""] });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const t = r.session.run?.events[0] as Toss;
      expect(t.t).toBe("toss");
      expect([t.period, t.winner, t.choice, t.receiver]).toEqual([1, winner, "defer", other(winner)]);
    }
  });

  it("an AI-only session logs the same opening toss as playGame", () => {
    const st = setup(7);
    const s = startSession(st, kit, null);
    expect(sessionRecord(s, st, kit).events[0]).toEqual(game(7).events[0]);
  });
});

describe("A4: the CLI text renderer", { timeout: 120_000 }, () => {
  it("prints a 'Coin toss:' line for the opening toss, before the first play line", () => {
    for (const seed of [1, 3, 8]) {
      const r = game(seed);
      const line = eventLine(r.events[0] as GameEvent, r, data);
      expect(line.startsWith("Coin toss:"), line).toBe(true);
      const lines = renderGame(r, data).split("\n");
      const tossAt = lines.findIndex((l) => l.startsWith("Coin toss:"));
      const firstPlay = lines.findIndex((l) => /^Q1 \d+:\d\d /.test(l));
      expect(tossAt).toBeGreaterThan(0);
      expect(firstPlay).toBeGreaterThan(tossAt);
      expect(lines.filter((l) => l.startsWith("Coin toss:"))).toHaveLength(1);
    }
  });

  it("the overtime toss line is not the opening 'Coin toss:' line and names overtime", () => {
    const [r] = overtimeGames("regularSeason", 1);
    expect(r).toBeDefined();
    if (r === undefined) return;
    const t = tosses(r).find((x) => x.period > REG) as Toss;
    const line = eventLine(t, r, data);
    expect(line.startsWith("Coin toss:")).toBe(false);
    expect(line).toMatch(/^OT coin toss:/);
  });
});

describe("A5: the toss event uses no extra Rng draws", { timeout: 120_000 }, () => {
  it("the Rng state after startGame equals the state after newGame alone", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const st = setup(seed);
      const a = Rng.fromSeed(seed);
      newGame(rules, { gameType: st.gameType, seed, rulesHash: data.rulesHash }, a);
      const b = Rng.fromSeed(seed);
      startGame(st, data, b);
      expect(b.getState(), `seed ${seed}`).toEqual(a.getState());
    }
  });

  it("play events match a run that never logged the opening toss", () => {
    for (const seed of [1, 2, 3, 99]) {
      const st = setup(seed);
      const rng = Rng.fromSeed(seed);
      const state = newGame(rules, { gameType: st.gameType, seed, rulesHash: data.rulesHash }, rng);
      // The same start as startGame, but with an empty log.
      let run: GameRun = { state, events: [], inputs: 1, snaps: 0, lastSnap: null };
      const players = gamePlayers(st, data);
      while (run.state.phase !== "final") run = stepGame(run, st, kit, players, rng);
      const bare = recordOf(run, st, data);
      const withToss = game(seed);
      expect(withToss.events.slice(1), `seed ${seed}`).toEqual(bare.events);
      expect(withToss.final).toEqual(bare.final);
      expect(bare.events.filter((e) => e.t === "toss" && e.period === 1)).toHaveLength(0);
    }
  });
});

describe("requestEvents never includes toss events", { timeout: 120_000 }, () => {
  it("over whole records, including overtime tosses", () => {
    const rs = [...SEEDS.slice(0, 5).map((s) => game(s)), ...overtimeGames("regularSeason", 2), ...overtimeGames("postseason", 2)];
    for (const r of rs) {
      expect(r.events.some((e) => e.t === "toss")).toBe(true);
      for (let from = 0; from < 3; from++) {
        const out = requestEvents(r.events, from);
        expect(out.some((e) => (e as { t: string }).t === "toss"), `seed ${r.seed} from ${from}`).toBe(false);
      }
    }
  });

  it("a toss-only log gives no request events", () => {
    const r = game(1);
    expect(requestEvents([r.events[0] as GameEvent], 0)).toEqual([]);
  });

  it("no request a human sees in a session carries a toss event", () => {
    const seed = 3;
    const st = setup(seed);
    const human = peekToss(Rng.fromSeed(seed));
    let s = startSession(st, kit, human);
    let n = 0;
    while (s.request !== null && n < 4000) {
      expect(s.request.events.some((e) => (e as { t: string }).t === "toss")).toBe(false);
      const legal = (s.request.screens[0]?.options ?? []).filter((o) => o.legal && o.id !== "timeout");
      const path: string[] = [];
      let screen = s.request.screens[0];
      let opt = legal[0];
      while (screen !== undefined && opt !== undefined) {
        path.push(opt.id);
        const opens = opt.opens;
        screen = opens === undefined ? undefined : s.request.screens.find((x) => x.id === opens);
        opt = screen?.options.find((o) => o.legal);
      }
      const r = answerSession(s, st, kit, { seq: s.request.seq, path });
      if (!r.ok) throw new Error(r.error.message);
      s = r.session;
      n++;
    }
    expect(s.run?.state.phase).toBe("final");
  });
});
