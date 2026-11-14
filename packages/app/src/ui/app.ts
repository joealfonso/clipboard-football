// The app controller: screen flow, keyboard and mouse, the worker conversation, and the panel and
// top bar DOM. The sim runs in the worker; this thread only sees requests, committed events and
// box scores. The opponent's call reaches this thread only in a committed play event, after the
// snap (spec F5). Number keys during the animation are dropped, not buffered (decision 8).

import type { PlayResult, Position, TeamPool } from "@clipboard-football/shared";
import type { BoxScore, TeamBox } from "@clipboard-football/sim";
import type { SaveData } from "../engine/adapter";
import { SimClient } from "../engine/client";
import { whyHeadline } from "../engine/headline";
import type { FromWorker, Matchup, SimErrorInfo, TeamSummary, UiData } from "../engine/protocol";
import { readDetail, type DecisionRequest, type GameEvent, type GameState, type PlayEvent, type PlayerLine, type RatingRank, type Team, type TraceEntry } from "../engine/types";
import { Animator } from "./animator";
import { bar, h, swatch } from "./dom";
import type { FieldScene, FrameOpts } from "./field";
import { layoutFor, type Layout } from "./layout";
import { breadcrumb, current, isFirstScreen, openMenu, press, rows as menuRows, title as menuTitle, type MenuData, type MenuKey, type MenuState, type Row } from "./menu";
import {
  MARK_LABEL_TEXT,
  UNITS,
  boxScreen,
  cardScreen,
  controlsScreen,
  detailsScreen,
  endScreen,
  halftimeScreen,
  noticeScreen,
  pauseScreen,
  pregameScreen,
  ratingDetailScreen,
  rosterScreen,
  saveErrorScreen,
  settingsScreen,
  simErrorScreen,
  titleScreen,
  type BoxTab,
  type ScreenModel,
  type ScreenRow,
  type Unit,
} from "./screens";
import { DEFAULT_SETTINGS, bumpLog, deleteSave, loadSettings, readSave, saveSettings, storageAvailable, writeSave, type Settings } from "./storage";
import { parseTemplates, type Templates } from "./templates";
import {
  abbrev,
  callsLine,
  catalogLabels,
  clockText,
  eventLine,
  lineUpText,
  other,
  penaltyChoiceText,
  penaltyText,
  periodText,
  playText,
  reasonText,
  resultLine,
  sideText,
  situationText,
  tempoText,
  type PlayerText,
  type TextCtx,
} from "./text";
import { timeline } from "./timeline";
import { COLOR, swatchFor } from "./tokens";

type Overlay =
  | { readonly id: "title" }
  | { readonly id: "pregame" }
  | { readonly id: "roster"; readonly team: Team; unit: Unit; sel: number }
  | { readonly id: "card"; readonly ids: readonly string[]; index: number }
  | { readonly id: "ratingDetail"; readonly playerId: string }
  | { readonly id: "game" }
  | { readonly id: "pause" }
  | { readonly id: "settings" }
  | { readonly id: "controls" }
  | { readonly id: "details" }
  | { readonly id: "box"; tab: BoxTab }
  | { readonly id: "notice"; readonly title: string; readonly lines: readonly string[]; readonly done: () => void }
  | { readonly id: "halftime"; readonly done: () => void }
  | { readonly id: "end" }
  | { readonly id: "saveError"; readonly reason: "older" | "damaged" }
  | { readonly id: "simError"; readonly info: SimErrorInfo };

interface GameView {
  readonly matchup: Matchup;
  readonly human: Team;
  state: GameState;
  request: DecisionRequest | null;
  menu: MenuState | null;
  events: GameEvent[];
  lastPlay: PlayEvent | null;
  result: string;
  calls: string;
  eventLines: string[];
  why: string | null;
  save: SaveData | null;
  /** Possession of the frame on the field, for the flip at the next dead ball. */
  framePossession: Team | null;
  /** The pending play a penalty request already showed, so the commit doesn't animate it twice. */
  shownPending: string | null;
  requestAt: number;
}

