// The call menus as a state machine: the seven-row cap on every screen (F3), off rows keep their
// number and only repeat their reason (F4), Same call submits exactly the last call and leaves the
// tempo alone (F6), key counts (C1), formation before the play (decision 6), Esc goes back.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalog, Situation } from "@clipboard-football/shared";
import { indexOf, offenseOptions } from "../src/engine/adapter";
import type { DecisionRequest, Option } from "../src/engine/types";
import { MAX_ROWS, current, openMenu, press, rows, type MenuData, type MenuKey, type MenuState } from "../src/ui/menu";
import { catalogLabels } from "../src/ui/text";
import { snap } from "./fixtures";

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/calls/catalog.json"), "utf8")) as Catalog;
const data: MenuData = { catalog, labels: { ...catalogLabels(catalog), shortPass: "Short pass" } };
const ix = indexOf(catalog);

function sit(over: Partial<Situation> = {}): Situation {
  return { phase: "scrimmage", down: 1, yardsToGo: 10, yardLine100: 60, scoreDiff: 0, quarter: 1, secondsLeftInHalf: 1700, secondsLeftInGame: 3500, offenseTimeouts: 3, defenseTimeouts: 3, clockRunning: 1, otBothPossessed: 0, ...over };
}

const base = { seq: 1, team: "home" as const, view: snap(), timeout: { on: true, left: 3 } };

function offenseReq(over: Partial<Situation> = {}, sameCall: Extract<DecisionRequest, { kind: "offenseCall" }>["sameCall"] = { on: false, reason: "noEarlierCall" }): Extract<DecisionRequest, { kind: "offenseCall" }> {
  return { ...base, kind: "offenseCall", calls: offenseOptions(ix, sit(over)), sameCall, tempo: "normal", fieldGoalDistance: 47 };
}

const defenseReq: Extract<DecisionRequest, { kind: "defenseCall" }> = { ...base, kind: "defenseCall", calls: ix.defenseLeaves.map((id): Option => ({ id, on: true })), sameCall: { on: true, defense: "nickelCover1Blitz" }, twoPoint: false };

const tryReq: Extract<DecisionRequest, { kind: "try" }> = {
  ...base,
  kind: "try",
  options: [
    { id: "extraPoint", on: true },
    { id: "goForTwo", on: true },
  ],
  calls: offenseOptions(ix, sit({ phase: "try", yardLine100: 2, yardsToGo: 2 })),
  sameCall: { on: true, offense: { call: "goForTwo", twoPointPlay: "insideRun", formation: "heavy" } },
};

const REQUESTS: readonly DecisionRequest[] = [
  offenseReq(),
  offenseReq({ down: 4 }, { on: true, offense: { call: "shortPass", formation: "shotgun" } }),
  defenseReq,
  tryReq,
  { ...base, kind: "kickoffType", options: [{ id: "kickoff", on: true }, { id: "onsideKick", on: false, reason: "onsideNotAllowed" }], safetyKick: false },
  { ...base, kind: "continue", lineUp: "punt" },
  { ...base, kind: "penaltyChoice", choices: [{ option: { kind: "accept", foul: 0 }, after: snap() }, { option: { kind: "decline" }, after: snap() }], pending: { before: snap(), offense: { call: "punt" }, defense: null, play: { kind: "noPlay", seconds: 0 } } },
  { ...base, kind: "runoff", seconds: 10, clockAfter: 0 },
  { ...base, kind: "challenge", closeCall: { kind: "fumble", question: "downBeforeFumble" }, pending: { before: snap(), offense: { call: "insideRun", formation: "shotgun" }, defense: "baseCover3", play: { kind: "noPlay", seconds: 0 } } },
  { ...base, kind: "coinToss", options: [{ id: "receive", on: true }, { id: "defer", on: true }] },
];

const KEYS: readonly MenuKey[] = ["1", "2", "3", "4", "5", "6", "7", "T", "Esc", "Space"];

/** Every menu state reachable from a request by key presses. */
function reachable(req: DecisionRequest): MenuState[] {
  const seen = new Map<string, MenuState>();
  const stack = [openMenu(req)];
  while (stack.length > 0) {
    const m = stack.pop() as MenuState;
    const id = JSON.stringify([m.path, m.formation, m.playType]);
    if (seen.has(id)) continue;
    seen.set(id, m);
    for (const k of KEYS) stack.push(press(m, k, data).menu);
  }
  return [...seen.values()];
}

