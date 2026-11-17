// Calling screen pass Q3 (docs/specs/m2-calling-screen-pass.md): the player card on the calling
// screen opens over the call column, under the plate, down to the legend, and never covers the
// plate or the board (PC1); while it is open the covered call card is inert: no number key, T or
// Enter reaches the menu, and Esc closes it and gives focus back (PC2). There is no jsdom: the
// boxes come from the calling screen's layout rules (styles.css, layout.ts), placed by the App's own
// placeCallingCard on a fake panel.

import { beforeAll, describe, expect, it } from "vitest";
import type { DecisionRequest } from "../src/engine/types";
import { boardLayout, callingCardBox, callingContent, estimatedCardsRow, TOP_BAR } from "../src/ui/layout";
import { openMenu } from "../src/ui/menu";
import { FocusTrail } from "../src/ui/overlay";
import { appHarness, FakeEl, installFakeDom } from "./fake-dom";
import { simGames } from "./sim-games";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
const hits = (a: Rect, b: Rect): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const rectOf = (r: Rect): FakeEl["rect"] => ({ ...r, right: r.left + r.width, bottom: r.top + r.height });

/** The calling screen's boxes at a window and text size (two columns: the board's or 5fr/7fr). */
function boxes(w: number, h: number, ts: number): { plate: Rect; board: Rect | null; call: Rect; legendTop: number } {
  const content = callingContent(w);
  const left0 = (w - content) / 2;
  const row = estimatedCardsRow(h, ts);
  const plate = { left: left0, top: TOP_BAR + 24, width: content, height: row.top - 16 - (TOP_BAR + 24) };
  const lay = boardLayout({ width: w, height: h }, ts, 64 * ts, row);
  const leftW = lay === null ? Math.max(260, ((content - 24) * 5) / 12) : lay.boardW;
  const board = lay === null ? null : { left: left0, top: lay.top, width: lay.boardW, height: lay.boardH };
  const callLeft = left0 + leftW + 24;
  return { plate, board, call: { left: callLeft, top: row.top, width: content - leftW - 24, height: row.legendTop - 16 - row.top }, legendTop: row.legendTop };
}

beforeAll(() => installFakeDom(1280, 720));

describe("PC1: the card never covers the plate or the board", () => {
  for (const [w, h] of [[1024, 600], [1280, 720], [1920, 1080]] as const)
    for (const ts of [1, 2]) {
      it(`${w}x${h} at ${ts * 100}%`, () => {
        const b = boxes(w, h, ts);
        Object.assign((globalThis as unknown as { window: object }).window, { innerWidth: w, innerHeight: h });
        // The App places it from the call column it finds on the panel.
        const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
        const hh = appHarness({ matchup: g.matchup, human: g.human });
        const menu = new FakeEl("section");
        menu.className = "ov-menu glass";
        menu.rect = rectOf(b.call);
        const foot = new FakeEl("footer");
        foot.className = "panel-foot";
        foot.rect = rectOf({ left: 0, top: b.legendTop, width: w, height: h - b.legendTop });
        hh.panel.rect = rectOf({ left: 0, top: TOP_BAR, width: w, height: h - TOP_BAR });
        hh.panel.append(menu, foot);
        hh.app["markCard"] = "someone";
        hh.call("placeCallingCard");
        const st = hh.markCard.style;
        const card = { left: parseFloat(st["left"] ?? "NaN"), top: parseFloat(st["top"] ?? "NaN"), width: parseFloat(st["width"] ?? "NaN"), height: parseFloat(st["maxHeight"] ?? "NaN") };
        // Down to the legend, but never under a usable minimum inside the window (S4).
        const height = Math.max(Math.min(240, Math.max(0, h - b.call.top - 8)), b.legendTop - b.call.top);
        expect(card).toEqual({ left: b.call.left, top: b.call.top, width: Math.min(360, b.call.width), height });
        // Test-writer: the card stays inside the window, reaches the legend (Q3), and is never too short to read (S4).
        expect(card.height, "a readable card").toBeGreaterThanOrEqual(Math.min(240, h - card.top - 8));
        expect(card.height).toBeGreaterThan(0);
        expect(card.top + card.height, "reaches the legend").toBeGreaterThanOrEqual(b.legendTop);
        if (card.height > b.legendTop - card.top) expect(card.top + card.height, "inside the window").toBeLessThanOrEqual(h - 8);
        expect(callingCardBox(b.call, b.legendTop)).toMatchObject({ left: card.left, top: card.top });
        expect(hits(card, b.plate), "plate").toBe(false);
        if (b.board !== null) expect(hits(card, b.board), "board").toBe(false);
        // The covered call card is inert while the card is open.
        expect(menu.inert).toBe(true);
      });
    }
});

