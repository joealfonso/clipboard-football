// The app controller: screen flow, keyboard and mouse, the worker conversation, and the panel and
// top bar DOM. The sim runs in the worker; this thread only sees requests, committed events and
// box scores. The opponent's call reaches this thread only in a committed play event, after the
// snap (spec F5). Number keys during the animation are dropped, not buffered (decision 8).

import type { PlayResult, Position, TeamPool } from "@clipboard-football/shared";
import type { BoxScore, TeamBox } from "@clipboard-football/sim";
import type { SaveData } from "../engine/session";
import { SimClient } from "../engine/client";
import { whyHeadline } from "../engine/headline";
import type { FromWorker, Matchup, SimErrorInfo, TeamSummary, UiData } from "../engine/protocol";
import { readDetail, type DecisionRequest, type GameEvent, type GameState, type PlayEvent, type PlayerLine, type RatingRank, type Team, type TraceEntry } from "../engine/types";
import { Animator } from "./animator";
import { bar, h, swatch } from "./dom";
import type { FieldScene, FrameOpts } from "./field";
import { layoutFor, type Layout } from "./layout";
import { deepestUnit, FocusTrail, OVERLAY_IDS, overlayBackground, overlaysShown, placeOverlay, unitDepth, type Guard, type OverlayId, type Placement } from "./overlay";
import { breadcrumb, current, isFirstScreen, openMenu, press, rows as menuRows, title as menuTitle, type MenuData, type MenuExtra, type MenuKey, type MenuState, type Row } from "./menu";
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
import { DEFAULT_SETTINGS, bumpLog, deleteSave, loadSettings, readSave, saveSettings, setSaveAside, storageAvailable, writeSave, type Settings } from "./storage";
import { MotionError, parseMotion, parseTemplates, type Motion, type Templates } from "./templates";
import {
  abbrev,
  callsLine,
  catalogLabels,
  clockText,
  eventLine,
  requestEventLine,
  continueText,
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
import { timeline, type Timeline } from "./timeline";
import { callingFrame, glide } from "./presnap";
import { cardArt, cardScreen as cardKind, cardSvg, personnelLine } from "./cards";
import { NO_PLAY_STAT, playLines, ratingValue } from "./ratings";
import { COLOR, swatchFor } from "./tokens";

/** A menu row as displayed: its reason already in words. */
type MenuRow = Omit<Row, "reason"> & { readonly reason?: string };

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
  /** null until the opening toss is settled. */
  state: GameState | null;
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
  /** The last call was Same call: your side starts in the huddle too (Pre-snap). */
  lastSame: boolean;
  /** Run-off seconds a request snapshot already showed, so the snap doesn't count them down again. */
  runoffShown: number;
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
  private motion: Motion | null = null;
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
  /** The player whose card is open over a mark (hover or the M key), or null. */
  private markCard: string | null = null;
  /** On a first screen the preview waits for the first input (Pre-snap, state 1). */
  private previewArmed = false;
  private previewFrame: Timeline | null = null;
  private previewKey = "";
  private box: { box: BoxScore; players: readonly PlayerLine[] } | null = null;
  private ranks = new Map<string, Readonly<Record<string, RatingRank>>>();
  private clockOverride: number | null = null;
  private layoutNow: Layout;
  /** Where the panel overlay sits now (recomputed every render). */
  private placement: Placement | null = null;
  /** Focus goes back here when a screen or the player card closes (the full-screen amendment). */
  private readonly screenTrail = new FocusTrail<Overlay, number>();
  private readonly cardTrail = new FocusTrail<"markCard", Element | null>();
  private queue: Promise<void> = Promise.resolve();
  private readonly reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(
    private readonly root: { topBar: HTMLElement; panel: HTMLElement; canvas: HTMLCanvasElement; live: HTMLElement; small: HTMLElement; markCard: HTMLElement; main: HTMLElement },
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
    // Hover a mark for his player card; leaving the field closes it.
    root.canvas.addEventListener("mousemove", (e) => this.onFieldHover(e));
    root.canvas.addEventListener("mouseleave", (e) => {
      // Moving onto the card itself (it sits over the field) keeps it open.
      if (!(e.relatedTarget instanceof Node && root.markCard.contains(e.relatedTarget))) this.closeMarkCard();
    });
    root.markCard.addEventListener("mouseleave", (e) => {
      if (e.relatedTarget !== root.canvas) this.closeMarkCard();
    });
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
          this.motion = parseMotion(m.ui.uiMotion);
        } catch (e) {
          const file = e instanceof MotionError ? "data/ui/motion.json" : "data/ui/templates.json";
          this.fatal = { title: `Game data failed its check: ${file}. This build can't run.`, lines: [(e as Error).message] };
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
        this.queue = this.queue.then(() => this.onStep(m)).catch((e: unknown) => this.showSimError({ name: "Error", message: (e as Error).message, seed: this.seed, playCount: this.game?.state?.playCount ?? null }));
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
        this.box = { box: m.box, players: Object.values(m.players.players) };
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
    this.stack = [{ id: "title" }, { id: "simError", info: { ...info, seed: info.seed ?? this.game?.matchup.seed ?? null, playCount: info.playCount ?? this.game?.state?.playCount ?? null } }];
    this.render();
  }

  private textCtx(g: GameView): TextCtx {
    const players = new Map<string, PlayerText>();
    for (const t of [g.matchup.home, g.matchup.away]) for (const p of t.pool.players) players.set(p.id, { name: p.name, number: p.number });
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
    if (m === null || m === undefined) return {};
    return Object.fromEntries([...m.home.pool.players, ...m.away.pool.players].map((p) => [p.id, p.number]));
  }

  private reducedMotion(): boolean {
    return this.settings.reducedMotion === "on" || (this.settings.reducedMotion === "system" && this.reducedQuery.matches);
  }

  private frameOpts(): FrameOpts {
    return {
      numbers: this.numbers(),
      ratings: this.ratingLabels(),
      showRatings: this.settings.ratingLabels,
      focused: this.markCard,
      markLabels: this.settings.markLabels,
      routeAlpha: this.templates?.timing.routeAlpha ?? 0.4,
      textScale: this.settings.textSize / 100,
    };
  }

  /** Each player's key rating (the card rating, before home field; templates keyRating). */
  private ratingLabels(): Record<string, number> {
    const m = this.game?.matchup ?? this.matchup;
    if (m === null || m === undefined || this.templates === null) return {};
    const out: Record<string, number> = {};
    for (const p of [...m.home.pool.players, ...m.away.pool.players]) {
      const v = ratingValue(p, this.templates.keyRating[p.position] ?? "speed");
      if (v !== undefined) out[p.id] = v;
    }
    return out;
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
      this.game = { matchup: m.matchup, human: m.human, state: m.state, request: null, menu: null, events: [], lastPlay: null, result: "", calls: "", eventLines: [], why: null, save: null, framePossession: null, shownPending: null, requestAt: 0, runoffShown: 0, lastSame: false };
      this.stack = [{ id: "game" }];
      if (!m.resumed)
        bumpLog((l) => {
          l.gamesStarted++;
          l.games = [...(l.games ?? []), { seed: m.matchup.seed, leagueSeed: m.matchup.leagueSeed, at: new Date().toISOString() }];
        });
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
          // A run-off the request's snapshot already showed before the snap isn't counted down again.
          if (g.shownPending !== key) await this.animate(g, ev, runoff, prev);
          g.runoffShown = 0;
          g.shownPending = null;
          runoff = 0;
          this.setPlayText(g, ev);
          prev = { ...prev, ...ev.after } as GameState;
          // The scoreboard follows each play, not the end of the batch.
          if (g.state !== null) g.state = { ...g.state, ...ev.after };
          this.render();
          continue;
        }
        const line = eventLine(ev, ctx);
        if (line !== null) g.eventLines.push(line);
        if (ev.t === "endPeriod" && this.ui !== null && ev.period === this.ui.rules.game.periodsPerHalf && m.state?.phase !== "final") {
          this.render();
          await this.wait((done) => ({ id: "halftime", done }));
          this.client.send({ t: "box" });
        }
      }
      if (pre.length > 0) g.eventLines.push(...pre);
      g.state = m.state;
    }
    g.request = m.request;
    g.menu = m.request === null ? null : openMenu(m.request);
    // What happened in this dead ball before the decision (request.events): the run-off, timeouts,
    // the two-minute warning. A human defense is asked after the run-off, so it shows before the snap.
    if (m.request !== null && m.request.events.length > 0) {
      const ctx = this.textCtx(g);
      const lines = m.request.events.map((e) => requestEventLine(e, ctx));
      g.eventLines = [...g.eventLines, ...lines.filter((l) => !g.eventLines.includes(l))];
      g.runoffShown = m.request.events.reduce((a, e) => a + (e.t === "runoff" ? e.seconds : 0), 0);
    }
    g.requestAt = performance.now();
    this.highlight = 0;
    if (m.request?.kind === "penalty" || m.request?.kind === "runoff" || m.request?.kind === "challenge") await this.showPending(g, m.request);
    this.idleField(g);
    if (m.request === null && g.state?.phase === "final") {
      bumpLog((l) => l.gamesFinished++);
      this.stack = [{ id: "game" }, { id: "end" }];
      this.client.send({ t: "box" });
    }
    this.render();
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
    g.why = whyHeadline(ev.play, ev.standout);
    if (g.why === null) console.warn(`No explanation for play ${ev.after.period}:${ev.before.clock} (seed ${g.matchup.seed}, event ${g.events.length - 1}).`);
    this.announce(g);
  }

  private announce(g: GameView): void {
    this.root.live.textContent = [g.result, g.calls, ...g.eventLines, g.why ?? "No explanation for this play."].filter((x) => x !== "").join(" ");
  }

  private async animate(g: GameView, ev: PlayEvent, runoff: number, prev: GameState | null): Promise<void> {
    if (this.templates === null || this.ui === null) return;
    const tl = timeline(
      {
        event: ev,
        runoffSeconds: Math.max(0, runoff - g.runoffShown),
        ...(prev === null || prev.trySpots === null ? {} : { tryKickSpot: prev.trySpots.kick }),
        // Their side breaks its huddle; yours starts lined up after the Calling state, or in the huddle after Same call.
        human: ev.before.possession === g.human ? "offense" : "defense",
        ownStart: g.lastSame ? "huddle" : "lined",
      },
      this.templates,
      { presetPackage: this.ui.presetPackage, endZoneYards: this.ui.rules.field.endZoneYards, numbers: this.numbers(), pxPerYard: this.layoutNow.s, markPx: this.layoutNow.markPx, motion: this.motion as Motion },
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

  /** A penalty choice or a ten-second run-off comes after the snap: show the play first, then ask. */
  private async showPending(g: GameView, req: Extract<DecisionRequest, { kind: "penalty" | "runoff" | "challenge" }>): Promise<void> {
    const key = JSON.stringify(req.play);
    if (g.shownPending === key || g.state === null) return;
    const before = { period: g.state.period, clock: g.state.clock, phase: g.state.phase, possession: g.state.possession, spot: g.state.spot, down: g.state.down, distance: g.state.distance, goalToGo: g.state.goalToGo, score: g.state.score, timeouts: g.state.timeouts, clockRunning: g.state.clockRunning, safetyKick: g.state.safetyKick };
    const ev: PlayEvent = { t: "play", before, offense: req.offenseCall, defense: req.defenseCall, play: req.play, penalty: null, runoffTimeout: false, after: before };
    g.eventLines = [];
    await this.animate(g, ev, 0, g.state);
    g.shownPending = key;
    const ctx = this.textCtx(g);
    g.lastPlay = ev;
    const flag = penaltyText(ev, ctx);
    g.result = `${playText(ev, ctx).replace(/^./, (c) => c.toUpperCase())}.${flag === "" ? "" : ` ${flag}`}`;
    g.calls = callsLine(ev, ctx);
    g.why = whyHeadline(ev.play);
    this.announce(g);
  }

  private idleField(g: GameView): void {
    const s = g.state;
    if (s === null || s.phase === "final" || s.phase === "overtimeToss") return;
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
    this.animator.redraw();
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.layoutNow.tooSmall || this.fatal !== null || this.loading !== null) return;
    const k = e.key;
    if (k === "m" || k === "M") {
      // Cycle the player cards over the marks on the field (Joseph's amendment: hover or focus).
      this.cycleMarkCard();
      e.preventDefault();
      return;
    }
    if (this.markCard !== null && (k === "Escape" || k === "Enter")) {
      this.closeMarkCard();
      e.preventDefault();
      return;
    }
    if (this.animating) {
      // Only skip and speed work during the animation; nothing else is buffered.
      if (k === " " || k === "Enter") this.animator.skip();
      else if (k === "s" || k === "S") {
        this.settings.speed = this.animator.cycleSpeed(this.settings.speed);
        saveSettings(this.settings);
        this.status = `Animation speed: ${this.settings.speed}`;
        this.renderStatus();
        this.renderTopBar();
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
    else if ((k === "ArrowLeft" || k === "ArrowRight") && this.top()?.id === "game") {
      // On a card grid, left and right move across the grid in reading order (wrapping).
      if (list.length > 0) this.highlight = (this.highlight + (k === "ArrowRight" ? 1 : list.length - 1)) % list.length;
      this.previewArmed = true;
      this.render();
      e.preventDefault();
      return;
    } else if (k === "ArrowLeft") key = "Left";
    else if (k === "ArrowRight") key = "Right";
    else if (k === "d" || k === "D") {
      if (this.top()?.id === "game" && this.game?.lastPlay !== null && this.game !== null) this.openOverlay({ id: "details" });
      e.preventDefault();
      return;
    } else if (k === "ArrowDown" || k === "ArrowUp") {
      if (this.top()?.id === "roster") this.moveRosterSelection(k === "ArrowDown" ? 1 : -1);
      else if (list.length > 0) {
        // Up and down move within a column of the card grid (as many columns as fit); elsewhere one row.
        const step = this.onCardScreen() ? this.gridColumns() : 1;
        const n = list.length;
        this.highlight = Math.max(0, Math.min(n - 1, this.highlight + (k === "ArrowDown" ? step : -step)));
      }
      this.previewArmed = true;
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

  private menuExtra(g: GameView): MenuExtra {
    const req = g.request;
    const left = g.state === null ? undefined : g.state.timeouts[g.human];
    const base: MenuExtra = left === undefined ? {} : { timeoutsLeft: left };
    if (req?.kind !== "penalty") return base;
    const ctx = this.textCtx(g);
    return { ...base, penaltyLabels: Object.fromEntries(req.outcomes.map((o) => [o.option, penaltyChoiceText(o.option, o.after, ctx, req.play.fouls)])) };
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
        const path = effect.answer.path;
        const row = menuRows(g.menu, this.menuData()).find((r) => r.key === key);
        if (row?.option === "sameCall") bumpLog((l) => l.sameCalls++);
        g.lastSame = row?.option === "sameCall";
        const tempo = path[0] === "clock" && ["hurryUp", "normal", "runClock"].includes(path[1] ?? "");
        if (!tempo) {
          const secs = (performance.now() - g.requestAt) / 1000;
          bumpLog((l) => l.deadBallSeconds.push(Math.round(secs * 10) / 10));
        }
        g.menu = null;
        this.client.send({ t: "answer", answer: effect.answer });
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
    this.screenTrail.open(o, this.highlight);
    this.stack.push(o);
    this.highlight = 0;
    this.render();
  }

  private back(): void {
    const closed = this.stack.length > 1 ? this.stack.pop() : undefined;
    this.highlight = closed === undefined ? 0 : (this.screenTrail.close(closed) ?? 0);
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
      case "ratingLabels":
        this.settings.ratingLabels = !this.settings.ratingLabels;
        break;
      case "copy":
        this.copyDetails(top);
        return;
      case "newGameAside":
        // Keep the save that can't be resumed (for a bug report), then start fresh.
        void setSaveAside()
          .catch(() => null)
          .then((key) => {
            this.hasSave = false;
            this.status = key === null ? "" : `The old save is kept aside as ${key}.`;
            this.act({ id: "title" }, { key: "1", label: "New game", on: true, action: "newGame" });
          });
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
      text = JSON.stringify({ seed: g.matchup.seed, leagueSeed: g.matchup.leagueSeed, playNumber: g.state?.playCount ?? null, event: g.lastPlay });
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

  // ------------------------------------------------------------ cards and the Calling preview

  private onCardScreen(): boolean {
    const m = this.game?.menu;
    return this.top()?.id === "game" && m !== null && m !== undefined && cardKind(current(m)) !== null;
  }

  /** Compact fallback: an overlay too short for art, or large text, drops the art (spec, Layout of cards). */
  private compact(): boolean {
    return (this.placement?.compact ?? false) || this.settings.textSize >= 150;
  }

  /** Cards in the grid's first row: the columns that fit the overlay now. */
  private gridColumns(): number {
    const cards = [...this.root.panel.querySelectorAll<HTMLElement>(".cards .card")];
    const top = cards[0]?.offsetTop;
    return Math.max(1, cards.filter((c) => c.offsetTop === top).length);
  }

  /**
   * What the overlay must leave visible (full-screen amendment): the line of scrimmage, the line to
   * gain and your lineup at the set. Your lineup's depth covers every unit the current call screen
   * can put on the field, so the overlay doesn't move as the focus moves. Null off the field.
   */
  private guard(): Guard | null {
    const g = this.game;
    const t = this.templates;
    if (g === null || t === null || this.stack[0]?.id !== "game") return null;
    const s = this.hudState(g);
    if (s === null || s.phase === "final") return null;
    const side = s.possession === g.human ? "offense" : "defense";
    const req = g.request;
    let depth = 0;
    if (g.menu !== null && req !== null && (req.kind === "offenseCall" || req.kind === "try" || req.kind === "defenseCall")) {
      const m = g.menu;
      const units = menuRows(m, this.menuData()).flatMap((r) => {
        const c = r.option === undefined ? null : this.countsFor(m, r.option);
        return c === null ? [] : [unitDepth(t, c.side, c.unit, c.call)];
      });
      const f = m.picks.includes("formation") ? m.picks[m.picks.indexOf("formation") + 1] : undefined;
      if (f !== undefined) units.push(unitDepth(t, "offense", f, null));
      depth = units.length > 0 ? Math.max(...units) : deepestUnit(t, side);
    }
    const preview = this.previewFrame;
    if (preview !== null) {
      // The lineup actually shown, in case it sits deeper than its template (never shallower).
      const own = preview.marks.filter((x) => !x.huddle && x.side === (side === "offense" ? "O" : "X"));
      for (const x of own) depth = Math.max(depth, Math.abs((x.keys[0]?.y ?? s.spot) - s.spot));
    }
    return { los: s.spot, lineToGain: s.phase === "scrimmage" && !s.goalToGo ? s.spot + s.distance : null, side, depth };
  }

  /** Places the panel and the player card over the field, and hides the panel during the live play. */
  private placeOverlays(): void {
    const l = this.layoutNow;
    const markYards = l.markPx / Math.max(1e-9, l.s);
    const shown = overlaysShown({ animating: this.animating, markCard: this.markCard !== null });
    const p = placeOverlay(l, this.animator.cameraY(), this.loading !== null || this.fatal !== null ? null : this.guard(), markYards, this.animator.ballX());
    this.placement = p;
    const panel = this.root.panel;
    const hadFocus = panel.contains(document.activeElement);
    // Every overlay element, shown or hidden by the one rule. Inline display too, so no class rule
    // (.panel.wide is a grid) can show a hidden overlay.
    const els: Record<OverlayId, HTMLElement> = { panel, "mark-card": this.root.markCard };
    for (const id of OVERLAY_IDS) {
      els[id].hidden = !shown[id];
      els[id].style.display = shown[id] ? "" : "none";
    }
    if (!shown.panel && hadFocus) this.root.main.focus({ preventScroll: true });
    this.position(panel, p.left, p.width, p.top, p.maxHeight, p.anchor);
    panel.classList.toggle("wide", p.where !== "sheet" && p.width >= 760);
    panel.classList.toggle("compact", p.compact);
    const card = this.root.markCard;
    if (shown["mark-card"]) {
      if (p.where === "side") {
        // In the side margin, over the panel: it covers nothing on the field.
        this.position(card, p.left, Math.min(360, p.width), p.top, p.maxHeight, "top");
      } else {
        // Beside the panel's stretch, on the side away from the player; full height while the play is paused.
        const w = Math.min(360, l.field.width - 16);
        const hit = this.animator.marks().find((x) => x.id === this.markCard);
        const left = hit !== undefined && hit.x < l.field.width / 2 ? l.field.width - 8 - w : 8;
        if (shown.panel) this.position(card, left, w, p.top, p.maxHeight, p.anchor);
        else this.position(card, left, w, l.field.top + 8, l.field.height - 16, "top");
      }
    }
  }

  private position(el: HTMLElement, left: number, width: number, top: number, maxHeight: number, anchor: "top" | "bottom"): void {
    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
    el.style.maxHeight = `${maxHeight}px`;
    el.style.background = overlayBackground();
    if (anchor === "top") {
      el.style.top = `${top}px`;
      el.style.bottom = "auto";
    } else {
      el.style.top = "auto";
      el.style.bottom = `${window.innerHeight - (top + maxHeight)}px`;
    }
  }

  private countsFor(m: MenuState, optionId: string): { counts: Readonly<Partial<Record<string, number>>>; side: "offense" | "defense"; unit: string; call: string | null } | null {
    const ui = this.ui;
    if (ui === null) return null;
    const kind = cardKind(current(m));
    const formation = m.picks[m.picks.indexOf("formation") + 1];
    switch (kind) {
      case "formation":
        return { counts: ui.personnel.offense[optionId] ?? {}, side: "offense", unit: optionId, call: null };
      case "play":
        return formation === undefined ? null : { counts: ui.personnel.offense[formation] ?? {}, side: "offense", unit: formation, call: optionId };
      case "package": {
        const pkg = optionId === "specials" ? "goalLine" : optionId;
        return { counts: ui.personnel.packages[pkg] ?? {}, side: "defense", unit: pkg, call: null };
      }
      case "coverage": {
        const pkg = ui.presetPackage[optionId] ?? "base";
        return { counts: ui.personnel.packages[pkg] ?? {}, side: "defense", unit: pkg, call: optionId };
      }
      default:
        return null;
    }
  }

  /** Text rows with the personnel line as the note (the compact fallback). */
  private withPersonnel(m: MenuState, list: readonly MenuRow[]): MenuRow[] {
    return list.map((r) => {
      const c = r.option === undefined ? null : this.countsFor(m, r.option);
      return c === null || (cardKind(current(m)) !== "formation" && cardKind(current(m)) !== "package") ? r : { ...r, note: personnelLine(c.counts, c.side) };
    });
  }

  /** The card grid: each row as a card with its play art; Esc, Same call and T stay text rows under it. */
  private cardGrid(m: MenuState, list: readonly MenuRow[]): HTMLElement {
    const t = this.templates;
    const kind = cardKind(current(m));
    const grid = h("div", { class: "cards", role: "group", "aria-label": menuTitle(m) });
    const rest: HTMLElement[] = [];
    list.forEach((r, i) => {
      const c = r.option === undefined || r.option === "sameCall" || r.option === "timeout" ? null : this.countsFor(m, r.option);
      if (c === null || t === null || kind === null) {
        rest.push(this.rowButton(r, i, () => (this.animating ? undefined : this.pick(r.key))));
        return;
      }
      const personnel = kind === "formation" || kind === "package" ? personnelLine(c.counts, c.side) : null;
      const desc = this.ui?.catalog.screens.flatMap((s) => s.choices).find((x) => x.id === r.option)?.description ?? "";
      const name = [r.key, r.label, personnel].filter((x) => x !== null).join(", ");
      const b = h(
        "button",
        { class: `card${r.on ? "" : " off"}${i === this.highlight ? " hl" : ""}`, type: "button", "data-i": String(i), "aria-label": name, "aria-description": desc, "aria-disabled": r.on ? undefined : "true" },
        h("span", { class: "card-label" }, h("span", { class: "key mono" }, r.key), " ", r.label, r.on ? "" : ` (${r.reason ?? "not now"})`),
      );
      const art = h("span", { class: "card-art", "aria-hidden": "true" });
      art.innerHTML = cardSvg(cardArt(kind, c.unit, c.call, c.counts, t), c.side);
      b.append(art);
      if (personnel !== null) b.append(h("span", { class: "card-personnel" }, personnel));
      b.addEventListener("click", () => (this.animating ? undefined : this.pick(r.key)));
      b.addEventListener("mouseenter", () => {
        this.highlight = i;
        this.previewArmed = true;
        this.status = desc;
        this.render();
      });
      grid.append(b);
    });
    return h("div", {}, grid, h("div", { class: "rows" }, ...rest));
  }

  /**
   * The field while calling (Pre-snap state 2): your lineup for the focused or picked formation or
   * package, the focused play's art faint, their huddle. State 1 (the last play's frame) until the
   * first input on a first screen, and again on Esc back to it.
   */
  private updatePreview(): void {
    const g = this.game;
    if (g === null || g.menu === null || g.request === null || this.animating || this.templates === null || this.motion === null || g.state === null) return;
    const req = g.request;
    if (req.kind !== "offenseCall" && req.kind !== "try" && req.kind !== "defenseCall") return;
    const m = g.menu;
    const s = g.state;
    const list = menuRows(m, this.menuData());
    const focused = list[this.highlight]?.option;
    let c = focused === undefined ? null : this.countsFor(m, focused);
    // Off a card (the Back row) on a deeper screen: the picked formation, no art.
    if (c === null && m.picks.includes("formation")) {
      const f = m.picks[m.picks.indexOf("formation") + 1];
      if (f !== undefined && this.ui !== null) c = { counts: this.ui.personnel.offense[f] ?? {}, side: "offense", unit: f, call: null };
    }
    const first = isFirstScreen(m);
    if (c === null || (first && !this.previewArmed)) {
      if (this.previewKey !== "") {
        this.previewKey = "";
        this.previewFrame = null;
        this.animator.restoreLast(this.sceneFor(s.possession, s.spot, null));
      }
      return;
    }
    const key = JSON.stringify([req.seq, c.unit, c.call]);
    if (key === this.previewKey) return;
    this.previewKey = key;
    const frame = callingFrame({
      side: c.side,
      los: s.spot,
      firstDown: s.phase === "scrimmage" && !s.goalToGo ? s.spot + s.distance : null,
      unit: c.unit,
      call: c.call,
      lineups: req.lineups,
      counts: c.counts,
      opponentCount: 11,
      templates: this.templates,
      motion: this.motion,
      pxPerYard: this.layoutNow.s,
      markPx: this.layoutNow.markPx,
      endZoneYards: this.ui?.rules.field.endZoneYards ?? 10,
    });
    const ms = this.reducedMotion() ? 0 : this.motion.preSnap.glideMs;
    const shown = glide(this.previewFrame, frame, ms);
    this.previewFrame = frame;
    this.animator.still(shown, this.sceneFor(s.possession, s.spot, frame.firstDown), this.previewFrame === null ? 0 : ms);
  }

  // ------------------------------------------------------------ the player card over a mark

  private onFieldHover(e: MouseEvent): void {
    const rect = this.root.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const r = this.layoutNow.markPx / 2 + 4;
    const hit = this.animator.marks().find((m) => Math.hypot(m.x - x, m.y - y) <= r);
    if (hit === undefined) {
      if (this.markCard !== null) this.closeMarkCard();
      return;
    }
    if (hit.id !== this.markCard) this.openMarkCard(hit.id);
  }

  private openMarkCard(id: string): void {
    if (this.markCard === null) this.cardTrail.open("markCard", document.activeElement);
    this.markCard = id;
    this.animator.pause();
    this.requestRanks(id);
    if (this.game !== null && this.box === null) this.client.send({ t: "box" });
    this.render();
    this.animator.redraw();
    this.root.markCard.querySelector<HTMLElement>(".mark-card")?.focus({ preventScroll: true });
  }

  private closeMarkCard(): void {
    if (this.markCard === null) return;
    this.markCard = null;
    this.animator.resume();
    this.render();
    this.animator.redraw();
    const back = this.cardTrail.close("markCard");
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    else if (this.root.panel.hidden) this.root.main.focus({ preventScroll: true });
  }

  /** M cycles the player cards over the marks on the field, offense and defense alike. */
  private cycleMarkCard(): void {
    const marks = this.animator.marks();
    if (marks.length === 0) return;
    const i = marks.findIndex((m) => m.id === this.markCard);
    this.openMarkCard((marks[(i + 1) % marks.length] as { id: string }).id);
  }

  /** The card: name, number, position; every rating with its league rank; this play's credited roles; game totals. */
  private markCardContent(): HTMLElement[] {
    const id = this.markCard;
    if (id === null) return [];
    const found = this.playerById(id);
    if (found === null) return [];
    const { p, team } = found;
    const ranks = this.ranks.get(id);
    const plural = POSITION_PLURAL[p.position] ?? `${p.position}s`;
    const ratings = [...Object.entries(p.ratings), ...Object.entries(p.skills)].map(([k, v]) => {
      const r = ranks?.[k];
      return h("li", { class: "mono" }, `${RATING_NAME[k] ?? k} ${v}${r === undefined ? "" : `: ${ordinalRank(r.rank)} of ${r.of} ${plural}`}`);
    });
    const play = playLines(id, this.game?.lastPlay ?? null);
    const line = this.box?.players.find((l) => l.id === id);
    return [
      h(
        "section",
        { class: "mark-card", role: "dialog", tabindex: "-1", "aria-label": `${p.name}, #${p.number}, ${p.position}`, "aria-live": "polite" },
        h("div", { class: "card-head" }, h("span", { class: "mono num" }, `#${p.number}`), h("span", { class: "name" }, p.name), h("span", { class: "pos" }, p.position), h("span", { class: "soft" }, team.nickname)),
        h("h3", {}, "Ratings"),
        h("ul", { class: "ratings" }, ...ratings),
        h("h3", {}, "This play"),
        play.length === 0 ? h("p", { class: "soft" }, NO_PLAY_STAT) : h("ul", {}, ...play.map((x) => h("li", {}, x))),
        h("h3", {}, "This game"),
        h("p", {}, line === undefined ? "No stats yet" : statLine(line)),
        h("p", { class: "hint" }, "M: next player. Esc or Enter: close."),
      ),
    ];
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
        return pauseScreen({ hasPlay: this.game?.lastPlay !== null && this.game !== null, speed: this.settings.speed, ...(this.game === null ? {} : { seed: this.game.matchup.seed, leagueSeed: this.game.matchup.leagueSeed }) });
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
    this.root.markCard.replaceChildren(...this.markCardContent());
    this.updatePreview();
    this.placeOverlays();
    this.renderStatus();
    // Keep keyboard focus on the highlighted row or card, so screen readers follow the menu; the
    // player card keeps focus while it is open.
    const btn = p.querySelector<HTMLButtonElement>(`button[data-i="${this.highlight}"]`);
    if (btn !== null && !p.hidden && this.markCard === null && document.activeElement !== btn) btn.focus({ preventScroll: true });
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

  /** The state the HUD shows: the open request's state (the moment it is decided in) over the committed state. */
  private hudState(g: GameView): GameState | null {
    const s = g.state;
    const r = g.request?.state ?? null;
    if (s === null || r === null) return s;
    return { ...s, ...r };
  }

  private renderTopBar(): void {
    const bar = this.root.topBar;
    const g = this.game;
    if (g === null) {
      bar.replaceChildren(h("span", { class: "brand" }, "Clipboard Football"));
      return;
    }
    const s = this.hudState(g);
    if (s === null) {
      // Before the opening toss is settled.
      bar.replaceChildren(...(["away", "home"] as const).map((t) => h("span", { class: "team" }, swatch(swatchFor(g.matchup[t].index)), h("span", { class: "abbr" }, abbrev(g.matchup[t]), t === g.human ? " (you)" : ""), h("span", { class: "score mono" }, "0"))), h("span", { class: "time" }, "Coin toss"));
      return;
    }
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
      // No overlay during the live play, so the skip and speed keys show here.
      ...(this.animating ? [h("span", { class: "play-keys" }, `Space: skip. S: speed (${this.settings.speed}).`)] : []),
    );
  }

  private rowButton(r: { key: string; label: string; on: boolean; reason?: string; note?: string }, i: number, onClick: () => void): HTMLElement {
    const keyText = r.key === "Esc" ? "Esc" : r.key === "Space" ? "Space" : r.key === "Left" ? "←" : r.key === "Right" ? "→" : r.key;
    const b = h(
      "button",
      { class: `row${r.on ? "" : " off"}${i === this.highlight ? " hl" : ""}`, type: "button", "data-i": String(i), "aria-disabled": r.on ? undefined : "true" },
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
    return [h("h1", {}, model.title), ...(model.lines ?? []).map((l) => h("p", { class: "soft mono seeds" }, l)), ...this.screenBody(top), this.rowsGroup(model.title, model.rows), h("p", { class: "status", role: "status" })];
  }

  private gamePanel(): HTMLElement[] {
    const g = this.game;
    if (g === null || this.ui === null) return [];
    const s = this.hudState(g);
    const header =
      s === null
        ? h("div", { class: "situation" }, h("div", { class: "dd mono" }, "Coin toss"))
        : h("div", { class: "situation" }, h("div", { class: "dd mono" }, situationText(s, g.human)), h("div", { class: "side" }, sideText(s, g.human)));
    const playText = h(
      "div",
      { class: "report" },
      // DESIGN.md Layout: what happened, why, then the calls and the event lines.
      g.result === "" ? h("p", { class: "result soft" }, "No plays yet.") : h("p", { class: "result" }, g.result),
      g.lastPlay === null ? null : h("p", { class: "why" }, g.why ?? "No explanation for this play.", " ", h("span", { class: "hint" }, "D:\u00a0details")),
      g.calls === "" ? null : h("p", { class: "calls" }, g.calls),
      ...g.eventLines.map((l) => h("p", { class: "event" }, l)),
    );
    const out: HTMLElement[] = [];
    if (g.menu !== null && g.request !== null && !this.animating) {
      const m = g.menu;
      const crumbs = breadcrumb(m, this.menuData());
      const req = g.request;
      if (req.kind === "continue") out.push(h("p", { class: "lineup" }, continueText(req.about, this.textCtx(g))));
      // M2 G: what is in doubt, then what a challenge risks, from the rule set (design "Challenge prompt").
      if (req.kind === "challenge") out.push(h("p", { class: "lineup" }, `Close call: ${req.closeCall.question} ${req.challengesLeft} challenge${req.challengesLeft === 1 ? "" : "s"} left; ${req.failedCostsTimeout ? `a failed challenge costs a timeout (${req.timeoutsLeft} left)` : "a failed challenge costs nothing"}.`));
      out.push(h("h2", {}, menuTitle(m), crumbs === "" ? "" : `: ${crumbs}`));
      const list = menuRows(m, this.menuData(), this.menuExtra(g)).map((r: Row) => (r.on ? r : { ...r, reason: reasonText(r.reason) }));
      out.push(this.onCardScreen() && !this.compact() ? this.cardGrid(m, list) : this.rowsGroup(menuTitle(m), this.compact() ? this.withPersonnel(m, list) : list));
      if (current(m) === "offense.clock" && req.kind === "offenseCall") out.push(h("p", { class: "soft" }, `Clock ${req.clockRunning ? "running" : "stopped"}. Tempo: ${tempoText(req.tempo)} (resets each drive).`));
    }
    out.push(h("p", { class: "status", role: "status" }));
    return [h("div", { class: "ov-report" }, header, playText), h("div", { class: "ov-menu" }, ...out)];
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
    ];
  }

  private rosterBody(top: Extract<Overlay, { id: "roster" }>): HTMLElement[] {
    const t = this.teamOf(top.team);
    if (t === undefined) return [];
    const players = t.pool.players.filter((p) => POSITION_UNIT[p.position] === top.unit);
    const table = h("table", { class: "roster", "aria-label": `${t.name} ${top.unit}` }, h("tr", {}, ...["#", "Name", "Pos", "Spd", "Str", "Agi", "Awr"].map((c) => h("th", {}, c))));
    players.forEach((p, i) => {
      const tr = h("tr", { class: i === top.sel ? "sel" : "", "aria-selected": i === top.sel ? "true" : "false" }, h("td", { class: "mono" }, String(p.number)), h("td", {}, p.name), h("td", {}, p.position), ...["speed", "strength", "agility", "awareness"].map((r) => h("td", { class: "mono" }, String((p.ratings as Record<string, number>)[r]))));
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
      const r = ranks?.[k];
      const fill = r === undefined ? 0 : r.of <= 1 ? 1 : (r.of - r.rank) / (r.of - 1);
      return bar(RATING_NAME[k] ?? k, v, fill);
    });
    const line = this.box?.players.find((l) => l.id === id);
    return [
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("span", { class: "mono num" }, `#${p.number}`), h("span", { class: "name" }, p.name), h("span", { class: "pos" }, p.position), h("span", { class: "soft" }, team.nickname)), h("p", { class: "soft" }, `Compared with other ${plural}${ranks === undefined ? " (loading)" : ""}`), ...bars),
      h("p", {}, `Today: ${line === undefined ? "no stats" : statLine(line)}`),
    ];
  }

  private ratingDetailBody(id: string): HTMLElement[] {
    const found = this.playerById(id);
    const ranks = this.ranks.get(id);
    if (found === null || ranks === undefined) return [h("p", { class: "soft" }, "Loading ranks...")];
    const plural = POSITION_PLURAL[found.p.position] ?? `${found.p.position}s`;
    return [h("p", {}, `#${found.p.number} ${found.p.name}, ${found.p.position}`), ...Object.entries(ranks).map(([rating, r]) => h("p", { class: "mono" }, `${RATING_NAME[rating] ?? rating} ${r.value}: ${ordinalRank(r.rank)} of ${r.of} ${plural}`)), h("p", { class: "soft" }, "Ranks are across the whole generated league. Ties share the higher rank.")];
  }

  private halftimeBody(): HTMLElement[] {
    const g = this.game;
    if (g === null || g.state === null) return [];
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
    return f === null ? id : `#${f.p.number} ${f.p.name}`;
  }

  private endBody(): HTMLElement[] {
    const g = this.game;
    if (g === null || g.state === null) return [];
    const s = g.state;
    const t = g.matchup;
    const winner = s.result?.winner ?? null;
    const verdict = winner === null ? "Tie." : winner === g.human ? "You win." : "You lose.";
    const standouts = g.events.filter((e): e is PlayEvent => e.t === "play" && (e.standout ?? readDetail(e.play).standout) !== undefined);
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
      ...(["away", "home"] as const).map((side) => h("tr", {}, h("th", {}, swatch(swatchFor(t[side].index)), ` ${t[side].nickname}`), ...box[side].byPeriod.map((x) => h("td", { class: "mono" }, String(x))), h("td", { class: "mono" }, String(g.state?.score[side] ?? 0)))),
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
        out.push(h("h3", {}, "Kicking"), table(["Player", "FG", "Long", "XP"], players.filter((l) => l.kicking !== undefined).map((l) => [who(l), `${l.kicking?.fieldGoalsMade}/${l.kicking?.fieldGoalAttempts}`, dash(l.kicking?.long), `${l.kicking?.extraPointsMade}/${l.kicking?.extraPointAttempts}`])));
        out.push(h("h3", {}, "Punting"), table(["Player", "Punts", "Yds", "Avg"], players.filter((l) => l.punting !== undefined).map((l) => [who(l), dash(l.punting?.punts), dash(l.punting?.yards), l.punting === undefined ? "-" : l.punting.average.toFixed(1)])));
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
    out.push(h("p", { class: "soft mono" }, `Seed ${g.matchup.seed}, play ${g.state?.playCount ?? 0}.`));
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
  if (l.kicking !== undefined) parts.push(`FG ${l.kicking.fieldGoalsMade}/${l.kicking.fieldGoalAttempts}, XP ${l.kicking.extraPointsMade}/${l.kicking.extraPointAttempts}`);
  if (l.punting !== undefined) parts.push(`${l.punting.punts} punts, ${l.punting.average.toFixed(1)} avg`);
  return parts.length === 0 ? "no stats" : parts.join("; ");
}

export { COLOR, type PlayResult };