describe("seven-row cap (F3)", () => {
  it.each(REQUESTS.map((r) => [r.kind, r] as const))("every screen reachable from a %s request has at most 7 rows", (_k, req) => {
    const states = reachable(req);
    expect(states.length).toBeGreaterThan(0);
    for (const m of states) expect(rows(m, data).length, `${current(m)}`).toBeLessThanOrEqual(MAX_ROWS);
  });

  it("the offense Play type screen is exactly Run, Pass, Kick, Clock, Same call, T, Esc", () => {
    const r = rows(openMenu(offenseReq()), data);
    expect(r.map((x) => `${x.key} ${x.label}`)).toEqual(["1 Run", "2 Pass", "3 Kick", "4 Clock", "5 Same call", "T Timeout", "Esc Menu"]);
  });

  it("the Nickel screen is six plays plus Back", () => {
    const m = press(openMenu(defenseReq), "2", data).menu;
    expect(rows(m, data).map((x) => x.key)).toEqual(["1", "2", "3", "4", "5", "6", "Esc"]);
  });
});

describe("off choices (F4, decision 9)", () => {
  it("Kick is off outside 4th down and the last 2:00, keeps key 3, and pressing it only gives the reason", () => {
    const m = openMenu(offenseReq({ down: 2 }));
    const kick = rows(m, data).find((r) => r.label === "Kick");
    expect(kick).toMatchObject({ key: "3", on: false, reason: "kickWindow" });
    const r = press(m, "3", data);
    expect(r.effect).toEqual({ t: "reason", reason: "kickWindow" });
    expect(r.menu).toBe(m);
  });

  it("Kick is on on 4th down and in the last 2:00 of a half", () => {
    expect(rows(openMenu(offenseReq({ down: 4 })), data).find((r) => r.label === "Kick")?.on).toBe(true);
    expect(rows(openMenu(offenseReq({ down: 2, secondsLeftInHalf: 110 })), data).find((r) => r.label === "Kick")?.on).toBe(true);
  });

  it("on a two-point try Kick and Clock are off, Run and Pass on, numbers unchanged", () => {
    const m = press(openMenu(tryReq), "2", data).menu;
    const r = rows(m, data);
    expect(r.slice(0, 4).map((x) => [x.key, x.label, x.on])).toEqual([
      ["1", "Run", true],
      ["2", "Pass", true],
      ["3", "Kick", false],
      ["4", "Clock", false],
    ]);
    expect(r.find((x) => x.label === "Kick")?.reason).toBe("notOnTry");
  });

  it("Same call is off with no earlier call and says why", () => {
    const m = openMenu(offenseReq());
    const same = rows(m, data).find((r) => r.same === true);
    expect(same).toMatchObject({ key: "5", on: false, reason: "noEarlierCall" });
    expect(press(m, "5", data).effect).toEqual({ t: "reason", reason: "noEarlierCall" });
  });

  it("T is dimmed with its reason when no timeouts are left", () => {
    const req = { ...offenseReq(), timeout: { on: false, left: 0, reason: "noTimeouts" as const } };
    const m = openMenu(req);
    expect(rows(m, data).find((r) => r.key === "T")).toMatchObject({ on: false, reason: "noTimeouts" });
    expect(press(m, "T", data).effect).toEqual({ t: "reason", reason: "noTimeouts" });
  });

  it("an off onside kick keeps key 2", () => {
    const m = openMenu(REQUESTS[4] as DecisionRequest);
    expect(rows(m, data)[1]).toMatchObject({ key: "2", label: "Onside kick", on: false, reason: "onsideNotAllowed" });
    expect(press(m, "2", data).effect.t).toBe("reason");
  });
});

describe("Same call (F6, C1)", () => {
  it("submits exactly the side's last call, in one key", () => {
    const req = offenseReq({}, { on: true, offense: { call: "shortPass", formation: "shotgun" } });
    const m = openMenu(req);
    expect(rows(m, data).find((r) => r.same === true)?.label).toBe("Same call: Shotgun, Short pass");
    expect(press(m, "5", data).effect).toEqual({ t: "submit", answer: { kind: "offense", call: { call: "shortPass", formation: "shotgun" } } });
  });

  it("on defense too", () => {
    expect(press(openMenu(defenseReq), "5", data).effect).toEqual({ t: "submit", answer: { kind: "defense", call: "nickelCover1Blitz" } });
  });

  it("never sends a tempo answer", () => {
    const req = offenseReq({}, { on: true, offense: { call: "punt" } });
    const e = press(openMenu(req), "5", data).effect;
    expect(e.t === "submit" && e.answer.kind).toBe("offense");
  });

  it("on the two-point Play type screen it submits the two-point version of the last run or pass", () => {
    const m = press(openMenu(tryReq), "2", data).menu;
    expect(press(m, "5", data).effect).toEqual({ t: "submit", answer: { kind: "offense", call: { call: "goForTwo", twoPointPlay: "insideRun", formation: "heavy" } } });
  });
});

