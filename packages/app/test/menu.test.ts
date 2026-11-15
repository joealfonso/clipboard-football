// The call menus over the engine's real requests: the seven-row cap on every screen (F3), off
// rows keep their number and only repeat their reason (F4), Same call is one key (F6, C1), key
// counts, Esc, and every path the menus submit is one the engine accepts (checkPath).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalog } from "@clipboard-football/shared";
import { checkPath } from "@clipboard-football/sim";
import type { DecisionRequest } from "../src/engine/types";
import { MAX_ROWS, current, openMenu, press, rows, type MenuData, type MenuKey, type MenuState } from "../src/ui/menu";
import { catalogLabels } from "../src/ui/text";
import { playGame } from "./support";

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/calls/catalog.json"), "utf8")) as Catalog;
const data: MenuData = { catalog, labels: { ...catalogLabels(catalog), shortPass: "Short pass", shotgun: "Shotgun" } };
const KEYS: readonly MenuKey[] = ["1", "2", "3", "4", "5", "6", "7", "T", "Esc", "Space"];

const games = [playGame(21, "home"), playGame(22, "away")];
const requests: DecisionRequest[] = games.flatMap((g) => g.requests);
const firstOf = <K extends DecisionRequest["kind"]>(kind: K, pred: (r: Extract<DecisionRequest, { kind: K }>) => boolean = () => true): Extract<DecisionRequest, { kind: K }> => {
  const r = requests.find((x): x is Extract<DecisionRequest, { kind: K }> => x.kind === kind && pred(x as Extract<DecisionRequest, { kind: K }>));
  if (r === undefined) throw new Error(`no ${kind} request in the scripted games`);
  return r;
};
const firstOption = (r: DecisionRequest, id: string) => r.screens[0]?.options.find((o) => o.id === id);

function run(m: MenuState, keys: readonly MenuKey[]): ReturnType<typeof press> {
  let last: ReturnType<typeof press> = { menu: m, effect: { t: "none" } };
  for (const k of keys) last = press(last.menu, k, data);
  return last;
}

describe("every real request (F3, F4, engine paths)", () => {
  it("the scripted games reach every kind a regulation game asks for", () => {
    const kinds = new Set(requests.map((r) => r.kind));
    for (const k of ["toss", "kickoff", "offenseCall", "defenseCall", "continue"]) expect(kinds, k).toContain(k);
  });

  it("every reachable screen has at most 7 rows, off rows carry a reason, and every submitted path is legal", () => {
    let submitted = 0;
    for (const req of requests) {
      const seen = new Set<string>();
      const stack: MenuState[] = [openMenu(req)];
      while (stack.length > 0) {
        const m = stack.pop() as MenuState;
        const id = JSON.stringify([m.screens, m.picks]);
        if (seen.has(id)) continue;
        seen.add(id);
        const list = rows(m, data);
        expect(list.length, current(m)).toBeLessThanOrEqual(MAX_ROWS);
        expect(new Set(list.map((r) => r.key)).size).toBe(list.length);
        for (const r of list) if (!r.on) expect(r.reason, `${current(m)} ${r.label}`).toBeDefined();
        for (const k of KEYS) {
          const { menu, effect } = press(m, k, data);
          if (effect.t === "submit") {
            expect(checkPath(req, effect.answer.path), effect.answer.path.join(" > ")).toBeNull();
            expect(effect.answer.seq).toBe(req.seq);
            submitted++;
          }
          stack.push(menu);
        }
      }
    }
    expect(submitted).toBeGreaterThan(1000);
  });
});