const POSITION_UNIT: Readonly<Record<Position, Unit>> = { QB: "Offense", RB: "Offense", WR: "Offense", TE: "Offense", OL: "Offense", DL: "Defense", LB: "Defense", CB: "Defense", S: "Defense", K: "Special teams", P: "Special teams" };
const POSITION_PLURAL: Readonly<Record<string, string>> = { QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs", OL: "offensive linemen", DL: "defensive linemen", LB: "linebackers", CB: "cornerbacks", S: "safeties", K: "kickers", P: "punters" };
const RATING_NAME: Readonly<Record<string, string>> = {
  speed: "Speed", strength: "Strength", agility: "Agility", awareness: "Awareness", throwPower: "Throw power", accuracy: "Accuracy", ballSecurity: "Ball security", elusiveness: "Elusiveness",
  hands: "Hands", routeRunning: "Route running", runBlock: "Run block", passBlock: "Pass block", passRush: "Pass rush", runStop: "Run stop", tackling: "Tackling", coverage: "Coverage", ballSkills: "Ball skills", kickPower: "Kick power", kickAccuracy: "Kick accuracy",
};

const randomSeed = (): number => Math.floor(Math.random() * 0xffffffff);

export class App {
  private readonly client: SimClient;
  private readonly animator: Animator;
  private ui: UiData | null = null;
  private templates: Templates | null = null;
  private labels: Record<string, string> = {};
  private stack: Overlay[] = [];
  private loading: { file: string; done: number; total: number } | null = { file: "", done: 0, total: 1 };
  private fatal: { readonly title: string; readonly lines: readonly string[] } | null = null;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private storage = true;
  private hasSave = false;
  private storageWarning: string | null = null;
  private leagueSeed = 2026;
  private seed = randomSeed();
  private human: Team = "home";
  private matchup: Matchup | null = null;
  private game: GameView | null = null;
  private animating = false;
  private working = false;
  private status = "";
  private highlight = 0;
  private box: { box: BoxScore; players: readonly PlayerLine[] } | null = null;
  private ranks = new Map<string, readonly RatingRank[]>();
  private clockOverride: number | null = null;
  private layoutNow: Layout;
  private queue: Promise<void> = Promise.resolve();
  private readonly reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(
    private readonly root: { topBar: HTMLElement; panel: HTMLElement; canvas: HTMLCanvasElement; live: HTMLElement; small: HTMLElement },
  ) {
    this.settings = loadSettings();
    this.layoutNow = layoutFor(window.innerWidth, window.innerHeight);
    this.animator = new Animator(root.canvas, () => this.layoutNow, () => this.templates as Templates, () => this.frameOpts());
    this.client = new SimClient(
      (m) => this.onWorker(m),
      (slow) => {
        this.working = slow;
        this.renderStatus();
      },
    );
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("resize", () => this.onResize());
    this.reducedQuery.addEventListener("change", () => this.render());
    this.applyTextSize();
    this.onResize();
    void storageAvailable().then(async (ok) => {
      this.storage = ok;
      if (!ok) this.storageWarning = "This game can't be saved in this browser window.";
      else this.hasSave = (await readSave().catch(() => undefined)) !== undefined;
      this.render();
    });
    this.client.send({ t: "init" });
    this.render();
  }

  // ------------------------------------------------------------ worker

  private onWorker(m: FromWorker): void {
    switch (m.t) {
      case "progress":
        this.loading = { file: m.file, done: m.done, total: m.total };
        this.render();
        return;
      case "ready":
        try {
          this.templates = parseTemplates(m.ui.uiTemplates);
        } catch (e) {
          this.fatal = { title: "Game data failed its check: data/ui/templates.json. This build can't run.", lines: [(e as Error).message] };
          this.render();
          return;
        }
        this.ui = m.ui;
        this.leagueSeed = m.leagueSeed;
        this.labels = { ...m.ui.labels, ...catalogLabels(m.ui.catalog) };
        // The calls line and Same call read "Short pass", not "Short".
        for (const s of m.ui.catalog.screens) if (s.id === "offense.pass") for (const c of s.choices) this.labels[c.id] = `${c.label} pass`;
        this.loading = null;
        this.stack = [{ id: "title" }];
        this.render();
        return;
      case "dataError":
        this.fatal = { title: `Game data failed its check: ${m.file}. This build can't run.`, lines: [m.message] };
        this.render();
        return;
      case "matchup":
        this.matchup = m.matchup;
        this.seed = m.matchup.seed;
        this.render();
        return;
      case "step":
        this.queue = this.queue.then(() => this.onStep(m)).catch((e: unknown) => this.showSimError({ name: "Error", message: (e as Error).message, seed: this.seed, playCount: this.game?.state.playCount ?? null }));
        return;
      case "answerError":
        // The run is unchanged: put the same request's menu back.
        if (this.game !== null && this.game.request !== null) this.game.menu = openMenu(this.game.request);
        this.status = `That choice wasn't accepted (${m.message}).`;
        this.render();
        return;
      case "saveError":
        this.stack = [{ id: "title" }, { id: "saveError", reason: m.reason }];
        this.render();
        return;
      case "box":
        this.box = { box: m.box, players: m.players };
        this.render();
        return;
      case "ranks":
        this.ranks.set(m.playerId, m.ranks);
        this.render();
        return;
      case "simError":
        this.showSimError(m.error);
        return;
    }
  }

  private showSimError(info: SimErrorInfo): void {
    this.animator.stop();
    this.animating = false;
    this.stack = [{ id: "title" }, { id: "simError", info: { ...info, seed: info.seed ?? this.game?.matchup.seed ?? null, playCount: info.playCount ?? this.game?.state.playCount ?? null } }];
    this.render();
  }

  private textCtx(g: GameView): TextCtx {
    const players = new Map<string, PlayerText>();
    for (const t of [g.matchup.home, g.matchup.away]) for (const p of t.pool.players) players.set(p.id, { name: p.name, number: t.numbers[p.id] ?? 0 });
    return {
      human: g.human,
      teams: { home: g.matchup.home, away: g.matchup.away },
      players,
      labels: this.labels,
      regulationPeriods: this.ui?.rules.game.regulationPeriods ?? 4,
      endZoneYards: this.ui?.rules.field.endZoneYards ?? 10,
    };
  }

  private numbers(): Record<string, number> {
    const m = this.game?.matchup ?? this.matchup;
    return m === null || m === undefined ? {} : { ...m.home.numbers, ...m.away.numbers };
  }

  private reducedMotion(): boolean {
    return this.settings.reducedMotion === "on" || (this.settings.reducedMotion === "system" && this.reducedQuery.matches);
  }

  private frameOpts(): FrameOpts {
    return { numbers: this.numbers(), markLabels: this.settings.markLabels, routeAlpha: this.templates?.timing.routeAlpha ?? 0.4, textScale: this.settings.textSize / 100 };
  }

  private sceneFor(possession: Team, los: number, firstDown: number | null): FieldScene {
    const g = this.game;
    const m = g?.matchup ?? this.matchup;
    const name = (t: Team): string => (m === null || m === undefined ? "" : m[t].nickname);
    return { los, firstDown, bottomName: name(possession), topName: name(other(possession)), endZoneYards: this.ui?.rules.field.endZoneYards ?? 10 };
  }

  // ------------------------------------------------------------ the game loop on this side

  private async onStep(m: Extract<FromWorker, { t: "step" }>): Promise<void> {
    const fresh = this.game === null || m.resumed || this.game.matchup.seed !== m.matchup.seed;
    if (fresh) {
      this.game = { matchup: m.matchup, human: m.human, state: m.state, request: null, menu: null, events: [], lastPlay: null, result: "", calls: "", eventLines: [], why: null, save: null, framePossession: null, shownPending: null, requestAt: 0 };
      this.stack = [{ id: "game" }];
      if (!m.resumed) bumpLog((l) => l.gamesStarted++);
    }
    const g = this.game as GameView;
    const before = g.state;
    g.save = m.save;
    this.persist(m.save);
    if (m.resumed) {
      g.events = [...m.events];
      g.state = m.state;
      const last = [...m.events].reverse().find((e): e is PlayEvent => e.t === "play");
      if (last !== undefined) this.setPlayText(g, last);
    } else {
      if (fresh) await this.tossNotice(g, m.state);
      let prev = before;
      let runoff = 0;
      let pre: string[] = [];
      for (const ev of m.events) {
        g.events.push(ev);
        const ctx = this.textCtx(g);
        if (ev.t === "runoff") {
          runoff += ev.seconds;
          pre.push(eventLine(ev, ctx) ?? "");
          continue;
        }
        if (ev.t === "timeout") {
          // Timeouts come before the snap of their dead ball; they show with that play.
          pre.push(eventLine(ev, ctx) ?? "");
          continue;
        }
        if (ev.t === "play") {
          const key = JSON.stringify(ev.play);
          g.eventLines = pre;
          pre = [];
          if (g.shownPending !== key) await this.animate(g, ev, runoff, prev);
          g.shownPending = null;
          runoff = 0;
          this.setPlayText(g, ev);
          prev = { ...prev, ...ev.after } as GameState;
          // The scoreboard follows each play, not the end of the batch.
          g.state = { ...g.state, ...ev.after };
          this.render();
          continue;
        }
        const line = eventLine(ev, ctx);
        if (line !== null) g.eventLines.push(line);
        if (ev.t === "endPeriod" && this.ui !== null && ev.period === this.ui.rules.game.periodsPerHalf && m.state.phase !== "final") {
          this.render();
          await this.wait((done) => ({ id: "halftime", done }));
          this.client.send({ t: "box" });
        }
        if (ev.t === "toss") {
          this.render();
          await this.wait((done) => ({ id: "notice", title: "Overtime coin toss", lines: [line ?? ""], done }));
        }
      }
      if (pre.length > 0) g.eventLines.push(...pre);
      g.state = m.state;
    }
    g.request = m.request;
    g.menu = m.request === null ? null : openMenu(m.request);
    g.requestAt = performance.now();
    this.highlight = 0;
    if (m.request?.kind === "penaltyChoice") await this.showPending(g, m.request);
    this.idleField(g);
    if (m.request === null && g.state.phase === "final") {
      bumpLog((l) => l.gamesFinished++);
      this.stack = [{ id: "game" }, { id: "end" }];
      this.client.send({ t: "box" });
    }
    this.render();
  }

  private async tossNotice(g: GameView, s: GameState): Promise<void> {
    const t = this.textCtx(g).teams;
    const receiver = s.phase === "kickoff" ? other(s.possession) : s.possession;
    const won = s.toss.winner === g.human ? "You won the toss" : `The ${t[s.toss.winner].nickname} won the toss`;
    const lines = [`${won} and chose to ${s.toss.choice}.`, receiver === g.human ? "You receive." : `The ${t[receiver].nickname} receive. You kick off.`];
    // The M1 loop makes the toss choice by the rule set's designed default; milestone E asks the human.
    await this.wait((done) => ({ id: "notice", title: "Coin toss", lines, done }));
  }

  /** Pushes an overlay and resolves when its Continue is picked. */
  private wait(make: (done: () => void) => Overlay): Promise<void> {
    return new Promise((resolve) => {
      const o = make(() => {
        this.stack = this.stack.filter((x) => x !== o);
        this.render();
        resolve();
      });
      this.stack.push(o);
      this.highlight = 0;
      this.render();
    });
  }

  private setPlayText(g: GameView, ev: PlayEvent): void {
    const ctx = this.textCtx(g);
    g.lastPlay = ev;
    g.result = resultLine(ev, ctx);
    g.calls = callsLine(ev, ctx);
    g.why = whyHeadline(ev.play);
    if (g.why === null) console.warn(`No explanation for play ${ev.after.period}:${ev.before.clock} (seed ${g.matchup.seed}, event ${g.events.length - 1}).`);
    this.announce(g);
  }

  private announce(g: GameView): void {
    this.root.live.textContent = [g.result, g.calls, ...g.eventLines, g.why ?? "No explanation for this play."].filter((x) => x !== "").join(" ");
  }

  private async animate(g: GameView, ev: PlayEvent, runoff: number, prev: GameState): Promise<void> {
    if (this.templates === null || this.ui === null) return;
    const tl = timeline(
      { event: ev, runoffSeconds: runoff, ...(prev.trySpots === null ? {} : { tryKickSpot: prev.trySpots.kick }) },
      this.templates,
      { presetPackage: this.ui.presetPackage, endZoneYards: this.ui.rules.field.endZoneYards, numbers: this.numbers() },
    );
    const flip = g.framePossession !== null && g.framePossession !== ev.before.possession;
    if (flip) this.animator.idle(this.sceneFor(ev.before.possession, ev.before.spot, null), false, !this.reducedMotion());
    g.framePossession = ev.before.possession;
    this.animating = true;
    this.render();
    await this.animator.play(tl, this.sceneFor(ev.before.possession, tl.los, tl.firstDown), {
      speed: this.settings.speed,
      reducedMotion: this.reducedMotion(),
      onClock: (s) => {
        this.clockOverride = s;
        this.renderTopBar();
      },
    });
    this.clockOverride = null;
    this.animating = false;
  }

  /** A penalty choice comes after the snap: show the play first, then ask. */
  private async showPending(g: GameView, req: Extract<DecisionRequest, { kind: "penaltyChoice" }>): Promise<void> {
    const key = JSON.stringify(req.pending.play);
    if (g.shownPending === key) return;
    const ev: PlayEvent = { t: "play", before: req.pending.before, offense: req.pending.offense, defense: req.pending.defense, play: req.pending.play, penalty: null, runoffTimeout: false, after: req.pending.before };
    g.eventLines = [];
    await this.animate(g, ev, 0, g.state);
    g.shownPending = key;
    const ctx = this.textCtx(g);
    g.lastPlay = ev;
    g.result = `${playText(ev, ctx)}. ${penaltyText(ev, ctx)}`;
    g.calls = callsLine(ev, ctx);
    g.why = whyHeadline(ev.play);
    this.announce(g);
  }

  private idleField(g: GameView): void {
    const s = g.state;
    if (s.phase === "final" || s.phase === "overtimeToss") return;
    const flip = g.framePossession !== null && g.framePossession !== s.possession;
    if (g.framePossession === null || flip) {
      this.animator.idle(this.sceneFor(s.possession, s.spot, s.phase === "scrimmage" && !s.goalToGo ? s.spot + s.distance : null), false, flip && !this.reducedMotion());
      g.framePossession = s.possession;
    }
  }

  private persist(save: SaveData): void {
    if (!this.storage) return;
    writeSave(save)
      .then(() => {
        this.hasSave = true;
        if (this.storageWarning !== null) {
          this.storageWarning = null;
          this.renderStatus();
        }
      })
      .catch(() => {
        // Quota or a denied write: say so, retry at the next dead ball, never block play.
        this.storageWarning = "This game can't be saved in this browser window.";
        this.renderStatus();
      });
  }

  // ------------------------------------------------------------ input

  private top(): Overlay | undefined {
    return this.stack[this.stack.length - 1];
  }

  private onResize(): void {
    this.layoutNow = layoutFor(window.innerWidth, window.innerHeight, this.templates?.field);
    const l = this.layoutNow;
    this.root.small.hidden = !l.tooSmall;
    this.root.panel.style.left = `${l.panel.left}px`;
    this.root.panel.style.width = `${l.panel.width}px`;
    this.root.canvas.style.width = `${l.field.width}px`;
    this.animator.redraw();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.layoutNow.tooSmall || this.fatal !== null || this.loading !== null) return;
    const k = e.key;
    if (this.animating) {
      // Only skip and speed work during the animation; nothing else is buffered.
      if (k === " " || k === "Enter") this.animator.skip();
      else if (k === "s" || k === "S") {
        this.settings.speed = this.animator.cycleSpeed(this.settings.speed);
        saveSettings(this.settings);
        this.status = `Animation speed: ${this.settings.speed}`;
        this.renderStatus();
      }
      e.preventDefault();
      return;
    }
    const list = this.currentRows();
    let key: string | null = null;
    if (/^[1-7]$/.test(k)) key = k;
    else if (k === "t" || k === "T") key = "T";
    else if (k === "Escape" || k === "Backspace") key = "Esc";
    else if (k === " ") key = list.some((r) => r.key === "Space") ? "Space" : null;
    else if (k === "ArrowLeft") key = "Left";
    else if (k === "ArrowRight") key = "Right";
    else if (k === "d" || k === "D") {
      if (this.top()?.id === "game" && this.game?.lastPlay !== null && this.game !== null) this.openOverlay({ id: "details" });
      e.preventDefault();
      return;
    } else if (k === "ArrowDown" || k === "ArrowUp") {
      if (this.top()?.id === "roster") this.moveRosterSelection(k === "ArrowDown" ? 1 : -1);
      else if (list.length > 0) this.highlight = (this.highlight + (k === "ArrowDown" ? 1 : list.length - 1)) % list.length;
      this.render();
      e.preventDefault();
      return;
    } else if (k === "Enter") key = this.top()?.id === "roster" ? "Enter" : (list[this.highlight]?.key ?? null);
    if (key === null) return;
    e.preventDefault();
    this.pick(key);
  }

  /** The rows the current screen shows, as key and label (for Enter and the highlight). */
  private currentRows(): readonly { key: string }[] {
    const top = this.top();
    if (top?.id === "game") {
      const g = this.game;
      if (g?.menu === null || g?.menu === undefined || this.ui === null) return [];
      return menuRows(g.menu, this.menuData(), this.menuExtra(g));
    }
    return this.screenModel()?.rows ?? [];
  }

  private menuData(): MenuData {
    return { catalog: (this.ui as UiData).catalog, labels: this.labels };
  }

  private menuExtra(g: GameView): Parameters<typeof menuRows>[2] {
    const req = g.request;
    if (req?.kind !== "penaltyChoice") return {};
    const ctx = this.textCtx(g);
    return { penaltyLabels: req.choices.map((c) => penaltyChoiceText(c, ctx, req.pending.play.fouls)) };
  }

  private pick(key: string): void {
    const top = this.top();
    if (top === undefined) return;
    this.status = "";
    if (top.id === "game") return this.pickInGame(key);
    const model = this.screenModel();
    const row = model?.rows.find((r) => r.key === key);
    // The pause menu's seven rows leave no room for Esc; Esc there resumes.
    if (row === undefined && key === "Esc" && top.id === "pause") return this.back();
    if (row === undefined) return;
    if (!row.on) {
      this.status = row.reason === undefined ? "Not available." : `${row.label}: ${row.reason}.`;
      this.renderStatus();
      return;
    }
    this.act(top, row);
  }

  private pickInGame(key: string): void {
    const g = this.game;
    if (g === null || g.menu === null || this.ui === null) return;
    const wasFirst = isFirstScreen(g.menu);
    const { menu, effect } = press(g.menu, key as MenuKey, this.menuData());
    if (key === "Esc" && !wasFirst) bumpLog((l) => l.escBackOuts++);
    g.menu = menu;
    this.highlight = 0;
    switch (effect.t) {
      case "reason":
        this.status = reasonText(effect.reason);
        break;
      case "pause":
        this.openOverlay({ id: "pause" });
        return;
      case "submit": {
        const req = g.request as DecisionRequest;
        if (effect.answer.kind === "offense" || effect.answer.kind === "defense") {
          const row = menuRows(g.menu, this.menuData()).find((r) => r.key === key);
          if (row?.same === true) bumpLog((l) => l.sameCalls++);
        }
        if (effect.answer.kind !== "tempo") {
          const secs = (performance.now() - g.requestAt) / 1000;
          bumpLog((l) => l.deadBallSeconds.push(Math.round(secs * 10) / 10));
          g.menu = null;
        }
        this.client.send({ t: "answer", seq: req.seq, answer: effect.answer });
        break;
      }
      case "none":
        break;
    }
    this.render();
  }

  private openOverlay(o: Overlay): void {
    if (o.id === "details") bumpLog((l) => l.detailsOpens++);
    if (o.id === "box" || o.id === "card") this.client.send({ t: "box" });
    this.stack.push(o);
    this.highlight = 0;
    this.render();
  }

  private back(): void {
    if (this.stack.length > 1) this.stack.pop();
    this.highlight = 0;
    this.render();
  }

  private act(top: Overlay, row: ScreenRow): void {
    const a = row.action;
    switch (a) {
      case "back":
        if (top.id === "saveError") this.stack = [{ id: "title" }];
        this.back();
        return;
      case "newGame":
        this.seed = randomSeed();
        this.human = "home";
        this.matchup = null;
        this.client.send({ t: "matchup", leagueSeed: this.leagueSeed, seed: this.seed });
        this.stack = [{ id: "title" }, { id: "pregame" }];
        this.render();
        return;
      case "continue":
        if (top.id === "title") {
          void readSave()
            .then((save) => this.client.send({ t: "resume", save }))
            .catch(() => {
              this.status = "The save couldn't be read.";
              this.renderStatus();
            });
          return;
        }
        if (top.id === "notice" || top.id === "halftime") top.done();
        return;
      case "settings":
        this.openOverlay({ id: "settings" });
        return;
      case "start":
        this.client.send({ t: "newGame", leagueSeed: this.leagueSeed, seed: this.seed, human: this.human });
        return;
      case "swap":
        this.human = other(this.human);
        this.render();
        return;
      case "newMatchup":
        this.seed = randomSeed();
        this.matchup = null;
        this.game = null;
        this.client.send({ t: "matchup", leagueSeed: this.leagueSeed, seed: this.seed });
        this.stack = [{ id: "title" }, { id: "pregame" }];
        this.render();
        return;
      case "rematch":
        if (this.game !== null) {
          this.human = this.game.human;
          this.matchup = null;
          this.client.send({ t: "rematch", leagueSeed: this.game.matchup.leagueSeed, seed: this.game.matchup.seed });
          this.game = null;
        }
        this.stack = [{ id: "title" }, { id: "pregame" }];
        this.render();
        return;
      case "yourRoster":
      case "theirRoster": {
        const team = a === "yourRoster" ? this.human : other(this.human);
        this.openOverlay({ id: "roster", team, unit: "Offense", sel: 0 });
        return;
      }
      case "unit":
        if (top.id === "roster") {
          top.unit = UNITS[(UNITS.indexOf(top.unit) + 1) % UNITS.length] as Unit;
          top.sel = 0;
        }
        this.render();
        return;
      case "open":
        if (top.id === "roster") {
          const ids = this.rosterIds(top.team, top.unit);
          this.openCard(ids, top.sel);
        }
        return;
      case "prev":
      case "next":
        if (top.id === "card") {
          top.index = Math.max(0, Math.min(top.ids.length - 1, top.index + (a === "next" ? 1 : -1)));
          this.requestRanks(top.ids[top.index] as string);
        }
        this.render();
        return;
      case "ratingDetail":
        if (top.id === "card") this.openOverlay({ id: "ratingDetail", playerId: top.ids[top.index] as string });
        return;
      case "resume":
        this.back();
        return;
      case "details":
        this.openOverlay({ id: "details" });
        return;
      case "box":
        this.openOverlay({ id: "box", tab: "Team" });
        return;
      case "speed":
        this.settings.speed = this.settings.speed === "1x" ? "2x" : this.settings.speed === "2x" ? "skip" : "1x";
        saveSettings(this.settings);
        this.render();
        return;
      case "controls":
        this.openOverlay({ id: "controls" });
        return;
      case "quit":
      case "title":
        this.animator.stop();
        this.game = null;
        this.stack = [{ id: "title" }];
        this.render();
        return;
      case "pause":
        this.openOverlay({ id: "pause" });
        return;
      case "textSize":
        this.settings.textSize = this.settings.textSize === 100 ? 125 : this.settings.textSize === 125 ? 150 : this.settings.textSize === 150 ? 200 : 100;
        this.applyTextSize();
        break;
      case "reducedMotion":
        this.settings.reducedMotion = this.settings.reducedMotion === "system" ? "on" : this.settings.reducedMotion === "on" ? "off" : "system";
        break;
      case "markLabels":
        this.settings.markLabels = this.settings.markLabels === "involved" ? "all" : this.settings.markLabels === "all" ? "none" : "involved";
        break;
      case "copy":
        this.copyDetails(top);
        return;
      case "deleteSave":
        void deleteSave().finally(() => {
          this.hasSave = false;
          this.stack = [{ id: "title" }];
          this.render();
        });
        return;
      case "restart":
        void readSave()
          .then((save) => (save === undefined ? Promise.reject(new Error("no save")) : this.client.send({ t: "resume", save })))
          .catch(() => {
            this.status = "There is no save to restart from.";
            this.renderStatus();
          });
        return;
      default:
        if (a.startsWith("tab:") && top.id === "box") top.tab = a.slice(4) as BoxTab;
        this.render();
        return;
    }
    saveSettings(this.settings);
    this.animator.redraw();
    this.render();
  }

  private applyTextSize(): void {
    document.documentElement.style.setProperty("--text-scale", String(this.settings.textSize / 100));
  }

  private copyDetails(top: Overlay): void {
    let text = "";
    if (top.id === "simError") text = JSON.stringify({ error: top.info, save: this.game?.save ?? null });
    else if (this.game?.lastPlay !== null && this.game !== null) {
      const g = this.game;
      text = JSON.stringify({ seed: g.matchup.seed, leagueSeed: g.matchup.leagueSeed, playNumber: g.state.playCount, event: g.lastPlay });
    }
    navigator.clipboard
      .writeText(text)
      .then(() => (this.status = "Copied."))
      .catch(() => (this.status = "Couldn't copy: the browser blocked the clipboard."))
      .finally(() => this.renderStatus());
  }

  private rosterIds(team: Team, unit: Unit): string[] {
    const m = this.game?.matchup ?? this.matchup;
    if (m === null || m === undefined) return [];
    return m[team].pool.players.filter((p) => POSITION_UNIT[p.position] === unit).map((p) => p.id);
  }

  private moveRosterSelection(d: number): void {
    const top = this.top();
    if (top?.id !== "roster") return;
    const n = this.rosterIds(top.team, top.unit).length;
    if (n > 0) top.sel = (top.sel + d + n) % n;
  }

  private openCard(ids: readonly string[], index: number): void {
    if (ids.length === 0) return;
    this.requestRanks(ids[index] as string);
    this.openOverlay({ id: "card", ids, index });
  }

  private requestRanks(id: string): void {
    if (!this.ranks.has(id)) this.client.send({ t: "ranks", playerId: id, leagueSeed: this.game?.matchup.leagueSeed ?? this.leagueSeed });
  }

  // ------------------------------------------------------------ rendering

  private screenModel(): ScreenModel | null {
    const top = this.top();
    if (top === undefined) return null;
    switch (top.id) {
      case "title":
        return titleScreen({ hasSave: this.hasSave, storage: this.storage });
      case "pregame":
        return pregameScreen();
      case "roster":
        return rosterScreen({ team: this.teamOf(top.team)?.name ?? "", unit: top.unit, empty: this.rosterIds(top.team, top.unit).length === 0 });
      case "card":
        return cardScreen({ hasPrev: top.index > 0, hasNext: top.index < top.ids.length - 1 });
      case "ratingDetail":
        return ratingDetailScreen();
      case "pause":
        return pauseScreen({ hasPlay: this.game?.lastPlay !== null && this.game !== null, speed: this.settings.speed });
      case "settings":
        return settingsScreen(this.settings);
      case "controls":
        return controlsScreen();
      case "details":
        return detailsScreen();
      case "box":
        return boxScreen(top.tab);
      case "notice":
        return noticeScreen("notice", top.title);
      case "halftime":
        return halftimeScreen();
      case "end":
        return endScreen();
      case "saveError":
        return saveErrorScreen(top.reason);
      case "simError":
        return simErrorScreen();
      case "game":
        return null;
    }
  }

  private teamOf(t: Team): TeamSummary | undefined {
    return (this.game?.matchup ?? this.matchup ?? undefined)?.[t];
  }

  private render(): void {
    this.renderTopBar();
    const p = this.root.panel;
    p.replaceChildren(...this.panelContent());
    this.renderStatus();
    // Keep keyboard focus on the highlighted row, so screen readers follow the menu.
    const btn = p.querySelectorAll<HTMLButtonElement>("button.row")[this.highlight];
    if (btn !== undefined && document.activeElement !== btn) btn.focus({ preventScroll: true });
    if (this.stack.length > 0 && this.game === null && this.templates !== null) {
      this.animator.idle(this.sceneFor("home", 25, null), false, false);
    }
  }

  private renderStatus(): void {
    const el = this.root.panel.querySelector<HTMLElement>(".status");
    if (el === null) return;
    const parts = [this.working ? "Working..." : "", this.status, this.storageWarning ?? ""].filter((x) => x !== "");
    el.textContent = parts.join(" ");
  }

  private renderTopBar(): void {
    const bar = this.root.topBar;
    const g = this.game;
    if (g === null) {
      bar.replaceChildren(h("span", { class: "brand" }, "Clipboard Football"));
      return;
    }
    const s = g.state;
    const perHalf = this.ui?.rules.timeouts.perHalf ?? 3;
    const team = (t: Team): HTMLElement => {
      const info = g.matchup[t];
      const pips = h("span", { class: "pips", "aria-label": `${s.timeouts[t]} timeouts left` });
      for (let i = 0; i < perHalf; i++) pips.append(h("span", { class: i < s.timeouts[t] ? "pip on" : "pip", "aria-hidden": "true" }));
      const ball = s.possession === t && s.phase !== "final" ? h("span", { class: "ball" }, h("span", { class: "dot", "aria-hidden": "true" }), "ball") : null;
      return h("span", { class: "team" }, swatch(swatchFor(info.index)), h("span", { class: "abbr" }, abbrev(info), t === g.human ? " (you)" : ""), h("span", { class: "score mono" }, String(s.score[t])), pips, ball);
    };
    const clock = this.clockOverride ?? s.clock;
    const regulation = this.ui?.rules.game.regulationPeriods ?? 4;
    const lateHalf = s.phase !== "final" && clock <= 120 && (s.period % 2 === 0 || s.period > regulation);
    const clockEl = h("span", { class: lateHalf ? "clock mono late" : "clock mono" }, clockText(clock));
    const tempo = g.request?.kind === "offenseCall" && g.request.tempo !== "normal" ? h("span", { class: "tempo" }, tempoText(g.request.tempo)) : null;
    bar.replaceChildren(
      team("away"),
      team("home"),
      h(
        "span",
        { class: "time" },
        h("span", { class: "period" }, s.phase === "final" ? "Final" : periodText(s.period, regulation)),
        clockEl,
        h("span", { class: "clock-state" }, s.clockRunning ? "running" : "stopped"),
        lateHalf ? h("span", { class: "late-note" }, "under 2:00") : null,
        tempo,
      ),
    );
  }

  private rowButton(r: { key: string; label: string; on: boolean; reason?: string; note?: string }, i: number, onClick: () => void): HTMLElement {
    const keyText = r.key === "Esc" ? "Esc" : r.key === "Space" ? "Space" : r.key === "Left" ? "←" : r.key === "Right" ? "→" : r.key;
    const b = h(
      "button",
      { class: `row${r.on ? "" : " off"}${i === this.highlight ? " hl" : ""}`, type: "button", "aria-disabled": r.on ? undefined : "true" },
      h("span", { class: "key mono" }, keyText),
      h("span", { class: "label" }, r.label),
      r.note === undefined ? null : h("span", { class: "note" }, `(${r.note})`),
      r.on ? null : h("span", { class: "reason" }, `(${r.reason ?? "not now"})`),
    );
    b.addEventListener("click", onClick);
    b.addEventListener("mouseenter", () => {
      this.highlight = i;
      for (const x of this.root.panel.querySelectorAll("button.row")) x.classList.remove("hl");
      b.classList.add("hl");
    });
    return b;
  }

  private rowsGroup(label: string, list: readonly { key: string; label: string; on: boolean; reason?: string; note?: string }[]): HTMLElement {
    const group = h("div", { class: "rows", role: "group", "aria-label": label });
    list.forEach((r, i) => group.append(this.rowButton(r, i, () => (this.animating ? undefined : this.pick(r.key)))));
    return group;
  }

  private panelContent(): HTMLElement[] {
    if (this.fatal !== null) return [h("h1", {}, this.fatal.title), ...this.fatal.lines.map((l) => h("p", { class: "soft" }, l))];
    if (this.loading !== null) {
      const pct = Math.round((this.loading.done / Math.max(1, this.loading.total)) * 100);
      const meter = h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) });
      const fill = h("div", { class: "progress-fill" });
      fill.style.width = `${pct}%`;
      meter.append(fill);
      return [h("h1", {}, "Loading league data"), meter, h("p", { class: "soft mono" }, `${this.loading.done} of ${this.loading.total} files${this.loading.file === "" ? "" : `: ${this.loading.file}`}`)];
    }
    const top = this.top();
    if (top === undefined) return [];
    if (top.id === "game") return this.gamePanel();
    const model = this.screenModel() as ScreenModel;
    return [h("h1", {}, model.title), ...this.screenBody(top), this.rowsGroup(model.title, model.rows), h("p", { class: "status", role: "status" })];
  }

  private gamePanel(): HTMLElement[] {
    const g = this.game;
    if (g === null || this.ui === null) return [];
    const s = g.request?.view ?? g.state;
    const header = h("div", { class: "situation" }, h("div", { class: "dd mono" }, situationText(s, g.human)), h("div", { class: "side" }, sideText(s, g.human)));
    const playText = h(
      "div",
      { class: "report" },
      g.result === "" ? h("p", { class: "result soft" }, "No plays yet.") : h("p", { class: "result" }, g.result),
      g.calls === "" ? null : h("p", { class: "calls" }, g.calls),
      ...g.eventLines.map((l) => h("p", { class: "event" }, l)),
      g.lastPlay === null ? null : h("p", { class: "why" }, g.why ?? "No explanation for this play.", " ", h("span", { class: "hint" }, "D: details")),
    );
    const out: HTMLElement[] = [header, playText];
    if (g.menu !== null && g.request !== null && !this.animating) {
      const m = g.menu;
      const crumbs = breadcrumb(m, this.menuData());
      const req = g.request;
      if (req.kind === "continue") out.push(h("p", { class: "lineup" }, lineUpText(req.lineUp, g.matchup[other(g.human)])));
      out.push(h("h2", {}, menuTitle(m, this.menuData()), crumbs === "" ? "" : `: ${crumbs}`));
      out.push(this.rowsGroup(menuTitle(m, this.menuData()), menuRows(m, this.menuData(), this.menuExtra(g)).map((r: Row) => (r.on ? r : { ...r, reason: reasonText(r.reason) }))));
      if (current(m) === "offense.clock" && req.kind === "offenseCall") out.push(h("p", { class: "soft" }, `Clock ${g.state.clockRunning ? "running" : "stopped"}. Tempo: ${tempoText(req.tempo)} (resets each drive).`));
    } else if (this.animating) {
      out.push(h("p", { class: "soft" }, "Space: skip. S: speed (", this.settings.speed, ")."));
    }
    out.push(h("p", { class: "status", role: "status" }));
    return out;
  }

  private screenBody(top: Overlay): HTMLElement[] {
    switch (top.id) {
      case "title":
        return [h("p", {}, "Call the plays. The X's and O's run them."), this.storage ? null : h("p", { class: "soft" }, "This game can't be saved in this browser window.")].filter((x): x is HTMLElement => x !== null);
      case "pregame":
        return this.pregameBody();
      case "roster":
        return this.rosterBody(top);
      case "card":
        return this.cardBody(top.ids[top.index] as string);
      case "ratingDetail":
        return this.ratingDetailBody(top.playerId);
      case "notice":
        return top.lines.map((l) => h("p", {}, l));
      case "halftime":
        return this.halftimeBody();
      case "end":
        return this.endBody();
      case "box":
        return this.boxBody(top.tab);
      case "details":
        return this.detailsBody();
      case "controls":
        return [
          h(
            "table",
            { class: "keys" },
            ...[
              ["1-7", "Pick the numbered row"],
              ["Esc, Backspace", "Back one menu; on a first screen, the pause menu"],
              ["T", "Timeout (first screen only)"],
              ["D", "Last play details"],
              ["Space, Enter", "Continue; during the animation, skip to the end"],
              ["S", "Animation speed 1x, 2x, skip (during the animation)"],
              ["Arrows", "Move the highlight; Enter picks it. Left and right page player cards"],
            ].map(([k, v]) => h("tr", {}, h("th", { class: "mono" }, k as string), h("td", {}, v as string))),
          ),
        ];
      case "settings":
        return [h("p", { class: "soft" }, `Mark labels: ${MARK_LABEL_TEXT[this.settings.markLabels]}.`)];
      case "saveError":
        return [h("p", {}, top.reason === "older" ? "This save is from an older version and can't be resumed." : "This save is damaged and can't be resumed.")];
      case "simError":
        return [h("p", {}, `Seed ${top.info.seed ?? "unknown"}, play ${top.info.playCount ?? "unknown"}.`), h("p", { class: "soft mono" }, `${top.info.name}: ${top.info.message}`)];
      default:
        return [];
    }
  }

  private unitAverage(pool: TeamPool, unit: Unit): number {
    const vals = pool.players.filter((p) => POSITION_UNIT[p.position] === unit).flatMap((p) => [...Object.values(p.ratings), ...Object.values(p.skills)]);
    return vals.length === 0 ? 0 : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  private pregameBody(): HTMLElement[] {
    const m = this.matchup;
    if (m === null) return [h("p", { class: "soft" }, "Drawing a matchup...")];
    const you = m[this.human];
    const them = m[other(this.human)];
    const teamLine = (t: TeamSummary, side: Team): HTMLElement => h("span", { class: "matchup-team" }, swatch(swatchFor(t.index)), `${t.name} (${side})`);
    const unitBars = (t: TeamSummary): HTMLElement => h("div", { class: "units" }, h("h3", {}, t.nickname), ...UNITS.map((u) => bar(u, this.unitAverage(t.pool, u), this.unitAverage(t.pool, u) / 99)));
    return [
      h("p", { class: "matchup" }, "You: ", teamLine(you, this.human), " vs ", teamLine(them, other(this.human))),
      h("div", { class: "unit-cols" }, unitBars(you), unitBars(them)),
      h("p", { class: "soft mono" }, `Seed ${m.seed}, league seed ${m.leagueSeed}. Unit bars are averages of the players' ratings.`),
    ];
  }

  private rosterBody(top: Extract<Overlay, { id: "roster" }>): HTMLElement[] {
    const t = this.teamOf(top.team);
    if (t === undefined) return [];
    const players = t.pool.players.filter((p) => POSITION_UNIT[p.position] === top.unit);
    const table = h("table", { class: "roster", "aria-label": `${t.name} ${top.unit}` }, h("tr", {}, ...["#", "Name", "Pos", "Spd", "Str", "Agi", "Awr"].map((c) => h("th", {}, c))));
    players.forEach((p, i) => {
      const tr = h("tr", { class: i === top.sel ? "sel" : "", "aria-selected": i === top.sel ? "true" : "false" }, h("td", { class: "mono" }, String(t.numbers[p.id] ?? "")), h("td", {}, p.name), h("td", {}, p.position), ...["speed", "strength", "agility", "awareness"].map((r) => h("td", { class: "mono" }, String((p.ratings as Record<string, number>)[r]))));
      tr.addEventListener("click", () => {
        top.sel = i;
        this.openCard(players.map((x) => x.id), i);
      });
      table.append(tr);
    });
    return [h("p", { class: "soft" }, `Unit: ${top.unit}. Up and down choose a player.`), table];
  }

  private playerById(id: string): { p: TeamPool["players"][number]; team: TeamSummary } | null {
    const m = this.game?.matchup ?? this.matchup;
    if (m === null || m === undefined) return null;
    for (const team of [m.home, m.away]) {
      const p = team.pool.players.find((x) => x.id === id);
      if (p !== undefined) return { p, team };
    }
    return null;
  }

  private cardBody(id: string): HTMLElement[] {
    const found = this.playerById(id);
    if (found === null) return [];
    const { p, team } = found;
    const ranks = this.ranks.get(id);
    const plural = POSITION_PLURAL[p.position] ?? `${p.position}s`;
    const bars = [...Object.entries(p.ratings), ...Object.entries(p.skills)].map(([k, v]) => {
      const r = ranks?.find((x) => x.rating === k);
      const fill = r === undefined ? 0 : r.of <= 1 ? 1 : (r.of - r.rank) / (r.of - 1);
      return bar(RATING_NAME[k] ?? k, v, fill);
    });
    const line = this.box?.players.find((l) => l.id === id);
    return [
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("span", { class: "mono num" }, `#${team.numbers[id] ?? ""}`), h("span", { class: "name" }, p.name), h("span", { class: "pos" }, p.position), h("span", { class: "soft" }, team.nickname)), h("p", { class: "soft" }, `Compared with other ${plural}${ranks === undefined ? " (loading)" : ""}`), ...bars),
      h("p", {}, `Today: ${line === undefined ? "no stats" : statLine(line)}`),
    ];
  }

  private ratingDetailBody(id: string): HTMLElement[] {
    const found = this.playerById(id);
    const ranks = this.ranks.get(id);
    if (found === null || ranks === undefined) return [h("p", { class: "soft" }, "Loading ranks...")];
    const plural = POSITION_PLURAL[found.p.position] ?? `${found.p.position}s`;
    return [h("p", {}, `#${found.team.numbers[id] ?? ""} ${found.p.name}, ${found.p.position}`), ...ranks.map((r) => h("p", { class: "mono" }, `${RATING_NAME[r.rating] ?? r.rating} ${r.value}: ${ordinalRank(r.rank)} of ${r.of} ${plural}`)), h("p", { class: "soft" }, "Ranks are across the whole generated league. Ties share the higher rank.")];
  }

  private halftimeBody(): HTMLElement[] {
    const g = this.game;
    if (g === null) return [];
    const s = g.state;
    const t = g.matchup;
    const receiver = s.toss.secondHalfReceiver;
    const out: HTMLElement[] = [h("p", { class: "big mono" }, `${t.away.nickname} ${s.score.away}, ${t.home.nickname} ${s.score.home}`)];
    if (this.box !== null) {
      const b = this.box.box;
      const stat = (name: string, f: (x: TeamBox) => string): HTMLElement => h("tr", {}, h("th", {}, name), h("td", { class: "mono" }, f(b.away)), h("td", { class: "mono" }, f(b.home)));
      out.push(h("table", { class: "box" }, h("tr", {}, h("th", {}, ""), h("th", {}, t.away.nickname), h("th", {}, t.home.nickname)), stat("Total yards", (x) => String(x.rushYards + x.passYards - x.sackYards)), stat("Turnovers", (x) => String(x.interceptions + x.fumblesLost)), stat("3rd down", (x) => `${x.thirdDownConversions}-${x.thirdDownAttempts}`)));
    } else out.push(h("p", { class: "soft" }, "Loading the box score..."));
    out.push(this.topPlayers(3));
    out.push(h("p", {}, receiver === g.human ? "You receive the second-half kickoff." : `The ${t[receiver].nickname} receive the second-half kickoff.`));
    return out;
  }

  private topPlayers(n: number): HTMLElement {
    const lines = this.box?.players ?? [];
    const scored = lines
      .map((l) => ({ l, y: (l.passing?.yards ?? 0) + (l.rushing?.yards ?? 0) + (l.receiving?.yards ?? 0) + 20 * ((l.defense?.sacks ?? 0) + (l.defense?.interceptions ?? 0)) }))
      .sort((a, b) => b.y - a.y)
      .slice(0, n);
    if (scored.length === 0) return h("p", { class: "soft" }, "No player stats yet: the engine doesn't name the players in each play yet.");
    return h("div", {}, h("h3", {}, "Top players"), ...scored.map(({ l }) => h("p", {}, `${this.nameOf(l.id)}: ${statLine(l)}`)));
  }

  private nameOf(id: string): string {
    const f = this.playerById(id);
    return f === null ? id : `#${f.team.numbers[id] ?? ""} ${f.p.name}`;
  }

  private endBody(): HTMLElement[] {
    const g = this.game;
    if (g === null) return [];
    const s = g.state;
    const t = g.matchup;
    const winner = s.result?.winner ?? null;
    const verdict = winner === null ? "Tie." : winner === g.human ? "You win." : "You lose.";
    const standouts = g.events.filter((e): e is PlayEvent => e.t === "play" && readDetail(e.play).standout !== undefined);
    return [
      h("p", { class: "big mono" }, `${t.away.nickname} ${s.score.away}, ${t.home.nickname} ${s.score.home}`),
      h("p", {}, verdict),
      this.topPlayers(3),
      h("h3", {}, "Standout plays"),
      standouts.length === 0 ? h("p", { class: "soft" }, "None this game.") : h("div", {}, ...standouts.map((e) => h("p", {}, resultLine(e, this.textCtx(g))))),
      h("p", { class: "soft mono" }, `Seed ${t.seed}, league seed ${t.leagueSeed}.`),
    ];
  }

  private boxBody(tab: BoxTab): HTMLElement[] {
    const g = this.game;
    if (g === null) return [h("p", { class: "soft" }, "No game.")];
    const t = g.matchup;
    const teams = h("p", {}, swatch(swatchFor(t.away.index)), ` ${t.away.name} at `, swatch(swatchFor(t.home.index)), ` ${t.home.name}`);
    if (this.box === null) return [teams, h("p", { class: "soft" }, "Loading...")];
    const { box, players } = this.box;
    const reg = this.ui?.rules.game.regulationPeriods ?? 4;
    const byQ = h(
      "table",
      { class: "box" },
      h("tr", {}, h("th", {}, ""), ...Array.from({ length: box.periods }, (_, i) => h("th", {}, periodText(i + 1, reg))), h("th", {}, "Final")),
      ...(["away", "home"] as const).map((side) => h("tr", {}, h("th", {}, swatch(swatchFor(t[side].index)), ` ${t[side].nickname}`), ...box[side].byPeriod.map((x) => h("td", { class: "mono" }, String(x))), h("td", { class: "mono" }, String(g.state.score[side])))),
    );
    const out: HTMLElement[] = [teams, byQ];
    if (!g.events.some((e) => e.t === "play")) return [...out, h("p", { class: "soft" }, "No plays yet.")];
    const dash = (v: number | undefined): string => (v === undefined ? "-" : String(v));
    const table = (head: readonly string[], rows: readonly (readonly string[])[]): HTMLElement =>
      rows.length === 0 ? h("p", { class: "soft" }, "No player stats yet: the engine doesn't name the players in each play yet.") : h("table", { class: "box" }, h("tr", {}, ...head.map((c) => h("th", {}, c))), ...rows.map((r) => h("tr", {}, ...r.map((c, i) => h(i === 0 ? "th" : "td", { class: i === 0 ? "" : "mono" }, c)))));
    const who = (l: PlayerLine): string => `${this.nameOf(l.id)} (${t[l.team].nickname})`;
    switch (tab) {
      case "Team": {
        const stat = (name: string, f: (x: TeamBox) => string): readonly string[] => [name, f(box.away), f(box.home)];
        out.push(
          table(
            ["", t.away.nickname, t.home.nickname],
            [
              stat("First downs", (x) => String(x.firstDowns)),
              stat("Total yards", (x) => String(x.rushYards + x.passYards - x.sackYards)),
              stat("Rushing (att-yds)", (x) => `${x.rushAttempts}-${x.rushYards}`),
              stat("Passing (comp-att, yds)", (x) => `${x.completions}-${x.passAttempts}, ${x.passYards}`),
              stat("Sacks-yards lost", (x) => `${x.sacks}-${x.sackYards}`),
              stat("Turnovers", (x) => String(x.interceptions + x.fumblesLost)),
              stat("Penalties-yards", (x) => `${x.penalties}-${x.penaltyYards}`),
              stat("3rd down", (x) => `${x.thirdDownConversions}-${x.thirdDownAttempts}`),
              stat("4th down", (x) => `${x.fourthDownConversions}-${x.fourthDownAttempts}`),
              stat("Time of possession", (x) => clockText(x.possessionSeconds)),
              stat("Punts", (x) => String(x.punts)),
              stat("Field goals", (x) => `${x.fieldGoalsMade}-${x.fieldGoalAttempts}`),
              stat("Challenges won-lost", () => "-"),
            ],
          ),
        );
        out.push(h("p", { class: "soft" }, "Challenges aren't in the game yet."));
        break;
      }
      case "Offense players":
        out.push(h("h3", {}, "Passing"), table(["Player", "C/A", "Yds", "TD", "INT", "Sk"], players.filter((l) => l.passing !== undefined).map((l) => [who(l), `${l.passing?.completions}/${l.passing?.attempts}`, dash(l.passing?.yards), dash(l.passing?.touchdowns), dash(l.passing?.interceptions), dash(l.passing?.sacked)])));
        out.push(h("h3", {}, "Rushing"), table(["Player", "Att", "Yds", "TD", "Long"], players.filter((l) => l.rushing !== undefined).map((l) => [who(l), dash(l.rushing?.attempts), dash(l.rushing?.yards), dash(l.rushing?.touchdowns), dash(l.rushing?.long)])));
        out.push(h("h3", {}, "Receiving"), table(["Player", "Tgt", "Rec", "Yds", "TD", "Long"], players.filter((l) => l.receiving !== undefined).map((l) => [who(l), dash(l.receiving?.targets), dash(l.receiving?.catches), dash(l.receiving?.yards), dash(l.receiving?.touchdowns), dash(l.receiving?.long)])));
        break;
      case "Defense players":
        out.push(table(["Player", "Tkl", "Sk", "INT", "FF", "FR"], players.filter((l) => l.defense !== undefined).map((l) => [who(l), dash(l.defense?.tackles), dash(l.defense?.sacks), dash(l.defense?.interceptions), dash(l.defense?.forcedFumbles), dash(l.defense?.recoveries)])));
        break;
      case "Kicking":
        out.push(table(["Player", "FG", "Long", "XP", "Punts", "Avg"], players.filter((l) => l.kicking !== undefined).map((l) => { const k = l.kicking as NonNullable<PlayerLine["kicking"]>; return [who(l), `${k.fieldGoalsMade}/${k.fieldGoalAttempts}`, k.fieldGoalsMade > 0 ? String(k.long) : "-", `${k.extraPointsMade}/${k.extraPointAttempts}`, String(k.punts), k.punts > 0 ? (k.puntYards / k.punts).toFixed(1) : "-"]; })));
        break;
      case "Drives": {
        const res: Record<string, string> = { touchdown: "Touchdown", fieldGoal: "Field goal", missedFieldGoal: "Missed FG", punt: "Punt", turnover: "Turnover", downs: "Downs", endOfHalf: "End of half", safety: "Safety" };
        out.push(table(["Team", "Qtr", "Start", "Plays", "Yds", "Time", "Result"], box.drives.map((d) => [t[d.team].nickname, periodText(d.period, reg), d.start < 50 ? `own ${d.start}` : d.start === 50 ? "50" : `opp ${100 - d.start}`, String(d.plays), String(d.yards), clockText(d.seconds), res[d.result] ?? d.result])));
        break;
      }
    }
    return out;
  }

  private detailsBody(): HTMLElement[] {
    const g = this.game;
    const ev = g?.lastPlay ?? null;
    if (g === null || ev === null) return [h("p", { class: "soft" }, "No plays yet.")];
    const d = readDetail(ev.play);
    const out: HTMLElement[] = [h("p", { class: "why" }, g.why ?? "No explanation for this play.")];
    if (d.why !== undefined && d.why !== g.why) out.push(h("p", {}, d.why));
    const items = (d.trace ?? []).map((e) => h("li", {}, traceText(e)));
    out.push(items.length === 0 ? h("p", { class: "soft" }, "The engine recorded no factors for this play.") : h("ul", { class: "trace" }, ...items));
    out.push(h("p", { class: "soft mono" }, `Seed ${g.matchup.seed}, play ${g.state.playCount}.`));
    return out;
  }
}