describe("PC2: with the card open, the covered rows take no key; Esc closes and gives focus back", () => {
  const key = (k: string): KeyboardEvent => ({ key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => undefined }) as unknown as KeyboardEvent;

  it("1 to 7, T and Enter change no menu state and send no answer", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const req = g.requests.find((r) => r.kind === "offenseCall") as DecisionRequest;
    const h = appHarness({ matchup: g.matchup, human: g.human, events: [...g.events] });
    const sent: unknown[] = [];
    const back = new FakeEl("button");
    back.parentElement = new FakeEl("div");
    const trail = new FocusTrail<"markCard", unknown>();
    trail.open("markCard", back);
    const menu = openMenu(req);
    Object.assign(h.app, { client: { send: (m: unknown) => sent.push(m) }, render: () => undefined, animator: { resume: () => undefined, redraw: () => undefined, pause: () => undefined }, cardTrail: trail, layoutNow: { tooSmall: false } });
    h.game["request"] = req;
    h.game["menu"] = menu;
    h.app["markCard"] = "someone";
    for (const k of ["1", "2", "3", "4", "5", "6", "7", "t", "T", "ArrowDown", "ArrowRight", "d"]) {
      h.call("onKey", key(k));
      expect(h.game["menu"], k).toBe(menu);
      expect(h.app["markCard"], k).toBe("someone");
    }
    expect(sent).toEqual([]);
    // Enter closes the card (it never picks the covered row).
    h.call("onKey", key("Enter"));
    expect(h.app["markCard"]).toBeNull();
    expect(h.game["menu"]).toBe(menu);
    expect(sent).toEqual([]);
    expect(back.focused).toBe(true);
  });

  it("Esc closes the card and focus returns to where it was", () => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const req = g.requests.find((r) => r.kind === "offenseCall") as DecisionRequest;
    const h = appHarness({ matchup: g.matchup, human: g.human });
    const back = new FakeEl("button");
    back.parentElement = new FakeEl("div");
    const trail = new FocusTrail<"markCard", unknown>();
    trail.open("markCard", back);
    Object.assign(h.app, { client: { send: () => undefined }, render: () => undefined, animator: { resume: () => undefined, redraw: () => undefined }, cardTrail: trail, layoutNow: { tooSmall: false } });
    h.game["request"] = req;
    h.game["menu"] = openMenu(req);
    h.app["markCard"] = "someone";
    h.call("onKey", key("Escape"));
    expect(h.app["markCard"]).toBeNull();
    expect(back.focused).toBe(true);
    expect(h.app["stack"]).toEqual([{ id: "game" }]);
  });
});

describe("Q3 States: one column at 200% text, the card stays usable (code review S4)", () => {
  it("a call card starting near the legend still gives the card its minimum height, inside the window; it scrolls inside its box", () => {
    // 1024x600, one column: the call card starts under a tall Last play card, 30 px above the legend.
    const box = callingCardBox({ left: 24, top: 496, width: 976 }, 526, 600);
    expect(box.maxHeight).toBeGreaterThan(0);
    expect(box.top + box.maxHeight).toBeLessThanOrEqual(600 - 8);
    const roomy = callingCardBox({ left: 24, top: 200, width: 976 }, 526, 600);
    expect(roomy.maxHeight).toBe(326);
    const tight = callingCardBox({ left: 24, top: 300, width: 976 }, 320, 600);
    expect(tight.maxHeight).toBe(240);
  });
});

describe("code review N4 and N1", () => {
  const harnessOn = (): ReturnType<typeof appHarness> => {
    const g = simGames(1)[0] as ReturnType<typeof simGames>[number];
    const h = appHarness({ matchup: g.matchup, human: g.human });
    const req = g.requests.find((r) => r.kind === "offenseCall") as DecisionRequest;
    h.game["request"] = req;
    h.game["menu"] = openMenu(req);
    Object.assign(h.app, {
      board: new FakeEl("canvas"),
      boardView: { s: 10, ox: 0, width: 560, columnWidth: 560, height: 300, cameraY: 50, markPx: 14 },
      animator: { shown: () => ({ tl: { marks: [] }, t: 0 }), marks: () => [{ id: "a" }, { id: "b" }], pause: () => undefined, resume: () => undefined, redraw: () => undefined },
      cardTrail: new FocusTrail<"markCard", unknown>(),
      render: () => undefined,
      requestRanks: () => undefined,
      client: { send: () => undefined },
      ranks: new Map(),
      boardShown: null,
    });
    return h;
  };
  const move = { clientX: 5, clientY: 5 } as MouseEvent;

  it("N4: a card opened with M stays open when the mouse crosses empty board", () => {
    const h = harnessOn();
    h.call("cycleMarkCard");
    expect(h.app["markCard"]).toBe("a");
    h.call("onBoardHover", move);
    expect(h.app["markCard"]).toBe("a");
  });

  it("N4: a card hovering opened closes when the mouse leaves the marks", () => {
    const h = harnessOn();
    h.app["markCard"] = "a";
    h.app["markCardHovered"] = true;
    h.call("onBoardHover", move);
    expect(h.app["markCard"]).toBeNull();
  });

  it("N1: an answer error resets the auto-advance, the preview state and the Earlier call flag", () => {
    const h = harnessOn();
    Object.assign(h.app, { autoAdvancing: true, autoPlay: true, previewArmed: true });
    h.game["earlierSent"] = false;
    h.call("onWorker", { t: "answerError", code: "illegalOption", message: "x" });
    expect([h.app["autoAdvancing"], h.app["autoPlay"], h.app["previewArmed"], h.game["earlierSent"]]).toEqual([false, false, false, false]);
  });
});

describe("code review N1: a call card below the window (scrolled, one column, 200% text)", () => {
  it("the card comes up into the window with its minimum height, never above the top bar", () => {
    const b = callingCardBox({ left: 24, top: 900, width: 976 }, 526, 600);
    expect(b.top).toBeGreaterThanOrEqual(64 + 8);
    expect(b.top + b.maxHeight).toBeLessThanOrEqual(600 - 8);
    expect(b.maxHeight).toBe(240);
    // A tiny window: the card takes what room there is.
    const t = callingCardBox({ left: 24, top: 900, width: 976 }, 280, 300);
    expect(t.top).toBe(72);
    expect(t.maxHeight).toBe(300 - 64 - 16);
  });
});