describe("key counts and order (C1, decisions 6 and 7)", () => {
  const run = (m: MenuState, keys: readonly MenuKey[]): ReturnType<typeof press> => {
    let last: ReturnType<typeof press> = { menu: m, effect: { t: "none" } };
    for (const k of keys) last = press(last.menu, k, data);
    return last;
  };

  it("a pass takes three keys: Pass, formation, play; the last key snaps", () => {
    const r = run(openMenu(offenseReq()), ["2", "1", "1"]);
    expect(r.effect).toEqual({ t: "submit", answer: { kind: "offense", call: { call: "shortPass", formation: "shotgun" } } });
  });

  it("a run takes three keys and the formation comes first", () => {
    const m1 = press(openMenu(offenseReq()), "1", data).menu;
    expect(current(m1)).toBe("offense.formation");
    const r = run(openMenu(offenseReq()), ["1", "5", "3"]);
    expect(r.effect).toEqual({ t: "submit", answer: { kind: "offense", call: { call: "qbSneak", formation: "heavy" } } });
  });

  it("a kick takes two keys", () => {
    const r = run(openMenu(offenseReq({ down: 4 })), ["3", "1"]);
    expect(r.effect).toEqual({ t: "submit", answer: { kind: "offense", call: { call: "punt" } } });
  });

  it("the field goal row states the distance as a fact", () => {
    const m = press(openMenu(offenseReq({ down: 4 })), "3", data).menu;
    expect(rows(m, data).find((r) => r.key === "2")?.label).toBe("Field goal (47 yd)");
  });

  it("a defense call takes two keys", () => {
    const r = run(openMenu(defenseReq), ["3", "2"]);
    expect(r.effect).toEqual({ t: "submit", answer: { kind: "defense", call: "dimeCover0Blitz" } });
  });

  it("a kneel takes two keys", () => {
    expect(run(openMenu(offenseReq()), ["4", "2"]).effect).toEqual({ t: "submit", answer: { kind: "offense", call: { call: "kneel" } } });
  });

  it("Esc goes back one screen, and on a first screen opens the pause menu", () => {
    const m = openMenu(offenseReq());
    const deep = press(press(m, "2", data).menu, "1", data).menu;
    expect(current(deep)).toBe("offense.pass");
    const back = press(deep, "Esc", data).menu;
    expect(current(back)).toBe("offense.formation");
    expect(back.formation).toBeUndefined();
    expect(current(press(back, "Esc", data).menu)).toBe("offense.playType");
    expect(press(m, "Esc", data).effect).toEqual({ t: "pause" });
  });

  it("Timeout is only on the first screen", () => {
    const m = press(openMenu(offenseReq()), "2", data).menu;
    expect(rows(m, data).some((r) => r.key === "T")).toBe(false);
    expect(press(openMenu(offenseReq()), "T", data).effect).toEqual({ t: "submit", answer: { kind: "timeout" } });
  });

  it("Clock 3 to 5 set the tempo and return to Play type", () => {
    const clock = press(openMenu(offenseReq()), "4", data).menu;
    expect(rows(clock, data).map((r) => r.label)).toEqual(["Spike", "Kneel", "Hurry-up", "Normal", "Run the clock", "Back"]);
    const r = press(clock, "3", data);
    expect(r.effect).toEqual({ t: "submit", answer: { kind: "tempo", tempo: "hurryUp" } });
    expect(current(r.menu)).toBe("offense.playType");
  });

  it("a continue dead ball is Space, T and Esc", () => {
    const m = openMenu(REQUESTS[5] as DecisionRequest);
    expect(rows(m, data).map((r) => r.key)).toEqual(["Space", "T", "Esc"]);
    expect(press(m, "Space", data).effect).toEqual({ t: "submit", answer: { kind: "continue" } });
  });

  it("a penalty choice submits the option's index", () => {
    const m = openMenu(REQUESTS[6] as DecisionRequest);
    expect(press(m, "2", data).effect).toEqual({ t: "submit", answer: { kind: "penalty", index: 1 } });
  });

  it("keys with no row do nothing", () => {
    const m = openMenu(REQUESTS[5] as DecisionRequest);
    expect(press(m, "7", data)).toEqual({ menu: m, effect: { t: "none" } });
  });
});
