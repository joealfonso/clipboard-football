// Engineer's tests for the chunk 3 review fixes in the App (DESIGN.md Moments; HUD, score bug):
// 1. the bug shows the committed state from the banner's sub-line frame on (onMoment) and after
//    each play of a batch, never the answered request's stale pre-snap snapshot;
// 2. a play shown during a pending request fires no moment then, and its committed result fires
//    the moment afterwards (replayMoment), with the bug changing on that frame.
// The App's own methods run on an App made with Object.create(App.prototype) and a tiny fake DOM
// (the same one as prime-time-chunk1.spec.test.ts), with the animator stubbed to record its calls.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { uiDataOf } from "../src/engine/session";
import type { GameState, PlayEvent } from "../src/engine/types";
import { App } from "../src/ui/app";
import { Flights } from "../src/ui/flights";
import { layoutFor } from "../src/ui/layout";
import type { Moment } from "../src/ui/moments";
import { parseMotion } from "../src/ui/templates";
import { COMPLETE, TOUCHDOWN } from "./fixtures";
import { prepared } from "./support";

const root = join(import.meta.dirname, "../../..");
const motion = parseMotion(JSON.parse(readFileSync(join(root, "data/ui/motion.json"), "utf8")));
const rules = uiDataOf(prepared(), null, null).rules;

class FakeText {
  constructor(readonly data: string) {}
  get textContent(): string {
    return this.data;
  }
}
type FakeNode = FakeEl | FakeText;
class FakeEl {
  readonly attrs = new Map<string, string>();
  children: FakeNode[] = [];
  hidden = false;
  scrollWidth = 0;
  clientWidth = 0;
  readonly styleProps = new Map<string, string>();
  readonly style: Record<string, unknown> & { setProperty(k: string, v: string): void; getPropertyValue(k: string): string };
  constructor(readonly tagName: string) {
    const props = this.styleProps;
    this.style = {
      setProperty: (k: string, v: string): void => void props.set(k, v),
      getPropertyValue: (k: string): string => props.get(k) ?? "",
    } as FakeEl["style"];
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  get classes(): string[] {
    return (this.attrs.get("class") ?? "").split(/\s+/).filter((c) => c !== "");
  }
  readonly classList = {
    add: (...cs: string[]): void => {
      this.attrs.set("class", [...new Set([...this.classes, ...cs])].join(" "));
    },
    remove: (...cs: string[]): void => {
      this.attrs.set("class", this.classes.filter((c) => !cs.includes(c)).join(" "));
    },
    contains: (c: string): boolean => this.classes.includes(c),
    toggle: (c: string, on?: boolean): boolean => {
      const want = on ?? !this.classes.includes(c);
      if (want) this.classList.add(c);
      else this.classList.remove(c);
      return want;
    },
  };
  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) this.children.push(typeof n === "string" ? new FakeText(n) : n);
  }
  replaceChildren(...nodes: FakeNode[]): void {
    this.children = [];
    this.append(...nodes);
  }
  get textContent(): string {
    return this.children.map((c) => c.textContent).join("");
  }
  get elements(): FakeEl[] {
    return this.children.filter((c): c is FakeEl => c instanceof FakeEl);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  /** Every descendant, depth first. */
  all(): FakeEl[] {
    return this.elements.flatMap((e) => [e, ...e.all()]);
  }
  /** Descendant selectors of class compounds only: ".a .b.c". */
  querySelectorAll(sel: string): FakeEl[] {
    const parts = sel.trim().split(/\s+/).map((p) => p.split(".").filter((x) => x !== ""));
    const matches = (e: FakeEl, cls: string[]): boolean => cls.every((c) => e.classes.includes(c));
    let set: FakeEl[] = [this];
    for (const cls of parts) set = [...new Set(set.flatMap((e) => e.all().filter((d) => matches(d, cls))))];
    return set;
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  has(cls: string): boolean {
    return this.classes.includes(cls);
  }
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g["document"] = { createElement: (t: string) => new FakeEl(t), createTextNode: (s: string) => new FakeText(s) };
  g["window"] = { setTimeout: () => 0, clearTimeout: () => undefined, innerWidth: 1440, innerHeight: 900 };
});

function state(over: Partial<GameState> = {}): GameState {
  return { period: 1, clock: 600, clockRunning: false, playClock: 40, phase: "scrimmage", possession: "home", spot: 40, down: 2, distance: 7, goalToGo: false, trySpots: null, safetyKick: false, score: { home: 7, away: 3 }, timeouts: { home: 3, away: 3 }, ...over } as unknown as GameState;
}

