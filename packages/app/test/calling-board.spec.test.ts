// Calling screen pass U1 (docs/specs/m2-calling-screen-pass.md): the field board on the calling
// screen. boardLayout's show conditions and the table's widths and scales, boardCamera's depth rule
// (CB1); the board draws the hidden play canvas's frame and the left column switches full, compact,
// full at the right inputs (CB2); the board never adds height (CB5, from the layout: there is no
// jsdom, so scrollHeight itself is not measured); Same call and Earlier call preview exactly their
// play art (CB6). CB3 (no leak) is in play-calling-spec.test.ts, CB4 (spacing at 9.44) in art.test.ts.

import { beforeAll, describe, expect, it } from "vitest";
import type { DecisionRequest, Team } from "../src/engine/types";
import { Animator, withScene } from "../src/ui/animator";
import { drawField, drawFrame, type FrameOpts } from "../src/ui/field";
import { alignment, offenseArt } from "../src/ui/art";
import { boardViewOf, COMPACT_CARD_PX, ownLinedUpYs } from "../src/ui/board";
import { BOARD, boardCamera, boardLayout, callingContent, estimatedCardsRow, layoutFor } from "../src/ui/layout";
import { openMenu, rows } from "../src/ui/menu";
import { callingFrame, kickoffFrame, ownSlots } from "../src/ui/presnap";
import { earlierCall } from "../src/ui/recent";
import type { Timeline } from "../src/ui/timeline";
import { appHarness, appLabels, FakeEl, installFakeDom, MOTION, TEMPLATES } from "./fake-dom";
import { simGames } from "./sim-games";

const FULL_CARD = 210;

