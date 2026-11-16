// Click to pick (Joseph: "don't require pressing enter to pick an option. a simple click should
// work"). A press and release on one row of one screen pick it through the same path as its key,
// even when the panel is rebuilt in between; an off row (Kick outside 4th down, Continue with no
// save) only gives its reason on a click, as on its key.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalog } from "@clipboard-football/shared";
import type { DecisionRequest } from "../src/engine/types";
import { ClickPicker, clickPicks } from "../src/ui/click";
import { openMenu, press, rows, type MenuData, type MenuKey, type MenuState } from "../src/ui/menu";
import { pickRow, settingsScreen, titleScreen, type ScreenModel } from "../src/ui/screens";
import { catalogLabels } from "../src/ui/text";
import { playGame } from "./support";

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, "../../../data/calls/catalog.json"), "utf8")) as Catalog;
const data: MenuData = { catalog, labels: catalogLabels(catalog) };
const requests: DecisionRequest[] = playGame(21, "home").requests;
const offenseCall = (kickLegal: boolean): DecisionRequest => {
  const r = requests.find((x) => x.kind === "offenseCall" && x.screens[0]?.options.find((o) => o.id === "kick")?.legal === kickLegal);
  if (r === undefined) throw new Error(`no offense call with kick legal = ${String(kickLegal)}`);
  return r;
};

/** A plain click: press and release on the same row of the same screen. */
function click(p: ClickPicker<unknown>, key: string | null, screen: unknown): string | null {
  p.down(key, screen, 0);
  return p.up(key, screen, 0);
}

/** A click on an in-game menu, as the app does it: the key it yields goes through press(). */
function clickMenu(m: MenuState, key: MenuKey): ReturnType<typeof press> {
  const picked = click(new ClickPicker<unknown>(), key, m);
  return picked === null ? { menu: m, effect: { t: "none" } } : press(m, picked as MenuKey, data);
}

describe("press and release (ClickPicker)", () => {
  it("one click on a row picks it: no Enter, no second click", () => {
    const p = new ClickPicker<unknown>();
    const screen = {};
    expect(click(p, "3", screen)).toBe("3");
  });

  it("release over another row, off every row, or after a press off every row picks nothing", () => {
    const p = new ClickPicker<unknown>();
    const screen = {};
    p.down("1", screen, 0);
    expect(p.up("2", screen, 0)).toBeNull();
    p.down("1", screen, 0);
    expect(p.up(null, screen, 0)).toBeNull();
    p.down(null, screen, 0);
    expect(p.up("1", screen, 0)).toBeNull();
  });

  it("a release on a different screen picks nothing, even over the same key", () => {
    const p = new ClickPicker<unknown>();
    p.down("1", { screen: "formation" }, 0);
    expect(p.up("1", { screen: "runOrPass" }, 0)).toBeNull();
  });

  it("only the primary button picks", () => {
    const p = new ClickPicker<unknown>();
    const screen = {};
    p.down("1", screen, 2);
    expect(p.up("1", screen, 2)).toBeNull();
    p.down("1", screen, 0);
    expect(p.up("1", screen, 1)).toBeNull();
  });

  it("a cancelled pointer picks nothing, and a release picks once", () => {
    const p = new ClickPicker<unknown>();
    const screen = {};
    p.down("1", screen, 0);
    p.cancel();
    expect(p.up("1", screen, 0)).toBeNull();
    expect(click(p, "1", screen)).toBe("1");
    expect(p.up("1", screen, 0)).toBeNull();
  });

  it("a click event picks only when no pointer made it: a late touch click on the next screen never picks a second row", () => {
    // Space on a focused row and assistive tech send a click with detail 0.
    expect(clickPicks(0)).toBe(true);
    // Mouse, touch and pen clicks (detail 1 and up) were already picked on pointer up.
    expect(clickPicks(1)).toBe(false);
    expect(clickPicks(2)).toBe(false);
  });

  it("a press with a modifier held (passed as no row) picks nothing", () => {
    const p = new ClickPicker<unknown>();
    const screen = {};
    p.down(null, screen, 0);
    expect(p.up("1", screen, 0)).toBeNull();
  });
});

describe("a click picks in the game menus", () => {
  it("a click on Formation opens the formations, as its key does", () => {
    const m = openMenu(offenseCall(false));
    const formation = rows(m, data).find((r) => r.option === "formation");
    expect(formation?.on).toBe(true);
    const viaClick = clickMenu(m, formation?.key as MenuKey);
    expect(viaClick).toEqual(press(m, formation?.key as MenuKey, data));
    expect(viaClick.menu.screens.length).toBe(2);
  });

  it("a click on a formation card, then Pass, then a play card submits the call", () => {
    let m = openMenu(offenseCall(false));
    const pickOption = (option: string): void => {
      const r = rows(m, data).find((x) => x.option === option);
      if (r === undefined) throw new Error(`no ${option} row`);
      const out = clickMenu(m, r.key);
      m = out.menu;
      if (out.effect.t === "submit") m = { ...m, screens: ["submitted"] };
    };
    pickOption("formation");
    const formation = rows(m, data).find((r) => r.on && r.option !== undefined);
    pickOption(formation?.option as string);
    pickOption("pass");
    const play = rows(m, data).find((r) => r.on && r.option !== undefined);
    const last = clickMenu(m, play?.key as MenuKey);
    expect(last.effect.t).toBe("submit");
  });

  it("an off Kick (not 4th down) does not pick on a click: only its reason, the screen stays", () => {
    const m = openMenu(offenseCall(false));
    const kick = rows(m, data).find((r) => r.option === "kick");
    expect(kick).toMatchObject({ on: false, reason: "kickNotNow" });
    const out = clickMenu(m, kick?.key as MenuKey);
    expect(out.effect).toEqual({ t: "reason", reason: "kickNotNow" });
    expect(out.menu).toBe(m);
  });

  it("an on Kick picks on a click", () => {
    const m = openMenu(offenseCall(true));
    const kick = rows(m, data).find((r) => r.option === "kick");
    expect(kick?.on).toBe(true);
    const out = clickMenu(m, kick?.key as MenuKey);
    expect(out.menu).not.toBe(m);
    expect(out.effect.t).not.toBe("reason");
  });
});

describe("a click picks on the overlay screens (title, settings)", () => {
  /** A click on a screen, as the app does it: the key it yields goes through pickRow(). */
  const clickScreen = (model: ScreenModel, key: string): ReturnType<typeof pickRow> => {
    const picked = click(new ClickPicker<unknown>(), key, model);
    return picked === null ? { t: "none" } : pickRow(model, picked);
  };

  it("New game and Settings act on one click", () => {
    const t = titleScreen({ hasSave: true, storage: true });
    expect(clickScreen(t, "1")).toMatchObject({ t: "act", row: { action: "newGame" } });
    expect(clickScreen(t, "3")).toMatchObject({ t: "act", row: { action: "settings" } });
    const s = settingsScreen({ textSize: 100, reducedMotion: "system", markLabels: "involved" });
    const first = s.rows[0];
    expect(clickScreen(s, first?.key as string)).toEqual({ t: "act", row: first });
  });

  it("an off Continue (no saved game) does not act on a click: only its reason", () => {
    const t = titleScreen({ hasSave: false, storage: true });
    expect(clickScreen(t, "2")).toEqual({ t: "reason", text: "Continue: no saved game." });
  });

  it("a key with no row does nothing", () => {
    expect(pickRow(titleScreen({ hasSave: true, storage: true }), "7")).toEqual({ t: "none" });
  });
});
