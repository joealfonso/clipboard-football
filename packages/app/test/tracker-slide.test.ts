// Engineer's regression check for the chunk 1 code-review flag on the drive tracker: one play is
// one slide from its pre-play spots. A step with a play builds the plate twice: once right after
// the play (the drive is cleared until the step's own drive arrives) and once when the step ends
// (with that drive). The second build must not restart the slide from the first build's spots.
// Also the calling screen's spacing: the spare height never lands between the plate and the cards.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { OpenDrive } from "../src/engine/protocol";
import type { GameState } from "../src/engine/types";
import { App } from "../src/ui/app";
import { Flights } from "../src/ui/flights";
import { layoutFor } from "../src/ui/layout";

class FakeEl {
  readonly attrs = new Map<string, string>();
  children: FakeEl[] = [];
  readonly props = new Map<string, string>();
  readonly style: Record<string, unknown> & { setProperty(k: string, v: string): void };
  constructor(readonly tag: string) {
    const props = this.props;
    this.style = { setProperty: (k: string, v: string): void => void props.set(k, v) } as FakeEl["style"];
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  get classes(): string[] {
    return (this.attrs.get("class") ?? "").split(/\s+/).filter((c) => c !== "");
  }
  readonly classList = {
    add: (...cs: string[]): void => void this.attrs.set("class", [...new Set([...this.classes, ...cs])].join(" ")),
    contains: (c: string): boolean => this.classes.includes(c),
  };
  append(...nodes: (FakeEl | string)[]): void {
    for (const n of nodes) if (typeof n !== "string") this.children.push(n);
  }
  all(): FakeEl[] {
    return this.children.flatMap((e) => [e, ...e.all()]);
  }
  find(cls: string): FakeEl {
    const e = this.all().find((x) => x.classes.includes(cls));
    if (e === undefined) throw new Error(`no .${cls}`);
    return e;
  }
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g["document"] = { createElement: (t: string) => new FakeEl(t), createTextNode: () => new FakeEl("#text") };
  g["window"] = { setTimeout: () => 0, clearTimeout: () => undefined, innerWidth: 1440, innerHeight: 900 };
});

function state(over: Partial<GameState>): GameState {
  return { period: 1, clock: 800, clockRunning: false, phase: "scrimmage", possession: "home", spot: 32, down: 1, distance: 10, goalToGo: false, trySpots: null, safetyKick: false, score: { home: 0, away: 0 }, timeouts: { home: 3, away: 3 }, ...over } as unknown as GameState;
}

function harness(): { build(s: GameState, drive: OpenDrive | null, now?: number): FakeEl } {
  const team = (index: number, nickname: string) => ({ index, name: nickname, place: "", nickname, pool: {} });
  const game = { matchup: { leagueSeed: 2026, seed: 7, gameType: "regularSeason", home: team(0, "Outriders"), away: team(1, "Cranes") }, human: "home", drive: null as OpenDrive | null };
  const app = Object.create(App.prototype) as Record<string, unknown>;
  Object.assign(app, {
    game,
    settings: { textSize: 100, reducedMotion: "off", speed: "1x" },
    reducedQuery: { matches: false },
    layoutNow: layoutFor(1440, 900),
    flights: new Flights(),
    trackerShown: null,
  });
  return {
    build(s: GameState, drive: OpenDrive | null, now = 1000): FakeEl {
      game.drive = drive;
      return (app["driveTracker"] as (g: unknown, s: GameState, now: number, still: boolean) => FakeEl).call(app, game, s, now, false);
    },
  };
}

const x = (yards: number): string => `${((10 + yards) / 120) * 100}%`;

describe("the drive tracker: one play, one slide from the pre-play spots", () => {
  it("1st & 10 at 32 (drive from 20), a 12-yard gain to 1st & 10 at 44: both builds of the step slide from 32, 42 and the 20-to-32 band", () => {
    const h = harness();
    const drive = { team: "home" as const, start: 20, plays: 2 };
    // Before the play: the calling screen at 1st & 10 at 32.
    h.build(state({ spot: 32 }), drive);
    // The play's build (the drive cleared until the step's arrives), then the step's build.
    const after = state({ spot: 44 });
    for (const wrap of [h.build(after, null), h.build(after, { ...drive, plays: 3 })]) {
      const tk = wrap.find("tracker");
      expect(tk.classList.contains("slide")).toBe(true);
      for (const cls of ["tk-ball", "tk-los"]) {
        const el = tk.find(cls);
        expect(el.classList.contains("from"), cls).toBe(true);
        expect(el.props.get("--from-left"), cls).toBe(x(32));
        expect(el.style["left"], cls).toBe(x(44));
      }
      const fd = tk.find("tk-fd");
      expect(fd.props.get("--from-left")).toBe(x(42));
      expect(fd.style["left"]).toBe(x(54));
    }
    // The band, drawn in the step's build: from the pre-play band (20 to 32) to 20 to 44.
    const band = h.build(after, { ...drive, plays: 3 }).find("tk-band");
    expect(band.classList.contains("from")).toBe(true);
    expect([band.props.get("--from-left"), band.props.get("--from-width")]).toEqual([x(20), `${(12 / 120) * 100}%`]);
    expect([band.style["left"], band.style["width"]]).toEqual([x(20), `${(24 / 120) * 100}%`]);
  });

  it("the next play, after the last slide is over, slides from where that one ended", () => {
    const h = harness();
    const drive = { team: "home" as const, start: 20, plays: 2 };
    h.build(state({ spot: 32 }), drive, 1000);
    h.build(state({ spot: 44 }), null, 1000);
    h.build(state({ spot: 44 }), drive, 1001);
    // 2 s later (dur.tick is 360 ms), a 6-yard gain.
    const tk = h.build(state({ spot: 50, down: 2, distance: 4 }), null, 3000).find("tracker");
    expect(tk.find("tk-ball").props.get("--from-left")).toBe(x(44));
    expect(tk.find("tk-ball").style["left"]).toBe(x(50));
  });
});

describe("Calling screen spacing: the plate sits 16 px over the cards in every state", () => {
  const css = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const body = (sel: string): string => new RegExp(`(?:^|\\})\\s*${sel.replace(/\./g, "\\.").replace(/ /g, "\\s+")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  it("the wide grid's rows are plate, cards, then the legend's row taking the spare height; the legend at its bottom", () => {
    expect(body(".panel.wide")).toMatch(/grid-template-rows:\s*auto auto 1fr;/);
    expect(body(".panel.wide")).toMatch(/row-gap:\s*16px;/);
    expect(body(".panel.wide .panel-foot")).toMatch(/align-self:\s*end;/);
  });
});