describe("CB1: boardLayout", () => {
  it("the table's widths and scales at 1024x600, 1280x720 and 1920x1080 at 100% text", () => {
    const at = (w: number, h: number, card: number) => boardLayout({ width: w, height: h }, 1, card);
    const a = at(1024, 600, COMPACT_CARD_PX);
    expect(a).toMatchObject({ boardW: 529, callW: 423, content: 976 });
    expect(a?.sB).toBeCloseTo(9.45, 2);
    const b = at(1280, 720, COMPACT_CARD_PX);
    expect(b).toMatchObject({ boardW: 560, callW: 576, content: 1160 });
    expect(b?.sB).toBeCloseTo(10, 9);
    const c = at(1920, 1080, FULL_CARD);
    expect(c).toMatchObject({ boardW: 560, callW: 576, content: 1160 });
    // Heights from the estimated cards row (styles.css; docs/PERF.md has the measured figures).
    expect(a?.boardH).toBe(229);
    expect(b?.boardH).toBe(349);
    expect(c?.boardH).toBe(563);
    expect(at(1024, 600, FULL_CARD)).toBeNull();
  });

  it("null unless all four conditions hold: two columns, text <= 125%, call column >= 400, board >= 180 tall", () => {
    const big = { top: 0, legendTop: 10_000 };
    // 1. Two columns: content at least 760.
    expect(boardLayout({ width: 807, height: 1080 }, 1, 0, big)).toBeNull();
    // 2. Text.
    expect(boardLayout({ width: 1920, height: 1080 }, 1.25, 0, big)).not.toBeNull();
    expect(boardLayout({ width: 1920, height: 1080 }, 1.5, 0, big)).toBeNull();
    expect(boardLayout({ width: 1920, height: 1080 }, 2, 0, big)).toBeNull();
    // 3. The call column: content 953 is the smallest that leaves 400 beside a 529 board.
    expect(boardLayout({ width: 953 + 48, height: 1080 }, 1, 0, big)?.callW).toBe(400);
    expect(boardLayout({ width: 952 + 48, height: 1080 }, 1, 0, big)).toBeNull();
    // 4. Height.
    expect(boardLayout({ width: 1280, height: 720 }, 1, 0, { top: 0, legendTop: 16 + 16 + 180 })?.boardH).toBe(180);
    expect(boardLayout({ width: 1280, height: 720 }, 1, 0, { top: 0, legendTop: 16 + 16 + 179 })).toBeNull();
  });

  it("the board is min(560, (content - 24) / 2) wide, never under 529", () => {
    for (let w = 1001; w <= 2400; w += 37) {
      const l = boardLayout({ width: w, height: 1080 }, 1, 0, { top: 0, legendTop: 10_000 });
      if (l === null) continue;
      expect(l.boardW).toBe(Math.max(529, Math.min(560, Math.floor((callingContent(w) - 24) / 2))));
      expect(l.boardW + 24 + l.callW).toBe(callingContent(w));
      expect(l.sB).toBeCloseTo(l.boardW / 56, 9);
    }
  });

  describe("boardCamera keeps the deepest lined-up own mark plus 1 yard in view", () => {
    const vis = 229 / 9.45;
    const check = (los: number, ys: readonly number[], own: "O" | "X", label: string): void => {
      const cam = boardCamera(los, vis, ys, own);
      if (own === "O") expect(Math.min(...ys) - 1, label).toBeGreaterThanOrEqual(cam - vis - 1e-9);
      else expect(Math.max(...ys) + 1, label).toBeLessThanOrEqual(cam + 1e-9);
      // Never moved further than needed: the line stays 70% down when the unit already fits.
      const base = los + 0.7 * vis;
      if ((own === "O" && Math.min(...ys) - 1 >= base - vis) || (own === "X" && Math.max(...ys) + 1 <= base)) expect(cam, label).toBe(base);
    };
    it("every formation", () => {
      for (const f of Object.keys(TEMPLATES.offense)) {
        const fr = callingFrame({ side: "offense", los: 30, firstDown: 40, unit: f, call: null, lineups: undefined, counts: { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5 }, opponentCount: 11, templates: TEMPLATES, motion: MOTION, pxPerYard: 9.44, markPx: 14, endZoneYards: 10 });
        check(30, ownLinedUpYs(fr, 0, "O"), "O", f);
      }
    });
    it("the punt and field goal units", () => {
      for (const unit of ["punt", "fieldGoal"]) {
        const tmpl = TEMPLATES.kick[unit];
        expect(tmpl, unit).toBeDefined();
        const slots = Object.keys(tmpl ?? {}).map((slot) => ({ slot, position: slot.replace(/\d+$/, "") as never }));
        check(40, alignment(slots, tmpl, "O", 40).map((p) => p.y), "O", unit);
      }
    });
    it("the kickoff unit, kicking and receiving", () => {
      for (const humanKicks of [true, false]) {
        const fr = kickoffFrame({ los: 35, humanKicks, templates: TEMPLATES, pxPerYard: 9.44 });
        const own = humanKicks ? "O" : "X";
        check(35, ownLinedUpYs(fr, 0, own), own, `kickoff, human kicks ${humanKicks}`);
      }
    });
  });
});

describe("CB5: the board never adds height", () => {
  it("at every window from 800x536 to 1920x1080 and text 100% and 125%, the left column is at most the cards row", () => {
    for (let w = 800; w <= 1920; w += 40)
      for (let hh = 536; hh <= 1080; hh += 24)
        for (const ts of [1, 1.25])
          for (const card of [COMPACT_CARD_PX * ts, FULL_CARD * ts]) {
            const row = estimatedCardsRow(hh, ts);
            const l = boardLayout({ width: w, height: hh }, ts, card, row);
            if (l === null) continue;
            expect(l.top + l.boardH, `${w}x${hh} ${ts}`).toBeLessThanOrEqual(row.legendTop - BOARD.rowGap);
            expect(card + BOARD.rowGap + l.boardH).toBeLessThanOrEqual(row.legendTop - BOARD.rowGap - row.top + 1);
          }
  });
});

// ---------------------------------------------------------------- an App with a real Animator over a fake canvas

interface Harness {
  readonly h: ReturnType<typeof appHarness>;
  readonly animator: Animator;
  key(k: string): void;
  move(i: number): void;
}

