// Calling screen pass Q2 (docs/specs/m2-calling-screen-pass.md): the game log, one key away. L opens
// and closes the Game log tab from the calling screen and the pause menu and adds no choice (GL1);
// driveStarts matches boxScore's drives (GL2); newest first, the open drive on top (GL3); one row per
// play with the U2 result line (GL4).

import { beforeAll, describe, expect, it } from "vitest";
import { playStands } from "@clipboard-football/sim";
import type { FromWorker } from "../src/engine/protocol";
import type { GameEvent, PlayEvent } from "../src/engine/types";
import { driveSpans, driveStarts, logRows } from "../src/ui/gamelog";
import { boxScreen, pauseScreen } from "../src/ui/screens";
import { clockText, playResultText, yardLineText } from "../src/ui/text";
import { appHarness, appLabels, installFakeDom, type FakeEl } from "./fake-dom";
import { prepared } from "./support";
import { ctxOf, simGames } from "./sim-games";

const GAMES = 100;
const rules = prepared().data.engine.rules;
const driveRules = { scoring: rules.scoring, regulationPeriods: rules.game.regulationPeriods, periodsPerHalf: rules.game.periodsPerHalf };
const SCRIMMAGE = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);

beforeAll(() => installFakeDom(1280, 720));

const key = (k: string): KeyboardEvent => ({ key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => undefined }) as unknown as KeyboardEvent;

describe("GL1: L opens the box score on Game log from the calling screen and the pause menu, and closes it", () => {
  function harness(): ReturnType<typeof appHarness> & { sent: unknown[] } {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
    const sent: unknown[] = [];
    Object.assign(h.app, { client: { send: (m: unknown) => sent.push(m) }, render: () => undefined, screenTrail: { open: () => undefined, close: () => 0 }, layoutNow: { tooSmall: false } });
    return Object.assign(h, { sent });
  }
  const stack = (h: ReturnType<typeof appHarness>): { id: string; tab?: string }[] => h.app["stack"] as { id: string; tab?: string }[];

  it("from the calling screen: L opens Game log, L closes it", () => {
    const h = harness();
    h.call("onKey", key("l"));
    expect(stack(h).at(-1)).toEqual({ id: "box", tab: "Game log" });
    // The request carries the game and its event count (code review R1); the worker echoes them.
    expect(h.sent).toContainEqual(expect.objectContaining({ t: "box" }));
    const game = h.game as unknown as { matchup: { seed: number }; events: unknown[] };
    expect(h.sent.find((m) => (m as { t: string }).t === "box")).toEqual({ t: "box", tag: { seed: game.matchup.seed, events: game.events.length } });
    h.call("onKey", key("L"));
    expect(stack(h).map((o) => o.id)).toEqual(["game"]);
  });

  it("from the pause menu, and Esc goes back to where it was opened", () => {
    const h = harness();
    stack(h).push({ id: "pause" });
    h.call("onKey", key("l"));
    expect(stack(h).map((o) => o.id)).toEqual(["game", "pause", "box"]);
    h.call("onKey", key("Escape"));
    expect(stack(h).map((o) => o.id)).toEqual(["game", "pause"]);
  });

  it("does nothing during a play", () => {
    const h = harness();
    Object.assign(h.app, { animating: true, animator: { skip: () => undefined } });
    h.call("onKey", key("l"));
    expect(stack(h).map((o) => o.id)).toEqual(["game"]);
  });

  it("no screen gains a choice: the box score has 6 rows with tab 5 Game log, the pause menu 7", () => {
    const box = boxScreen("Game log");
    expect(box.rows).toHaveLength(6);
    expect(box.rows[4]).toMatchObject({ key: "5", label: "Game log", note: "shown" });
    const pause = pauseScreen({ hasPlay: true, speed: "1x" });
    expect(pause.rows).toHaveLength(7);
    expect(pause.rows[2]).toMatchObject({ label: "Box score", note: "L" });
  });
});