function harness() {
  const bar = new FakeEl("header");
  const team = (t: "home" | "away", index: number) => ({ index, name: t, place: t, nickname: t === "home" ? "Outriders" : "Cranes", pool: { players: [] } });
  const game: Record<string, unknown> = {
    matchup: { leagueSeed: 2026, seed: 7, gameType: "regularSeason", home: team("home", 0), away: team("away", 1) },
    human: "home",
    state: state(),
    // The answered request's pre-snap snapshot: 7 to 3, the score before the touchdown.
    request: { kind: "offenseCall", tempo: "normal", state: { score: { home: 7, away: 3 }, clock: 600 } },
    menu: null,
    events: [],
    lastPlay: null,
    result: "",
    calls: "",
    eventLines: [],
    why: null,
    save: null,
    framePossession: null,
    shownPending: null,
    requestAt: 0,
    runoffShown: 0,
    lastSame: false,
    drive: null,
  };
  const replays: { moment: Moment; onMoment?: () => void }[] = [];
  const app = Object.create(App.prototype) as Record<string, unknown>;
  Object.assign(app, {
    root: { topBar: bar, panel: new FakeEl("div"), live: { textContent: "" } },
    game,
    stack: [{ id: "game" }],
    settings: { textSize: 100, reducedMotion: "off", speed: "1x" },
    reducedQuery: { matches: false },
    layoutNow: layoutFor(1440, 900),
    animating: false,
    clockOverride: null,
    motion,
    labels: {},
    ui: { rules: { ...rules, timeouts: { perHalf: 3 }, game: { regulationPeriods: 4, periodsPerHalf: 2 }, field: { endZoneYards: 10 } } },
    flights: new Flights(),
    bugShown: null,
    trackerShown: null,
    barTimer: undefined,
    render: () => undefined,
    animator: {
      replayMoment: (mo: { moment: Moment }, o: { onMoment?: () => void }) => {
        replays.push({ moment: mo.moment, ...(o.onMoment === undefined ? {} : { onMoment: o.onMoment }) });
        return Promise.resolve();
      },
    },
  });
  const scores = (): string[] => bar.querySelectorAll(".score-box .score-now").map((e) => e.textContent);
  return { app, game, bar, replays, scores, renderBar: () => (app["renderTopBar"] as () => void).call(app) };
}

describe("flag 1: the bug follows the committed play, not the answered request's snapshot", () => {
  it("before the commit the bug shows the request's pre-snap score; from onMoment on, the touchdown's", () => {
    const h = harness();
    h.renderBar();
    expect(h.scores()).toEqual(["3", "7"]);
    // What animate's onMoment calls on the banner's sub-line frame.
    (h.app["showCommitted"] as (g: unknown, ev: PlayEvent) => void).call(h.app, h.game, TOUCHDOWN);
    expect(h.scores()).toEqual(["3", "13"]);
    // A later rebuild in the same batch (the request is still the answered one) keeps it.
    h.renderBar();
    expect(h.scores()).toEqual(["3", "13"]);
  });

  it("the next request takes over again (its snapshot is the new pre-snap state)", () => {
    const h = harness();
    (h.app["showCommitted"] as (g: unknown, ev: PlayEvent) => void).call(h.app, h.game, TOUCHDOWN);
    h.game["committed"] = false;
    h.game["request"] = { kind: "offenseCall", tempo: "normal", state: { score: { home: 14, away: 3 } } };
    h.renderBar();
    expect(h.scores()).toEqual(["3", "14"]);
  });
});

describe("flag 2: moments only from the committed result", () => {
  it("a pending request's showing fires no moment (animate is told withMoment = false)", async () => {
    const h = harness();
    const animate = vi.fn(() => Promise.resolve());
    h.app["animate"] = animate;
    const big = { ...COMPLETE.play, end: { spot: 70, possession: "offense" }, detail: { ...(COMPLETE.play.detail ?? {}), yards: 30 } };
    await (h.app["showPending"] as (g: unknown, req: unknown) => Promise<void>).call(h.app, h.game, { play: big, offenseCall: COMPLETE.offense, defenseCall: COMPLETE.defense });
    expect(animate).toHaveBeenCalledTimes(1);
    expect((animate.mock.calls[0] as unknown[])[4]).toBe(false);
  });

  it("the committed result of a play already shown fires its moment, and the bug changes on its frame", async () => {
    const h = harness();
    await (h.app["replayMoment"] as (g: unknown, ev: PlayEvent) => Promise<void>).call(h.app, h.game, TOUCHDOWN);
    expect(h.replays).toHaveLength(1);
    expect(h.replays[0]?.moment.banner?.word).toBe("TOUCHDOWN");
    h.renderBar();
    expect(h.scores()).toEqual(["3", "7"]);
    h.replays[0]?.onMoment?.();
    expect(h.scores()).toEqual(["3", "13"]);
  });

  it("a committed result with no moment replays nothing", async () => {
    const h = harness();
    const plain = { ...COMPLETE, after: { ...COMPLETE.after, down: 3, distance: 3, spot: 44 } } as PlayEvent;
    await (h.app["replayMoment"] as (g: unknown, ev: PlayEvent) => Promise<void>).call(h.app, h.game, plain);
    expect(h.replays).toHaveLength(0);
  });
});