function calling(req: Extract<DecisionRequest, { kind: "offenseCall" }>, g: ReturnType<typeof simGames>[number], events: readonly unknown[]): Harness {
  const h = appHarness({ matchup: g.matchup, human: g.human, events: [...(events as never[])] });
  const layout = layoutFor(1280, 720, TEMPLATES.field);
  const animator = new Animator(new FakeEl("canvas") as unknown as HTMLCanvasElement, () => layout, () => TEMPLATES, () => (h.app as unknown as { frameOpts(): never }).frameOpts());
  Object.assign(h.app, { animator, client: { send: () => undefined }, render: () => (h.app as unknown as { updatePreview(): void }).updatePreview(), menuEnter: null, previewKey: "", previewFrame: null, layoutNow: layout });
  const st = req.state as NonNullable<DecisionRequest["state"]>;
  h.game["state"] = { ...st, trySpots: null, playCount: 1 };
  h.game["request"] = req;
  h.game["menu"] = openMenu(req);
  h.game["framePossession"] = st.possession;
  animator.idle((h.app as unknown as { sceneFor(p: Team, l: number, f: number | null): never }).sceneFor(st.possession, st.spot, null), false, false);
  return {
    h,
    animator,
    key: (k: string): void => h.call("pickInGame", k),
    move: (i: number): void => {
      h.app["highlight"] = i;
      h.app["previewArmed"] = true;
      h.call("updatePreview");
    },
  };
}