describe(`GL2: over ${GAMES} simulated games, driveStarts gives boxScore's drives`, () => {
  it("the same number of drives, each with the same team, start spot and play count", { timeout: 600_000 }, () => {
    let drives = 0;
    for (const g of simGames(GAMES)) {
      const sent: FromWorker[] = [];
      const s = g.session as unknown as { handle(m: unknown): void; send?: unknown };
      // The Session sends the box to its own callback; read it back from the recorded messages.
      const before = g.sent.length;
      s.handle({ t: "box" });
      const boxMsg = g.sent.slice(before).find((m) => m.t === "box") ?? sent.find((m) => m.t === "box");
      if (boxMsg === undefined || boxMsg.t !== "box") throw new Error("no box");
      const box = boxMsg.box;
      const spans = driveSpans(g.events, driveRules);
      expect(spans.length, `seed ${g.seed}`).toBe(box.drives.length);
      expect(driveStarts(g.events, driveRules)).toEqual(spans.map((x) => x.start));
      spans.forEach((sp, i) => {
        const d = box.drives[i];
        const first = g.events[sp.start] as PlayEvent;
        expect(sp.team, `seed ${g.seed} drive ${i}`).toBe(d?.team);
        expect(first.before.spot, `seed ${g.seed} drive ${i}`).toBe(d?.start);
        const plays = g.events.slice(sp.start, sp.end + 1).filter((e): e is PlayEvent => e.t === "play" && SCRIMMAGE.has(e.play.kind) && e.before.phase === "scrimmage" && playStands(e, rules)).length;
        expect(plays, `seed ${g.seed} drive ${i}`).toBe(d?.plays);
        drives++;
      });
    }
    expect(drives).toBeGreaterThan(GAMES * 15);
  });
});

describe("GL3 and GL4: newest first, one row per play", () => {
  const hasLine = (e: GameEvent): boolean => e.t !== "play" && e.t !== "runoff";

  it("mid-game: the first header is the open drive, the first play row is the last play", () => {
    let openSeen = 0;
    for (const g of simGames(10)) {
      for (const cut of [60, 80, 120, 150, 180, 220, 260]) {
        const evs = g.events.slice(0, cut);
        const spans = driveSpans(evs, driveRules);
        const rows = logRows(evs, spans, hasLine);
        const lastPlay = evs.map((e, i) => (e.t === "play" ? i : -1)).filter((i) => i >= 0).at(-1);
        expect(rows.find((r) => r.t === "play")).toEqual({ t: "play", index: lastPlay });
        const open = spans.at(-1);
        if (open?.open === true && lastPlay !== undefined && lastPlay <= open.end) {
          // GL3 names the first drive header (an event row after the last snap, a timeout say, may sit above it).
          expect(rows.find((r) => r.t === "drive")).toEqual({ t: "drive", drive: spans.length - 1 });
          // Nothing but loop events sits above it: no play row of an older drive.
          const at = rows.findIndex((r) => r.t === "drive");
          expect(rows.slice(0, at).every((r) => r.t === "event")).toBe(true);
          openSeen++;
        }
        // Every drive header once, newest first.
        expect(rows.filter((r) => r.t === "drive").map((r) => (r as { drive: number }).drive)).toEqual(spans.map((_, i) => i).reverse());
      }
    }
    // Test-writer: the open-drive case must actually be reached, or the check above proves nothing.
    expect(openSeen, "cuts with a drive in progress").toBeGreaterThan(10);
  });

  it("every play event has exactly one play row; kickoffs and tries are outside any drive", () => {
    for (const g of simGames(GAMES)) {
      const spans = driveSpans(g.events, driveRules);
      const rows = logRows(g.events, spans, hasLine);
      const playRows = rows.filter((r) => r.t === "play").map((r) => (r as { index: number }).index);
      const plays = g.events.map((e, i) => (e.t === "play" ? i : -1)).filter((i) => i >= 0);
      expect([...playRows].sort((a, b) => a - b)).toEqual(plays);
      for (const i of plays) {
        const e = g.events[i] as PlayEvent;
        const inDrive = spans.some((s) => s.start <= i && i <= s.end);
        if (e.play.kind === "kickoff" || e.play.kind === "onsideKick" || e.before.phase === "try") expect(inDrive, `seed ${g.seed} event ${i}`).toBe(false);
      }
    }
  });

  it("the tab's rows: each play row's result line is the U2 line without the next-situation tail", () => {
    const labels = appLabels();
    for (const g of simGames(5)) {
      const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
      h.game["state"] = { ...(g.state as object) };
      const body = h.call<FakeEl[]>("gameLogBody", h.game);
      const list = body[0] as FakeEl;
      expect(list.getAttribute("aria-label")).toBe("Game log, newest first");
      expect(list.getAttribute("tabindex")).toBe("0");
      const playRows = list.querySelectorAll(".log-play");
      expect(playRows).toHaveLength(g.plays.length);
      const ctx = ctxOf(g, labels);
      const newestFirst = [...g.plays].reverse();
      playRows.forEach((r, i) => {
        const ev = newestFirst[i] as PlayEvent;
        expect(r.querySelector(".result")?.textContent).toBe(playResultText(ev, ctx));
        expect(r.querySelector(".result")?.textContent).not.toMatch(/ ball, /);
      });
      // With no box yet, drive headers say their totals are loading; the game is over, so none is in progress.
      const heads = list.querySelectorAll(".log-head").map((x) => x.textContent);
      expect(heads.length).toBeGreaterThan(0);
      for (const t of heads) expect(t).toMatch(/drive, started (OWN|OPP) \d+\. Loading drive totals\.\.\.$|drive, started 50\. Loading drive totals\.\.\.$/);
      // Test-writer: once the box arrives, each header carries that drive's box figures (Q2 Layout), newest first.
      const before = g.sent.length;
      (g.session as unknown as { handle(m: unknown): void }).handle({ t: "box" });
      const boxMsg = g.sent.slice(before).find((m) => m.t === "box");
      if (boxMsg === undefined || boxMsg.t !== "box") throw new Error("no box");
      h.app["box"] = { box: boxMsg.box, players: [] };
      const withBox = (h.call<FakeEl[]>("gameLogBody", h.game)[0] as FakeEl).querySelectorAll(".log-head").map((x) => x.textContent);
      const RESULT: Record<string, string> = { touchdown: "Touchdown", fieldGoal: "Field goal", missedFieldGoal: "Missed field goal", punt: "Punt", turnover: "Turnover", downs: "Turnover on downs", endOfHalf: "End of half", safety: "Safety" };
      expect(withBox).toHaveLength(boxMsg.box.drives.length);
      [...boxMsg.box.drives].reverse().forEach((d, i) => {
        const where = yardLineText(d.start, d.team, g.human);
        expect(RESULT[d.result], `a word for ${d.result}`).toBeDefined();
        expect(withBox[i]).toBe(` ${g.matchup[d.team].nickname} drive, started ${where}: ${d.plays} play${d.plays === 1 ? "" : "s"}, ${d.yards} yds, ${clockText(d.seconds)}. ${RESULT[d.result] as string}.`);
      });
    }
  });

  it("a grouping mismatch with the box score shows no headers, never a wrong one", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
    h.app["box"] = { box: { drives: [] } as unknown as never, players: [] };
    const list = (h.call<FakeEl[]>("gameLogBody", h.game)[0] as FakeEl);
    expect(list.querySelectorAll(".log-head")).toHaveLength(0);
    expect(list.querySelectorAll(".log-play")).toHaveLength(g.plays.length);
  });

  it('no plays yet: "No plays yet."', () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [] });
    expect(h.call<FakeEl[]>("gameLogBody", h.game).map((e) => e.textContent)).toEqual(["No plays yet."]);
  });
});