describe("the offense menus", () => {
  it("the first screen is Formation, Kick, Clock, Same call, T, Esc (formation first, Joseph)", () => {
    const r = rows(openMenu(firstOf("offenseCall")), data);
    expect(r.map((x) => `${x.key} ${x.label.replace(/:.*$/, "")}`)).toEqual(["1 Formation", "2 Kick", "3 Clock", "4 Same call", "T Timeout", "Esc Menu"]);
  });

  it("Formation opens the five formations, each opens Run or Pass", () => {
    const req = firstOf("offenseCall");
    const f = press(openMenu(req), "1", data).menu;
    expect(current(f)).toBe("offense.formation");
    expect(rows(f, data).map((x) => x.label)).toEqual(["Shotgun", "Under center", "Pistol", "Empty", "Heavy", "Back"]);
    const c = press(f, "1", data).menu;
    expect(current(c)).toBe("offense.playClass");
    expect(rows(c, data).map((x) => x.label)).toEqual(["Run", "Pass", "Back"]);
  });

  it("an off Kick keeps key 2 and only gives its reason", () => {
    const req = firstOf("offenseCall", (r) => firstOption(r, "kick")?.legal === false);
    const m = openMenu(req);
    expect(rows(m, data).find((x) => x.option === "kick")).toMatchObject({ key: "2", on: false, reason: "kickNotNow" });
    const r = press(m, "2", data);
    expect(r.effect).toEqual({ t: "reason", reason: "kickNotNow" });
    expect(r.menu).toBe(m);
  });

  it("a pass is four keys, formation first: Formation, the formation, Pass, the play", () => {
    const req = firstOf("offenseCall");
    expect(run(openMenu(req), ["1", "1", "2", "1"]).effect).toEqual({ t: "submit", answer: { seq: req.seq, path: ["formation", "shotgun", "pass", "shortPass"] } });
    expect(run(openMenu(req), ["1", "5", "1", "3"]).effect).toEqual({ t: "submit", answer: { seq: req.seq, path: ["formation", "heavy", "run", "qbSneak"] } });
  });

  it("a kick is two keys and the field goal row states the distance", () => {
    const req = firstOf("offenseCall", (r) => firstOption(r, "kick")?.legal === true);
    const kick = press(openMenu(req), "2", data).menu;
    expect(rows(kick, data).find((x) => x.option === "fieldGoal")?.label).toBe(`Field goal (${req.fieldGoalYards} yd)`);
    expect(run(openMenu(req), ["2", "1"]).effect).toEqual({ t: "submit", answer: { seq: req.seq, path: ["kick", "punt"] } });
  });

  it("Same call is one key and names the last call; off with its reason before any call", () => {
    const off = firstOf("offenseCall", (r) => r.sameCall === null);
    expect(press(openMenu(off), "4", data).effect).toEqual({ t: "reason", reason: "noEarlierCall" });
    const on = firstOf("offenseCall", (r) => firstOption(r, "sameCall")?.legal === true && r.sameCall?.formation !== undefined);
    const row = rows(openMenu(on), data).find((x) => x.option === "sameCall");
    expect(row?.label).toMatch(/^Same call: .+, .+$/);
    expect(press(openMenu(on), "4", data).effect).toEqual({ t: "submit", answer: { seq: on.seq, path: ["sameCall"] } });
  });

  it("Clock 3 to 5 set the tempo and mark the current one", () => {
    const req = firstOf("offenseCall");
    const clock = press(openMenu(req), "3", data).menu;
    expect(rows(clock, data).map((r) => r.label)).toEqual(["Spike", "Kneel", "Hurry-up", "Normal", "Run the clock", "Back"]);
    expect(rows(clock, data).find((r) => r.option === req.tempo)?.note).toBe("now");
    expect(press(clock, "3", data).effect).toEqual({ t: "submit", answer: { seq: req.seq, path: ["clock", "hurryUp"] } });
  });

  it("Timeout is T on the first screen only, and Esc goes back, or to the pause menu first", () => {
    const req = firstOf("offenseCall");
    const m = openMenu(req);
    const deep = run(m, ["1", "1"]).menu;
    expect(current(deep)).toBe("offense.playClass");
    expect(rows(deep, data).some((r) => r.key === "T")).toBe(false);
    const back = press(deep, "Esc", data).menu;
    expect(current(back)).toBe("offense.formation");
    expect(back.picks).toEqual(["formation"]);
    expect(press(m, "Esc", data).effect).toEqual({ t: "pause" });
  });
});

describe("other requests", () => {
  it("a defense call is two keys", () => {
    const req = firstOf("defenseCall");
    expect(run(openMenu(req), ["3", "2"]).effect).toEqual({ t: "submit", answer: { seq: req.seq, path: ["dime", "dimeCover0Blitz"] } });
  });

  it("a continue dead ball is Space (plus T when a timeout is offered) and Esc", () => {
    const req = firstOf("continue");
    const keys = rows(openMenu(req), data).map((r) => r.key);
    expect(keys[0]).toBe("Space");
    expect(keys[keys.length - 1]).toBe("Esc");
    expect(press(openMenu(req), "Space", data).effect).toEqual({ t: "submit", answer: { seq: req.seq, path: ["continue"] } });
  });

  it("the toss is Receive or Defer", () => {
    const req = firstOf("toss");
    expect(rows(openMenu(req), data).map((r) => `${r.key} ${r.label}`)).toEqual(["1 Receive", "2 Defer", "Esc Menu"]);
  });

  it("keys with no row do nothing", () => {
    const m = openMenu(firstOf("continue"));
    expect(press(m, "7", data)).toEqual({ menu: m, effect: { t: "none" } });
  });
});