describe("CB2 and CB6: the board's frame is the play canvas's, and the left column's two states", () => {
  beforeAll(() => installFakeDom(1280, 720));

  const pick = (): { g: ReturnType<typeof simGames>[number]; req: Extract<DecisionRequest, { kind: "offenseCall" }>; events: unknown[] } => {
    for (const g of simGames(20)) {
      const events: unknown[] = [];
      for (const m of g.sent) {
        if (m.t !== "step") continue;
        events.push(...m.events);
        const r = m.request;
        if (r?.kind === "offenseCall" && r.sameCall?.formation !== undefined && r.screens[0]?.options.find((o) => o.id === "sameCall")?.legal === true) {
          const e = earlierCall(events as never, g.human, r);
          if (e.on && e.call.formation !== undefined) return { g, req: r, events };
        }
      }
    }
    throw new Error("no offense request with Same call and Earlier call on");
  };

  it("first screen, Formation, Shotgun, Pass, each pass card, Esc back twice", { timeout: 600_000 }, () => {
    const { g, req, events } = pick();
    const c = calling(req, g, events);
    const shown = (): Timeline | undefined => c.animator.shown()?.tl;
    const compact = (): boolean => c.h.call<boolean>("compactCard", c.h.game);
    // State 1: no input yet, the field's own frame (idle here), the full card.
    c.h.call("updatePreview");
    expect(c.h.app["previewFrame"]).toBeNull();
    expect(compact()).toBe(false);
    // The first input on the first screen: state 2, the compact card.
    c.move(0);
    expect(compact()).toBe(true);
    c.key("1");
    c.move(0);
    expect(shown()).toBe(c.h.app["previewFrame"]);
    c.key("1"); // Shotgun
    c.key("2"); // Pass
    const passRows = rows(c.h.game["menu"] as never, { catalog: (c.h.app["ui"] as unknown as { catalog: never }).catalog, labels: appLabels() });
    for (let i = 0; i < passRows.length - 1; i++) {
      c.move(i);
      const f = shown() as Timeline;
      expect(f).toBe(c.h.app["previewFrame"]);
      expect(f.preview).not.toBeNull();
      // The board's view draws that same frame at its own scale.
      const lay = boardLayout({ width: 1280, height: 720 }, 1, COMPACT_CARD_PX) as NonNullable<ReturnType<typeof boardLayout>>;
      const v = boardViewOf(lay, { tl: f, t: c.animator.shown()?.t ?? 0 }, "O", TEMPLATES);
      expect(v.s).toBeCloseTo(10, 9);
      expect(compact()).toBe(true);
    }
    c.key("Esc");
    c.key("Esc");
    c.key("Esc");
    // Back on the first screen: state 1 and the full card again.
    expect((c.h.game["menu"] as { screens: string[] }).screens).toHaveLength(1);
    expect(compact()).toBe(false);
  });

  it("CB2: the board's canvas draws the animator's shown frame at the board's scale, and follows focus", { timeout: 600_000 }, () => {
    // Test-writer: a recording 2D context on the board canvas. The board must paint exactly what the
    // field's drawing functions paint for animator.shown() at the board's view, and repaint on focus.
    const recorder = (): { ctx: CanvasRenderingContext2D; log: string[] } => {
      const log: string[] = [];
      const ctx = new Proxy({} as Record<string, unknown>, {
        get: (_t, p) => {
          if (p === "canvas") return { width: 560, height: 349 };
          if (p === "measureText") return (t: string) => ({ width: String(t).length * 7, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 });
          if (typeof p === "string" && /^create/.test(p)) return () => ({ addColorStop: () => undefined });
          if (p === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
          return (...args: unknown[]) => void log.push(`${String(p)}(${JSON.stringify(args)})`);
        },
        set: (_t, p, v) => {
          log.push(`${String(p)}=${typeof v === "object" ? "{}" : String(v)}`);
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
      return { ctx, log };
    };
    const { g, req, events } = pick();
    const c = calling(req, g, events);
    const lay = boardLayout({ width: 1280, height: 720 }, 1, COMPACT_CARD_PX) as NonNullable<ReturnType<typeof boardLayout>>;
    let rec = recorder();
    const canvas = new FakeEl("canvas");
    canvas.parentElement = new FakeEl("div");
    (canvas as unknown as { getContext(): CanvasRenderingContext2D }).getContext = () => rec.ctx;
    Object.assign(c.h.app, { board: canvas, boardShown: lay });
    const expected = (): string[] => {
      const f = c.animator.shown();
      if (f === null) throw new Error("nothing shown");
      const want = recorder();
      want.ctx.setTransform(1, 0, 0, 1, 0, 0);
      want.ctx.clearRect(0, 0, lay.boardW, lay.boardH);
      const view = boardViewOf(lay, f, "O", TEMPLATES);
      drawField(want.ctx, view, f.scene, 1);
      drawFrame(want.ctx, view, f.tl, f.t, withScene((c.h.app as unknown as { frameOpts(): FrameOpts }).frameOpts(), f.scene));
      return want.log;
    };
    c.move(0);
    c.key("1");
    c.key("1"); // a formation
    c.key("2"); // Pass
    const logs: string[][] = [];
    for (const i of [0, 1]) {
      c.move(i);
      rec = recorder();
      c.h.call("drawBoard");
      expect(rec.log.length, "the board painted").toBeGreaterThan(50);
      expect(rec.log).toEqual(expected());
      logs.push(rec.log);
    }
    // Two pass cards are two different pictures on the board.
    expect(logs[0]).not.toEqual(logs[1]);
  });

  it("CB6: focusing Same call or Earlier call draws exactly playArt for that call", { timeout: 600_000 }, () => {
    const { g, req, events } = pick();
    const c = calling(req, g, events);
    const art = (formation: string, leaf: string): unknown => {
      const ui = c.h.app["ui"] as { personnel: { offense: Record<string, Record<string, number>> } };
      const slots = ownSlots(req.lineups, formation, ui.personnel.offense[formation] ?? {});
      return offenseArt(formation, leaf, slots, TEMPLATES, (req.state as { spot: number }).spot, layoutFor(1280, 720, TEMPLATES.field).s);
    };
    const same = req.sameCall as { call: string; formation: string };
    c.move(3);
    expect((c.h.app["previewFrame"] as Timeline).preview).toEqual(art(same.formation, same.call));
    const e = earlierCall(events as never, g.human, req);
    if (!e.on || e.call.formation === undefined) throw new Error("pick() returns an Earlier call with a formation");
    c.move(4);
    expect((c.h.app["previewFrame"] as Timeline).preview).toEqual(art(e.call.formation, e.call.call));
    expect(e.call).not.toEqual(same);
  });
});