/** A trace entry in plain labels, with its multipliers and probabilities. */
export function traceText(e: TraceEntry): string {
  const v = (k: string): string => String(e[k] ?? "");
  switch (e.factor) {
    case "call":
      return `Call: ${v("label")}`;
    case "cell":
      return `Situation table: ${v("family")}, level ${v("level")} (${v("key")})`;
    case "class":
      return `Result: ${v("label")}, ${v("basePct")}% before adjustments, ${v("pct")}% after`;
    case "matchup":
      return `Matchup against ${v("presetLabel")}: x${v("multiplier")} on ${v("class")}`;
    case "formation":
      return `${v("formationLabel")} against ${v("packageLabel")}: x${v("multiplier")} on ${v("class")}`;
    case "rating":
      return `${v("label")}: x${v("multiplier")} on ${v("class")}`;
    case "penalty":
      return `Flag: ${v("label")} on the ${v("side")}`;
    case "fluke":
      return `Fluke: ${v("what")} (${v("reason")}, percentile ${v("pctile")})`;
    case "special":
      return `Kick: ${v("event")}${e["gross"] === undefined ? "" : `, ${v("gross")} yards gross`}`;
    case "fieldGoal":
      return `Field goal: ${v("distance")} yards, ${v("pct")}% make chance`;
    default:
      return `${e.factor}: ${Object.entries(e)
        .filter(([k]) => k !== "factor")
        .map(([k, x]) => `${k} ${String(x)}`)
        .join(", ")}`;
  }
}

function ordinalRank(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** One line of a player's stats today. */
export function statLine(l: PlayerLine): string {
  const parts: string[] = [];
  if (l.passing !== undefined) parts.push(`${l.passing.completions}/${l.passing.attempts}, ${l.passing.yards} yds, ${l.passing.touchdowns} TD, ${l.passing.interceptions} INT`);
  if (l.rushing !== undefined) parts.push(`${l.rushing.attempts} carries, ${l.rushing.yards} yds`);
  if (l.receiving !== undefined) parts.push(`${l.receiving.catches} catches, ${l.receiving.yards} yds`);
  if (l.defense !== undefined) parts.push(`${l.defense.tackles} tackles, ${l.defense.sacks} sacks, ${l.defense.interceptions} INT`);
  if (l.kicking !== undefined) parts.push(`FG ${l.kicking.fieldGoalsMade}/${l.kicking.fieldGoalAttempts}, ${l.kicking.punts} punts`);
  return parts.length === 0 ? "no stats" : parts.join("; ");
}

export { COLOR, type PlayResult };