describe("code review S1 and S2: the log is built once per event, and a stale box is never used", () => {
  it("S1: two renders with no new event give the same list node (its focus and scroll are kept)", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
    const a = h.call<FakeEl[]>("gameLogBody", h.game)[0];
    const b = h.call<FakeEl[]>("gameLogBody", h.game)[0];
    expect(b).toBe(a);
    (h.game["events"] as GameEvent[]).pop();
    expect(h.call<FakeEl[]>("gameLogBody", h.game)[0]).not.toBe(a);
  });

  it("S2: a box built over fewer events, or for another game, shows loading totals and no warning", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
    const warns: unknown[] = [];
    const orig = console.warn;
    console.warn = (...x: unknown[]) => void warns.push(x);
    try {
      for (const stale of [{ events: g.events.length - 5, seed: g.matchup.seed }, { events: g.events.length, seed: g.matchup.seed + 1 }]) {
        h.app["logCache"] = null;
        h.app["box"] = { box: { drives: [] } as unknown as never, players: [], ...stale };
        const list = h.call<FakeEl[]>("gameLogBody", h.game)[0] as FakeEl;
        const heads = list.querySelectorAll(".log-head").map((x) => x.textContent);
        expect(heads.length).toBeGreaterThan(0);
        for (const t of heads) expect(t).toContain("Loading drive totals...");
      }
      expect(warns).toEqual([]);
    } finally {
      console.warn = orig;
    }
  });
});

describe("a timeout during the drive in progress sits inside that drive's group", () => {
  it("newest first: the open drive's header, then the timeout, then its plays", () => {
    const hasLine = (e: GameEvent): boolean => e.t !== "play" && e.t !== "runoff";
    let checked = 0;
    for (const g of simGames(10)) {
      for (let cut = 60; cut < g.events.length; cut += 37) {
        const evs = g.events.slice(0, cut);
        const spans = driveSpans(evs, driveRules);
        const open = spans.at(-1);
        const last = evs.at(-1);
        if (open === undefined || !open.open || last?.t !== "play" || last.before.phase !== "scrimmage") continue;
        const timeout: GameEvent = { t: "timeout", before: last.after, team: last.after.possession, side: "offense", left: 1 } as GameEvent;
        const withTimeout = [...evs, timeout];
        const rows = logRows(withTimeout, driveSpans(withTimeout, driveRules), hasLine);
        expect(rows[0]).toEqual({ t: "drive", drive: spans.length - 1 });
        expect(rows[1]).toEqual({ t: "event", index: withTimeout.length - 1 });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});
