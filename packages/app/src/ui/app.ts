// The app controller: screen flow, keyboard and mouse, the worker conversation, and the panel and
// top bar DOM. The sim runs in the worker; this thread only sees requests, committed events and
// box scores. The opponent's call reaches this thread only in a committed play event, after the
// snap (spec F5). Number keys during the animation are dropped, not buffered (decision 8).

import type { PlayResult, Position, TeamPool } from "@clipboard-football/shared";
import type { BoxScore, TeamBox } from "@clipboard-football/sim";
import type { SaveData } from "../engine/session";
import { SimClient } from "../engine/client";
import { whyHeadline } from "../engine/headline";
import type { FromWorker, Matchup, OpenDrive, SimErrorInfo, TeamSummary, UiData } from "../engine/protocol";
import { readDetail, type DecisionRequest, type GameEvent, type GameState, type PlayEvent, type PlayerLine, type RatingRank, type Team } from "../engine/types";
import { Animator, withScene } from "./animator";
import { boardViewOf, COMPACT_CARD_PX } from "./board";
import { pendingKey, pendingPlay, type PendingPlay } from "./pending";
import { bar, h, swatch } from "./dom";
import { drawField, drawFrame, markPositions, type FieldScene, type FrameOpts, type SideInk, type View } from "./field";
import { BOARD, boardLayout, callCardFit, callingCardBox, layoutFor, playStage, type BoardLayout, type Layout } from "./layout";
import { callingPlacement, deepestUnit, FocusTrail, gameScreen, OVERLAY_IDS, overlayBackground, floatingCardPlacement, overlaysShown, placeOverlay, playCardPlacement, rgbOf, unitDepth, type GameScreen, type Guard, type OverlayId, type Placement } from "./overlay";
import { ClickPicker, clickPicks } from "./click";
import { breadcrumb, current, EARLIER_CALL, isFirstScreen, MAX_ROWS, openMenu, press, rows as menuRows, title as menuTitle, type MenuData, type MenuExtra, type MenuKey, type MenuState, type Row } from "./menu";
import { earlierCall } from "./recent";
import { autoAnswer } from "./autoadvance";
import { detailSheet, EDGES_NOTE, NO_EXPLANATION, NO_FACTORS } from "./details";
import { driveSpans, inSpan, logRows, type DriveSpan } from "./gamelog";
import {
  LABEL_LEGEND,
  SETTINGS_DESCRIPTION,
  SETTINGS_NOT_STORED,
  UNITS,
  boxScreen,
  cardScreen,
  controlsScreen,
  detailsScreen,
  endScreen,
  halftimeScreen,
  noticeScreen,
  openingHighlight,
  pauseScreen,
  pickRow,
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
  playResultText,
  playText,
  resultHead,
  reasonText,
  resultLine,
  sideText,
  situationText,
  tempoText,
  yardLineText,
  type PlayerText,
  type TextCtx,
} from "./text";
import { timeline, type Timeline } from "./timeline";
import { callingFrame, glide, publicLineupFrame, type PublicCall } from "./presnap";

/** Line-ups shown before the snap with no input (calling screen pass U1). */
const PUBLIC_CALLS: ReadonlySet<string> = new Set(["punt", "fieldGoal", "extraPoint", "kneel", "spike"]);
import { cardArt, cardScreen as cardKind, cardSvg, personnelLine } from "./cards";
import { NO_PLAY_STAT, overallRating, playLines } from "./ratings";
import { lineScore, NO_MOMENT, playMoment, type Moment } from "./moments";
import { faceoffBand, lineScoreTable, taleOfTape, COUNT_UP_MS, type FaceoffTeam, type Side } from "./faceoff";
import { matchupIntro } from "./intro";
import { BUG_MOTION, MENU_ENTER, EASE, ease, COLOR, darkTier, DUR, matchupInk, matchupSwatches, type TeamInk } from "./tokens";
import { regionsHidden, uiMode } from "./mode";
import { fitBar, newFirstDown, playEnd, playStood, TOP_BAR_FIT_STEPS } from "./topbar";
import { Flights, resume } from "./flights";
import { whenCanvasFontsReady } from "./fonts";
import { artShown, splashFrame, SplashLoop } from "./splash";
import type { SplashCall } from "./splashSim";

/** Menu-mode screens with rows only: the frame is at most 640 px wide (main menu spec). */
const NARROW_MENU_SCREENS: ReadonlySet<string> = new Set(["settings", "controls", "saveError", "simError"]);
const STORAGE_BLOCKED = "This game can't be saved in this browser window.";
const SAVE_FAILED = "Your last game couldn't be saved. Continue resumes the last save that was written.";

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
  /** The live region's result line (with where things stand). */
  result: string;
  /** The Last play card's result line (U2): the result without the "Your ball, ..." tail. */
  cardResult: string;
  /** Q1: the auto-advanced plays just before the last play (at most 2), for "Before that:". */
  before: PlayEvent[];
  /** Q1: the auto-advanced plays since the last decision the player saw. */
  autoChain: PlayEvent[];
  /** U5: the last answer sent was Earlier call (an answer error then says the call isn't allowed). */
  earlierSent?: boolean;
  /** The request in view is the first after resuming a save (Q1 never skips it). */
  firstAfterResume?: boolean;
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
  /** The drive in progress (the worker's step), for the situation plate's tracker; null when none is open. */
  drive: OpenDrive | null;
  /** moment.periodEnd: the 1st or 3rd quarter just ended; the bug says "End 1st" and the plate shows the line score until the next snap. */
  periodEnd?: number | null;
  /**
   * A play of this step has committed (or its banner's sub line is up): the bug shows g.state, not
   * the answered request's pre-snap snapshot, which is stale from then until the next request.
   */
  committed?: boolean;
}

/** What the score bug showed at its last build: a change from it starts the bug's motion. */
interface BugShown {
  readonly seed: number;
  readonly score: { readonly home: number; readonly away: number };
  readonly ball: Team | null;
  readonly dd: string;
  readonly spot: string;
}

/** What the drive tracker showed at its last build, in % of its width. */
interface TrackerShown {
  readonly seed: number;
  readonly possession: Team;
  readonly los: number;
  readonly fd: number | null;
  readonly band: readonly [number, number] | null;
}

/** Where a menu's travelling highlight sat at the last build (or mid-slide, read just before a rebuild). */
interface HighlightShown {
  readonly screen: unknown;
  readonly label: string;
  readonly top: number;
  readonly height: number;
}

/** A tracker spot (yards from the attacking team's goal line) as a left offset: end zones are 10 of 120 yards each. */
const trackerX = (yards: number): number => ((10 + yards) / 120) * 100;

const POSITION_UNIT: Readonly<Record<Position, Unit>> = { QB: "Offense", RB: "Offense", WR: "Offense", TE: "Offense", OL: "Offense", DL: "Defense", LB: "Defense", CB: "Defense", S: "Defense", K: "Special teams", P: "Special teams" };
const POSITION_PLURAL: Readonly<Record<string, string>> = { QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs", OL: "offensive linemen", DL: "defensive linemen", LB: "linebackers", CB: "cornerbacks", S: "safeties", K: "kickers", P: "punters" };
const RATING_NAME: Readonly<Record<string, string>> = {
  speed: "Speed", strength: "Strength", agility: "Agility", awareness: "Awareness", throwPower: "Throw power", accuracy: "Accuracy", ballSecurity: "Ball security", elusiveness: "Elusiveness",
  hands: "Hands", routeRunning: "Route running", runBlock: "Run block", passBlock: "Pass block", passRush: "Pass rush", runStop: "Run stop", tackling: "Tackling", coverage: "Coverage", ballSkills: "Ball skills", kickPower: "Kick power", kickAccuracy: "Kick accuracy",
};

const randomSeed = (): number => Math.floor(Math.random() * 0xffffffff);

/** A key hint (hud.keyHint) and its label, and a value when the key has one (S Speed 1x). */
function keyHint(key: string, label: string, value?: string): HTMLElement {
  return h("span", { class: "chip" }, h("kbd", {}, key), h("span", { class: "chip-label" }, label), value === undefined ? null : h("span", { class: "chip-value" }, value));
}

/** Runs a one-shot CSS entrance again (the class is removed, the style flushed, the class put back). */
function restartAnimation(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

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
  /** The save check (storage, then the save) hasn't resolved yet: Continue says "checking". */
  private checking = true;
  /** The main menu's highlight follows Continue until the player moves or picks (spec decision 4). */
  private autoHighlight = true;
  /** The last settings write was stored; false: Settings says they last for this page. */
  private settingsStored = true;
  /** The last save write failed (storage works, the write didn't): the main menu says so once. */
  private saveFailed = false;
  /** The main menu's play diagram, kept across renders and redrawn only when its key changes. */
  private readonly menuArt: HTMLCanvasElement;
  private menuArtKey = "";
  private readonly splashLoop = new SplashLoop();
  private readonly canvas2d: boolean;
  private storageWarning: string | null = null;
  private leagueSeed = 2026;
  private seed = randomSeed();
  private human: Team = "home";
  private matchup: Matchup | null = null;
  /** A rematch asked the worker for a matchup: start the game as soon as it answers. */
  private startOnMatchup = false;
  private game: GameView | null = null;
  private animating = false;
  /** Q1: the app answered Continue itself and the next play hasn't started: the calling screen stays hidden. */
  private autoAdvancing = false;
  /** Q1: the next play to animate was auto-advanced (the rail says "This play (auto)"). */
  private autoPlay = false;
  /** U1: the calling screen's field board, kept across renders; its layout when shown, else null. */
  private readonly board: HTMLCanvasElement;
  private boardShown: BoardLayout | null = null;
  private boardView: View | null = null;
  /** The compact card was showing with the board at the last fit (the switch crossfades). */
  private boardCompact = false;
  /** The open player card was opened by hovering the board (mouse-off closes it), not with M (N4). */
  private markCardHovered = false;
  /** The calling screen's cards row as last measured (plate bottom + 16 to the legend's top). */
  private cardsRow: { readonly top: number; readonly legendTop: number } | null = null;
  /** The call menu screen whose cards didn't fit even with small art: it shows the text rows (K5). */
  private textRowsFor: MenuState | null = null;
  /** Q2: the game log just opened: focus goes to its list at the next render. */
  private focusLog = false;
  private working = false;
  private status = "";
  private highlight = 0;
  /** The player whose card is open over a mark (hover or the M key), or null. */
  private markCard: string | null = null;
  /** On a first screen the preview waits for the first input (Pre-snap, state 1). */
  private previewArmed = false;
  private previewFrame: Timeline | null = null;
  private previewKey = "";
  /** Click to pick: a press and release on one row of one screen (click.ts). */
  private readonly clicks = new ClickPicker<unknown>();
  /** Data warnings from timeline() (States: a mark with no template), each logged once per session. */
  private readonly warned = new Set<string>();
  /** The last box score, with the number of game events it was built over (code review S2: a box from before the latest play is stale). */
  private box: { box: BoxScore; players: readonly PlayerLine[]; events?: number; seed?: number } | null = null;
  /** Q2: the game log list, built once per new event (and box), kept across renders with its scroll. */
  private logCache: { readonly key: string; readonly el: HTMLElement } | null = null;
  private ranks = new Map<string, Readonly<Record<string, RatingRank>>>();
  private clockOverride: number | null = null;
  private layoutNow: Layout;
  /** Where the panel overlay sits now (recomputed every render). */
  private placement: Placement | null = null;
  /** Focus goes back here when a screen or the player card closes (the full-screen amendment). */
  private readonly screenTrail = new FocusTrail<Overlay, number>();
  private readonly cardTrail = new FocusTrail<"markCard", Element | null>();
  private queue: Promise<void> = Promise.resolve();
  /**
   * The play rail's text for the play on the field (DESIGN.md Play screen): the calls, shown from
   * the snap. Text only from the committed play event.
   */
  private railPlay: { readonly calls: readonly string[]; phase: "pre" | "snap"; readonly auto?: boolean } | null = null;
  /** The screen shown at the last render, so a switch fades the incoming screen in (DESIGN.md UI transitions). */
  private screenShown: GameScreen | null = null;
  private railKey = "";
  private readonly reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** The bug's, the tracker's and the plate's changes in flight (ui/flights.ts). */
  private readonly flights = new Flights<Readonly<Record<string, string>>>();
  private bugShown: BugShown | null = null;
  private trackerShown: TrackerShown | null = null;
  private hlShown: HighlightShown | null = null;
  private slideTimer: number | undefined;
  private barTimer: number | undefined;
  /** menu.enter: the main menu's entrance, on its first show after load only (start time; null once shown or skipped). */
  private heroEnter: number | null | undefined = undefined;
  /** The menu-mode screen shown last and the stack depth then, for the screen push (Back enters from the left). */
  private menuShown: { readonly top: unknown; readonly depth: number } | null = null;
  /** The game-mode overlay shown last, so a sheet (pause, details, box score) rises in once when it opens. */
  private sheetShown: unknown = null;
  /** moment.matchupIntro while it runs: any key or click skips it. */
  private intro: { skip(): void } | null = null;
  /** The halftime and final score hero: when its count-up started (Flights would forget it on a rebuild). */
  private heroAt: { readonly id: string; readonly at: number } | null = null;
  /** The menu a pick or Back just opened: its rows enter (DESIGN.md Rows, Menu change). */
  private menuEnter: { readonly menu: MenuState; readonly back: boolean; readonly at: number } | null = null;
  /** The key just pressed on this screen, so its row answers even if the panel is rebuilt. */
  private pressed: { readonly key: string; readonly screen: unknown; readonly at: number } | null = null;

  constructor(
    private readonly root: { topBar: HTMLElement; panel: HTMLElement; canvas: HTMLCanvasElement; live: HTMLElement; small: HTMLElement; markCard: HTMLElement; main: HTMLElement; menu: HTMLElement; rail: HTMLElement },
  ) {
    this.settings = loadSettings();
    this.menuArt = document.createElement("canvas");
    this.menuArt.id = "menu-art";
    this.menuArt.className = "menu-art";
    this.menuArt.setAttribute("aria-hidden", "true");
    this.canvas2d = this.menuArt.getContext("2d") !== null;
    // U1: the calling screen's board, read only; it shows your own call and a huddle that carries no fact.
    this.board = document.createElement("canvas");
    this.board.className = "call-board";
    this.board.setAttribute("aria-hidden", "true");
    this.board.addEventListener("mousemove", (e) => this.onBoardHover(e));
    this.board.addEventListener("mouseleave", (e) => {
      if (this.markCardHovered && !(e.relatedTarget instanceof Node && this.root.markCard.contains(e.relatedTarget))) this.closeMarkCard();
    });
    this.layoutNow = layoutFor(window.innerWidth, window.innerHeight);
    this.animator = new Animator(root.canvas, () => this.fieldLayout(), () => this.templates as Templates, () => this.frameOpts());
    this.animator.onRedraw = () => this.drawBoard();
    this.client = new SimClient(
      (m) => this.onWorker(m),
      (slow) => {
        this.working = slow;
        this.renderStatus();
      },
    );
    window.addEventListener("keydown", (e) => this.onKey(e));
    // Click to pick (Joseph): pointer up over the row pressed picks it, even if the panel was rebuilt
    // in between (click.ts).
    // A modifier held (Ctrl-click opens the context menu on a Mac) picks nothing.
    // The same rule on the main menu (main menu spec MM21).
    for (const el of [root.panel, root.menu]) {
      el.addEventListener("pointerdown", (e) => this.clicks.down(e.ctrlKey || e.metaKey || e.altKey ? null : this.rowKeyAt(e), this.clickScreen(), e.button));
      el.addEventListener("pointerup", (e) => {
        const key = this.clicks.up(this.rowKeyAt(e), this.clickScreen(), e.button);
        if (key !== null && !this.animating) this.pick(key);
      });
      el.addEventListener("pointercancel", () => this.clicks.cancel());
    }
    window.addEventListener("resize", () => this.onResize());
    // Hover a mark for his player card; leaving the field closes it.
    root.canvas.addEventListener("mousemove", (e) => this.onFieldHover(e));
    root.canvas.addEventListener("mouseleave", (e) => {
      // Moving onto the card itself (it sits over the field) keeps it open.
      if (!(e.relatedTarget instanceof Node && root.markCard.contains(e.relatedTarget))) this.closeMarkCard();
    });
    root.markCard.addEventListener("mouseleave", (e) => {
      if (e.relatedTarget !== root.canvas && e.relatedTarget !== this.board) this.closeMarkCard();
    });
    this.reducedQuery.addEventListener("change", () => this.render());
    this.applyTextSize();
    this.onResize();
    void storageAvailable().then(async (ok) => {
      this.storage = ok;
      if (!ok) this.storageWarning = STORAGE_BLOCKED;
      else this.hasSave = (await readSave().catch(() => undefined)) !== undefined;
      this.checking = false;
      this.render();
    });
    this.client.send({ t: "init" });
    this.render();
    // The bundled fonts arrive after the first paint: redraw the canvas (field and splash) and
    // re-fit the score bug in the loaded faces.
    void whenCanvasFontsReady(document.fonts, () => {
      this.menuArtKey = "";
      this.animator.redraw();
      this.render();
    });
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
        if (this.startOnMatchup) {
          this.startOnMatchup = false;
          this.client.send({ t: "newGame", leagueSeed: m.matchup.leagueSeed, seed: m.matchup.seed, human: this.human });
          return;
        }
        this.render();
        return;
      case "step":
        this.queue = this.queue.then(() => this.onStep(m)).catch((e: unknown) => this.showSimError({ name: "Error", message: (e as Error).message, seed: this.seed, playCount: this.game?.state?.playCount ?? null }));
        return;
      case "answerError":
        // The run is unchanged: put the same request's menu back.
        if (this.game !== null && this.game.request !== null) this.game.menu = openMenu(this.game.request);
        // The menu is back on its first screen: Pre-snap state 1, and no auto-advance in flight (N1).
        this.autoAdvancing = false;
        this.autoPlay = false;
        this.previewArmed = false;
        // U5: an Earlier call the engine rejects (should be unreachable): the menu reopens on the first screen.
        if (this.game?.earlierSent === true) {
          console.warn(`Earlier call rejected by the engine: ${m.code} ${m.message}`);
          this.status = "That call isn't allowed now.";
        } else this.status = `That choice wasn't accepted (${m.message}).`;
        if (this.game !== null) this.game.earlierSent = false;
        this.render();
        return;
      case "saveError":
        this.stack = [{ id: "title" }, { id: "saveError", reason: m.reason }];
        this.render();
        return;
      case "box":
        // The reply carries the tag its request was sent with (R1): no queue to fall out of step.
        this.box = { box: m.box, players: Object.values(m.players.players), ...(m.tag === undefined ? {} : { events: m.tag.events, seed: m.tag.seed }) };
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

  /** Each player's base ratings, for the field motion (decision 12 reversed: ratings drive how he moves). */
  private motionRatings(): Record<string, { speed: number; agility: number; awareness: number }> {
    const m = this.game?.matchup ?? this.matchup;
    if (m === null || m === undefined) return {};
    return Object.fromEntries([...m.home.pool.players, ...m.away.pool.players].map((p) => [p.id, { speed: p.ratings.speed, agility: p.ratings.agility, awareness: p.ratings.awareness }]));
  }

  private reducedMotion(): boolean {
    return this.settings.reducedMotion === "on" || (this.settings.reducedMotion === "system" && this.reducedQuery.matches);
  }

  private frameOpts(): FrameOpts {
    return {
      numbers: this.numbers(),
      ratings: this.ratingLabels(),
      labelContent: this.settings.labelContent,
      focused: this.markCard,
      markLabels: this.settings.markLabels,
      routeAlpha: this.templates?.timing.routeAlpha ?? 0.4,
      textScale: this.settings.textSize / 100,
    };
  }

  /** Each player's overall (position-weighted card ratings, before home field), shown beside his number. */
  private ratingLabels(): Record<string, number> {
    const m = this.game?.matchup ?? this.matchup;
    const t = this.templates;
    if (m === null || m === undefined || t === null) return {};
    return Object.fromEntries([...m.home.pool.players, ...m.away.pool.players].map((p) => [p.id, overallRating(p, t.overallWeights)]));
  }

  /** The field's scene; `downTag` is the bug's down block text for a play's set phase (field.downTag). */
  private sceneFor(possession: Team, los: number, firstDown: number | null, downTag?: string): FieldScene {
    const g = this.game;
    const m = g?.matchup ?? this.matchup;
    const name = (t: Team): string => (m === null || m === undefined ? "" : m[t].nickname);
    const base = { los, firstDown, bottomName: name(possession), topName: name(other(possession)), endZoneYards: this.ui?.rules.field.endZoneYards ?? 10, ...(downTag === undefined ? {} : { downTag }) };
    if (m === null || m === undefined) return base;
    // The matchup's two slots color the marks, paths and end zones (DESIGN.md Team colors).
    const inks = this.inks(m);
    const own = inks[possession];
    const opp = inks[other(possession)];
    // field.midfield: the home team's name (team.<id>.abbrev, the nickname in caps), whatever the possession.
    return { ...base, homeName: abbrev(m.home), endZones: { bottom: own.endZone, top: opp.endZone }, ink: { O: { fill: own.fill, ring: own.ring }, X: { fill: opp.fill, ring: opp.ring } } };
  }

  /** Each team's field colors in this matchup (the slots matchupSwatches resolves). */
  private inks(m: Matchup): { readonly away: TeamInk; readonly home: TeamInk } {
    return matchupInk(m.away.index, m.home.index);
  }

  /** A team's colors in the matchup on screen, or null with none. */
  private teamInkOf(team: TeamSummary): TeamInk | null {
    const m = this.game?.matchup ?? this.matchup;
    return m === null || m === undefined ? null : this.inks(m)[m.home === team ? "home" : "away"];
  }

  /** The field layout the canvas draws: the play stage's centered column (DESIGN.md Play screen). */
  private fieldLayout(): Layout {
    return { ...this.layoutNow, column: playStage(this.layoutNow, this.settings.textSize / 100).column };
  }

  // ------------------------------------------------------------ the game loop on this side

  private async onStep(m: Extract<FromWorker, { t: "step" }>): Promise<void> {
    const fresh = this.game === null || m.resumed || this.game.matchup.seed !== m.matchup.seed;
    if (fresh) {
      this.game = { matchup: m.matchup, human: m.human, state: m.state, request: null, menu: null, events: [], lastPlay: null, result: "", cardResult: "", before: [], autoChain: [], calls: "", eventLines: [], why: null, save: null, framePossession: null, shownPending: null, requestAt: 0, runoffShown: 0, lastSame: false, drive: null };
      this.flights.clear();
      // S2: no box score or log from the last game.
      this.box = null;
      this.logCache = null;
      // A new or resumed game's halftime and end screens slide and count up again.
      this.heroAt = null;
      this.bugShown = null;
      this.trackerShown = null;
      this.stack = [{ id: "game" }];
      // Game mode from the first step: the cut (main menu spec decision 10).
      this.applyMode();
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
      // The drive line waits for the step's drive: the plays in between would show the old one.
      if (m.events.some((e) => e.t === "play")) g.drive = null;
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
          // Q1: this play ran because the app continued its dead ball itself.
          const wasAuto = this.autoPlay;
          // Compared without a close call's verdict: a ruling that stood was shown without it (code review).
          const key = pendingKey(ev.play);
          g.eventLines = pre;
          pre = [];
          // A run-off the request's snapshot already showed before the snap isn't counted down again.
          if (g.shownPending !== key) await this.animate(g, ev, runoff, prev);
          // Shown already while a request was pending: its moment fires now, from the committed result.
          else await this.replayMoment(g, ev);
          g.runoffShown = 0;
          g.shownPending = null;
          runoff = 0;
          this.setPlayText(g, ev);
          // Q1 "Before that:": the auto-advanced plays right before this one, when it was auto-advanced too.
          g.before = wasAuto ? g.autoChain.slice(-2) : [];
          g.autoChain = wasAuto ? [...g.autoChain, ev] : [];
          this.autoPlay = false;
          // fx.firstDown in the bug: a new set of downs for the same team flashes the down segment once.
          if (newFirstDown(ev.before, ev.after, { kind: ev.play.kind, stood: playStood(ev, this.ui?.rules.penalties ?? {}), endSpot: playEnd(ev.play) })) this.flights.start("firstDown", {}, performance.now());
          prev = { ...prev, ...ev.after } as GameState;
          // The scoreboard follows each play, not the end of the batch.
          this.showCommitted(g, ev);
          this.render();
          continue;
        }
        const line = eventLine(ev, ctx);
        if (line !== null) g.eventLines.push(line);
        // moment.periodEnd: the end of the 1st and 3rd quarters (the half and the game have their own screens).
        if (ev.t === "endPeriod" && this.ui !== null && ev.period < this.ui.rules.game.regulationPeriods && ev.period % this.ui.rules.game.periodsPerHalf !== 0) {
          g.periodEnd = ev.period;
          this.flights.start("lineScore", {}, performance.now());
        }
        if (ev.t === "endPeriod" && this.ui !== null && ev.period === this.ui.rules.game.periodsPerHalf && m.state?.phase !== "final") {
          this.render();
          await this.wait((done) => ({ id: "halftime", done }));
          this.requestBox();
        }
      }
      if (pre.length > 0) g.eventLines.push(...pre);
      g.state = m.state;
    }
    g.drive = m.drive ?? null;
    g.request = m.request;
    g.committed = false;
    g.menu = m.request === null ? null : openMenu(m.request);
    // A new call starts in Pre-snap state 1: the last play's frame and the full Last play card (U1).
    this.previewArmed = false;
    // What happened in this dead ball before the decision (request.events): the run-off, timeouts,
    // the two-minute warning. A human defense is asked after the run-off, so it shows before the snap.
    if (m.request !== null && m.request.events.length > 0) {
      const ctx = this.textCtx(g);
      const lines = m.request.events.map((e) => requestEventLine(e, ctx));
      g.eventLines = [...g.eventLines, ...lines.filter((l) => !g.eventLines.includes(l))];
      g.runoffShown = m.request.events.reduce((a, e) => a + (e.t === "runoff" ? e.seconds : 0), 0);
    }
    // moment.twoMinute: the warning event turns the clock signal and brings in the Under 2:00 tag.
    if (!m.resumed && [...m.events, ...(m.request?.events ?? [])].some((e) => e.t === "twoMinuteWarning")) this.flights.start("twoMin", {}, performance.now());
    g.requestAt = performance.now();
    this.highlight = 0;
    const pending = pendingPlay(m.request);
    if (pending !== null) await this.showPending(g, pending);
    this.idleField(g);
    this.autoAdvancing = false;
    // Q1: a dead ball with nothing to decide continues itself in the frame the calling screen would
    // have shown; the calling screen never renders (no timer, no flash). Only from the game screen.
    const auto = autoAnswer(m.request, this.settings.autoAdvance, { events: g.events, firstAfterResume: m.resumed, stepEvents: m.events });
    if (auto !== null && this.stack.length === 1 && this.top()?.id === "game") {
      this.autoPlay = true;
      this.autoAdvancing = true;
      g.menu = null;
      bumpLog((l) => (l.autoAdvanced = (l.autoAdvanced ?? 0) + 1));
      this.client.send({ t: "answer", answer: auto });
      this.render();
      return;
    }
    if (m.request === null && g.state?.phase === "final") {
      bumpLog((l) => l.gamesFinished++);
      this.stack = [{ id: "game" }, { id: "end" }];
      this.requestBox();
    }
    this.render();
    // moment.matchupIntro: once per game, as it starts (Quick play goes straight in); never on a resume.
    if (fresh && !m.resumed && !this.reducedMotion()) this.startIntro(g);
  }

  /**
   * moment.matchupIntro (DESIGN.md Moments): the face-off band over the stage, the halves shrinking
   * into the bug's name plates while the bug fades in, then the coin toss rows enter. Any key or
   * click skips it at once.
   */
  private startIntro(g: GameView): void {
    this.intro?.skip();
    const bar = this.root.topBar;
    const intro = matchupIntro(
      this.faceoffTeams(g.matchup),
      g.human,
      () => {
        const p = bar.querySelectorAll<HTMLElement>(".bug .plate");
        return { away: p[0]?.getBoundingClientRect() ?? null, home: p[1]?.getBoundingClientRect() ?? null };
      },
      () => {
        this.intro = null;
        bar.classList.remove("intro-wait");
        // 2300 ms on: the coin toss rows enter as in Rows, Menu change.
        if (g.menu !== null && !this.reducedMotion()) this.menuEnter = { menu: g.menu, back: false, at: performance.now() };
        this.render();
      },
    );
    this.intro = intro;
    restartAnimation(bar, "intro-wait");
    intro.el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      intro.skip();
    });
    document.body.append(intro.el);
    requestAnimationFrame(() => intro.land());
  }

  /** Both teams as the face-off shows them: the matchup's resolved slots (fill, outline) and their words. */
  private faceoffTeams(m: Matchup): Record<Side, FaceoffTeam> {
    const inks = this.inks(m);
    const t = (side: Side): FaceoffTeam => ({ fill: inks[side].fill, ring: inks[side].ring, place: m[side].place, nickname: m[side].nickname });
    return { away: t("away"), home: t("home") };
  }

  /**
   * menu.scoreHero (DESIGN.md Halftime and end of game): the face-off band with each score beside
   * its nickname, then the line score. The halves slide in 40 px from their outer edges over
   * dur.screen and the scores count up from 0 over 600 ms; reduced motion: static.
   */
  private scoreHero(g: GameView, id: string): HTMLElement[] {
    const s = g.state;
    if (s === null) return [];
    const reg = this.ui?.rules.game.regulationPeriods ?? 4;
    const periods = Math.max(reg, s.period);
    const box = lineScore(g.events, periods);
    const teams = this.faceoffTeams(g.matchup);
    const band = faceoffBand(teams, { you: g.human, scores: s.score });
    const now = performance.now();
    if (this.heroAt?.id !== id) this.heroAt = { id, at: now };
    const elapsed = now - this.heroAt.at;
    if (!this.reducedMotion()) {
      if (elapsed < DUR.screen) resume(band, "hero-in", elapsed);
      if (elapsed < COUNT_UP_MS) {
        for (const el of band.querySelectorAll<HTMLElement>(".fo-score")) el.textContent = String(Math.round(Number(el.dataset["to"] ?? 0) * ease(EASE.out, elapsed / COUNT_UP_MS)));
        requestAnimationFrame(() => this.countUp());
      }
    }
    const row = (side: Side) => ({ fill: teams[side].fill, nickname: teams[side].nickname, byPeriod: box[side], total: s.score[side] });
    return [band, lineScoreTable({ heads: Array.from({ length: periods }, (_, i) => periodText(i + 1, reg)), rows: { away: row("away"), home: row("home") } })];
  }

  /** One frame of the score hero's count-up, on the panel as built (ends at 600 ms, the final value). */
  private countUp(): void {
    const at = this.heroAt;
    if (at === null || this.top()?.id !== at.id) return;
    const f = (performance.now() - at.at) / COUNT_UP_MS;
    const els = this.root.panel.querySelectorAll<HTMLElement>(".faceoff .fo-score");
    for (const el of els) el.textContent = String(Math.round(Number(el.dataset["to"] ?? 0) * ease(EASE.out, Math.min(1, f))));
    if (f < 1 && els.length > 0) requestAnimationFrame(() => this.countUp());
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
    g.cardResult = playResultText(ev, ctx);
    g.calls = callsLine(ev, ctx);
    g.why = whyHeadline(ev.play, ev.standout);
    if (g.why === null) console.warn(`No explanation for play ${ev.after.period}:${ev.before.clock} (seed ${g.matchup.seed}, event ${g.events.length - 1}).`);
    this.announce(g);
  }

  private announce(g: GameView): void {
    this.root.live.textContent = [g.result, g.calls, ...g.eventLines, g.why ?? "No explanation for this play."].filter((x) => x !== "").join(" ");
  }

  /** The bug shows this committed play's state from now on (the banner's sub line, or the play's commit). */
  private showCommitted(g: GameView, ev: PlayEvent): void {
    if (g.state === null) return;
    g.state = { ...g.state, ...ev.after };
    g.committed = true;
    this.renderTopBar();
  }

  /** The moment a committed play fires, with its banner team's colors (DESIGN.md Moments). */
  private momentOf(g: GameView, ev: PlayEvent): { readonly moment: Moment; readonly ink: SideInk | null } {
    if (this.motion === null || this.ui === null) return { moment: NO_MOMENT, ink: null };
    const moment = playMoment(ev, { teams: g.matchup, human: g.human, endZoneYards: this.ui.rules.field.endZoneYards, penalties: this.ui.rules.penalties ?? {}, moments: this.motion.moments });
    const ink = moment.banner === null ? null : this.inks(g.matchup)[moment.banner.team];
    return { moment, ink: ink === null ? null : { fill: ink.fill, ring: ink.ring } };
  }

  /**
   * The committed result of a play already shown during a pending request: its moment on the last
   * play's whistle frame (the play screen again, for the moment's hold), the bug changing with it.
   */
  private async replayMoment(g: GameView, ev: PlayEvent): Promise<void> {
    const mo = this.momentOf(g, ev);
    const m = mo.moment;
    if (m.banner === null && !m.firstDown && m.bigPlay === null) return;
    this.animating = true;
    this.render();
    await this.animator.replayMoment(mo, { speed: this.settings.speed, reducedMotion: this.reducedMotion(), onMoment: () => this.showCommitted(g, ev) });
    this.animating = false;
  }

  /** `withMoment` false: a pending request's showing, whose result is not committed yet, fires no moment. */
  private async animate(g: GameView, ev: PlayEvent, runoff: number, prev: GameState | null, withMoment = true): Promise<void> {
    if (this.templates === null || this.ui === null) return;
    // The rail's calls, from this committed event only; they show from the snap.
    this.railPlay = { calls: callsLine(ev, this.textCtx(g)).split(/(?<=\.) (?=They:)/), phase: "pre", auto: this.autoPlay };
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
      { presetPackage: this.ui.presetPackage, endZoneYards: this.ui.rules.field.endZoneYards, numbers: this.numbers(), ratings: this.motionRatings(), pxPerYard: this.layoutNow.s, markPx: this.layoutNow.markPx, motion: this.motion as Motion },
    );
    for (const w of tl.warnings ?? []) {
      if (this.warned.has(w)) continue;
      this.warned.add(w);
      console.warn(w);
    }
    const flip = g.framePossession !== null && g.framePossession !== ev.before.possession;
    if (flip) this.animator.idle(this.sceneFor(ev.before.possession, ev.before.spot, null), false, !this.reducedMotion());
    g.framePossession = ev.before.possession;
    // The next snap ends moment.periodEnd's line score and "End 1st".
    g.periodEnd = null;
    this.animating = true;
    this.autoAdvancing = false;
    this.render();
    // Moments (DESIGN.md Motion, Moments): what the committed play fired; the animation holds and draws it, never decides it.
    const mo = withMoment ? this.momentOf(g, ev) : { moment: NO_MOMENT, ink: null };
    const moment = mo.moment;
    // field.downTag: the same text as the bug's down block, for the situation before this snap.
    const sit = situationText(ev.before, g.human);
    const at = sit.indexOf(" at ");
    await this.animator.play(tl, this.sceneFor(ev.before.possession, tl.los, tl.firstDown, at < 0 ? sit : sit.slice(0, at)), {
      speed: this.settings.speed,
      reducedMotion: this.reducedMotion(),
      onClock: (s) => {
        this.clockOverride = s;
        this.renderTopBar();
      },
      onSnap: () => {
        if (this.railPlay === null || this.railPlay.phase === "snap") return;
        this.railPlay.phase = "snap";
        this.renderRail();
      },
      moment: mo,
      // The bug's score and possession change on the frame the banner's sub line appears.
      onMoment: () => {
        if (moment.banner !== null) this.showCommitted(g, ev);
      },
    });
    this.clockOverride = null;
    this.animating = false;
    this.railPlay = null;
  }

  /**
   * A penalty choice, a ten-second run-off, a challenge or a review comes after the snap: show the
   * ruled play first, then ask.
   */
  private async showPending(g: GameView, req: PendingPlay): Promise<void> {
    const key = pendingKey(req.play);
    if (g.shownPending === key || g.state === null) return;
    const before = { period: g.state.period, clock: g.state.clock, phase: g.state.phase, possession: g.state.possession, spot: g.state.spot, down: g.state.down, distance: g.state.distance, goalToGo: g.state.goalToGo, score: g.state.score, timeouts: g.state.timeouts, clockRunning: g.state.clockRunning, safetyKick: g.state.safetyKick };
    const ev: PlayEvent = { t: "play", before, offense: req.offenseCall, defense: req.defenseCall, play: req.play, penalty: null, runoffTimeout: false, after: before };
    g.eventLines = [];
    const ctx = this.textCtx(g);
    const flag = penaltyText(ev, ctx);
    const result = `${playText(ev, ctx).replace(/^./, (c) => c.toUpperCase())}.${flag === "" ? "" : ` ${flag}`}`;
    const why = whyHeadline(ev.play);
    await this.animate(g, ev, 0, g.state, false);
    g.shownPending = key;
    g.lastPlay = ev;
    g.result = result;
    g.cardResult = result;
    g.before = [];
    g.calls = callsLine(ev, ctx);
    g.why = why;
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
        const first = !this.hasSave;
        this.hasSave = true;
        this.saveFailed = false;
        if (this.storageWarning !== null) {
          this.storageWarning = null;
          this.renderStatus();
        }
        // Back on the main menu before this write landed: Continue turns on (and takes the highlight).
        if (first && this.game === null && this.top()?.id === "title") this.render();
      })
      .catch(() => {
        // Quota or a denied write: say so, retry at the next dead ball, never block play.
        this.storageWarning = STORAGE_BLOCKED;
        this.saveFailed = true;
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
    // moment.matchupIntro: any key skips to the coin toss with the bug in place, at once.
    // Modifier shortcuts and Tab still skip it but keep their browser meaning (no preventDefault).
    if (this.intro != null) {
      const shortcut = e.ctrlKey || e.metaKey || e.altKey || e.key === "Tab";
      if (!shortcut) e.preventDefault();
      this.intro.skip();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.layoutNow.tooSmall || this.fatal !== null || this.loading !== null) return;
    const k = e.key;
    // A held Space or Enter (a key repeat) never skips, continues or clicks the focused row: the
    // repeat of the Continue press reached the play and the next menu (debugger, U8).
    if (e.repeat && (k === " " || k === "Enter")) {
      e.preventDefault();
      return;
    }
    // Q2: the focused game log scrolls natively (a line, a screen, Home newest, End oldest).
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(k) && this.top()?.id === "box" && this.root.panel.querySelector(".game-log") === document.activeElement) return;
    if (k === "m" || k === "M") {
      // Cycle the player cards over the marks on the field (Joseph's amendment: hover or focus).
      if (uiMode(this.game) === "game") this.cycleMarkCard();
      e.preventDefault();
      return;
    }
    if (this.markCard !== null && (k === "Escape" || k === "Enter")) {
      this.closeMarkCard();
      e.preventDefault();
      return;
    }
    // Q3: the player card over the calling screen's call column makes the covered rows inert: no
    // number key, T, arrow or Enter-on-a-row reaches the menu while it is open (M and Esc above).
    if (this.markCard !== null && !this.animating && this.stack[0]?.id === "game" && this.top()?.id === "game") {
      e.preventDefault();
      return;
    }
    // Q2: L opens the game log from the calling screen or the pause menu, and closes it (never during a play).
    if ((k === "l" || k === "L") && !this.animating && !this.autoAdvancing && this.game !== null) {
      const top = this.top();
      if (top?.id === "box" && top.tab === "Game log") this.back();
      else if (top?.id === "game" || top?.id === "pause") this.openOverlay({ id: "box", tab: "Game log" });
      e.preventDefault();
      return;
    }
    if (this.animating || this.autoAdvancing) {
      // Only skip and speed work during the animation; nothing else is buffered.
      if (k === " " || k === "Enter") this.animator.skip();
      else if (k === "s" || k === "S") {
        this.settings.speed = this.animator.cycleSpeed(this.settings.speed);
        this.settingsStored = saveSettings(this.settings);
        this.status = `Animation speed: ${this.settings.speed}`;
        this.renderStatus();
        this.renderTopBar();
        this.renderRail();
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
      // Once the player moves the highlight on the main menu, it is his (main menu spec decision 4).
      if (this.top()?.id === "title") this.autoHighlight = false;
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
    this.notePress(key);
    this.pick(key);
  }

  /**
   * The row of the key just pressed answers (DESIGN.md Rows, Pressed): the press is noted with the
   * screen it was made on, so a rebuild of the same screen keeps it, and the row in the page now
   * starts it at once. A pick that changes the screen shows the menu change instead.
   */
  private notePress(key: string): void {
    if (this.reducedMotion()) {
      this.pressed = null;
      return;
    }
    this.pressed = { key, screen: this.clickScreen(), at: performance.now() };
    const b = this.container().querySelector<HTMLElement>(`button.row[data-key="${key}"]:not(.off)`);
    if (b === null) return;
    b.style.setProperty("--since", "0ms");
    restartAnimation(b, "pressed");
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
    // U5: the offense's Earlier call, from your own committed play events.
    if (req?.kind === "offenseCall") return { ...base, earlierCall: earlierCall(g.events, g.human, req) };
    if (req?.kind !== "penalty") return base;
    const ctx = this.textCtx(g);
    return { ...base, penaltyLabels: Object.fromEntries(req.outcomes.map((o) => [o.option, penaltyChoiceText(o.option, o.after, ctx, req.play.fouls)])) };
  }

  private pick(key: string): void {
    const top = this.top();
    if (top === undefined) return;
    if (top.id === "game") {
      this.status = "";
      return this.pickInGame(key);
    }
    const picked = pickRow(this.screenModel(), key);
    // The pause menu's seven rows leave no room for Esc; Esc there resumes.
    if (picked.t === "none" && key === "Esc" && top.id === "pause") {
      this.status = "";
      return this.back();
    }
    // A key with no row (Esc on the main menu) changes nothing, the status line included.
    if (picked.t === "none") return;
    this.status = "";
    if (picked.t === "reason") {
      this.status = picked.text;
      this.renderStatus();
      return;
    }
    this.act(top, picked.row);
  }

  private pickInGame(key: string): void {
    const g = this.game;
    if (g === null || g.menu === null || this.ui === null) return;
    const wasFirst = isFirstScreen(g.menu);
    const was = g.menu;
    const extra = this.menuExtra(g);
    const { menu, effect } = press(g.menu, key as MenuKey, this.menuData(), extra);
    if (key === "Esc" && !wasFirst) bumpLog((l) => l.escBackOuts++);
    g.menu = menu;
    // Esc back to a first screen returns to state 1 (calling spec, Pre-snap; U1: the full card again).
    if (key === "Esc" && !wasFirst && isFirstScreen(menu)) this.previewArmed = false;
    // A pick that opens the next menu, or Back: its rows enter (DESIGN.md Rows, Menu change).
    if (menu !== was && !this.reducedMotion()) this.menuEnter = { menu, back: menu.screens.length < was.screens.length, at: performance.now() };
    this.highlight = 0;
    switch (effect.t) {
      case "reason":
        this.status = reasonText(effect.reason);
        break;
      case "note":
        this.status = effect.text;
        break;
      case "pause":
        this.openOverlay({ id: "pause" });
        return;
      case "submit": {
        const path = effect.answer.path;
        const row = menuRows(g.menu, this.menuData(), extra).find((r) => r.key === key);
        if (row?.option === "sameCall") bumpLog((l) => l.sameCalls++);
        if (row?.option === EARLIER_CALL) bumpLog((l) => (l.earlierCalls = (l.earlierCalls ?? 0) + 1));
        // Earlier call starts both sides in the huddle, like Same call (U5).
        g.lastSame = row?.option === "sameCall" || row?.option === EARLIER_CALL;
        g.earlierSent = row?.option === EARLIER_CALL;
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

  /** Asks the worker for the box score, tagged with the game and its event count now (S2, R1). */
  private requestBox(): void {
    const g = this.game;
    this.client.send(g === null ? { t: "box" } : { t: "box", tag: { seed: g.matchup.seed, events: g.events.length } });
  }

  private openOverlay(o: Overlay): void {
    if (o.id === "box" && o.tab === "Game log") this.focusLog = true;
    if (o.id === "details") bumpLog((l) => l.detailsOpens++);
    if (o.id === "box" || o.id === "card") this.requestBox();
    this.screenTrail.open(o, this.highlight);
    this.stack.push(o);
    this.highlight = 0;
    this.render();
  }

  private back(): void {
    const closed = this.stack.length > 1 ? this.stack.pop() : undefined;
    this.highlight = closed === undefined ? 0 : (this.screenTrail.close(closed) ?? 0);
    // Back on the main menu by any path: the highlight follows Continue again (decision 4).
    if (this.top()?.id === "title") this.autoHighlight = true;
    this.render();
  }

  /** Leaving the game: a player card open over the field closes and its pause on the animator ends. */
  private dropMarkCard(): void {
    if (this.markCard === null) return;
    this.markCard = null;
    this.animator.resume();
    this.cardTrail.close("markCard");
  }

  /** Quick play: a fresh random matchup with you as the home side, started at once. */
  private quickPlay(): void {
    this.seed = randomSeed();
    this.human = "home";
    this.matchup = null;
    this.startOnMatchup = false;
    this.client.send({ t: "newGame", leagueSeed: this.leagueSeed, seed: this.seed, human: this.human });
  }

  private act(top: Overlay, row: ScreenRow): void {
    const a = row.action;
    // A pick on the main menu ends the highlight following Continue; coming back restores his row.
    if (top.id === "title") this.autoHighlight = false;
    switch (a) {
      case "back":
        if (top.id === "saveError") this.stack = [{ id: "title" }];
        this.back();
        return;
      case "newGame":
        // Quick play: a random matchup, you coach the home side, straight into the game (no pregame).
        this.quickPlay();
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
        this.dropMarkCard();
        this.game = null;
        this.quickPlay();
        return;
      case "rematch":
        this.dropMarkCard();
        if (this.game !== null) {
          this.human = this.game.human;
          this.matchup = null;
          // The worker answers with the same two teams under a new seed; the game starts on that answer.
          this.startOnMatchup = true;
          this.client.send({ t: "rematch", leagueSeed: this.game.matchup.leagueSeed, seed: this.game.matchup.seed });
          this.game = null;
        }
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
        this.settingsStored = saveSettings(this.settings);
        this.render();
        return;
      case "controls":
        this.openOverlay({ id: "controls" });
        return;
      case "quit":
      case "title":
        this.dropMarkCard();
        this.animator.stop();
        this.animating = false;
        this.game = null;
        this.stack = [{ id: "title" }];
        this.autoHighlight = true;
        this.root.live.textContent = this.hasSave && !this.saveFailed && this.storageWarning === null ? "Main menu. Your game is saved." : "Main menu.";
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
      case "labelContent":
        this.settings.labelContent = this.settings.labelContent === "rating" ? "number" : "rating";
        break;
      case "autoAdvance":
        this.settings.autoAdvance = this.settings.autoAdvance === "off" ? "noDecision" : this.settings.autoAdvance === "noDecision" ? "all" : "off";
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
            // Words only on screen (DESIGN.md Pregame); the storage key goes to the log.
            if (key !== null) console.info(`Old save kept aside as ${key}.`);
            this.status = key === null ? "" : "Your old save is kept.";
            this.act({ id: "title" }, { key: "1", label: "Quick play", on: true, action: "newGame" });
          });
        return;
      case "deleteSave":
        void deleteSave().finally(() => {
          this.hasSave = false;
          this.stack = [{ id: "title" }];
          this.autoHighlight = true;
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
        if (top.id === "box" && top.tab === "Game log") this.focusLog = true;
        this.render();
        return;
    }
    this.settingsStored = saveSettings(this.settings);
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
    return (this.placement?.compact ?? false) || this.settings.textSize >= 150 || (this.textRowsFor !== null && this.textRowsFor === this.game?.menu);
  }

  /** Cards in the grid's first row: the columns that fit the overlay now. */
  private gridColumns(): number {
    const cards = [...this.root.panel.querySelectorAll<HTMLElement>(".cards .play-card")];
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
    // Only a call's lineup moves the guard: a kickoff lineup (U8) is 60 yards deep and public.
    const calling = req !== null && (req.kind === "offenseCall" || req.kind === "try" || req.kind === "defenseCall");
    if (preview !== null && calling) {
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
    // Q1: while the app continues a dead ball itself, the calling screen stays hidden (the field shows).
    const shown = overlaysShown({ animating: this.animating || this.autoAdvancing, markCard: this.markCard !== null });
    // In a game the screens switch (docs/specs/m2-screen-switch.md): calling fills the window, the
    // play is the field alone. Out of a game, placeOverlay as before.
    const screen = gameScreen({ inGame: this.game !== null && this.stack[0]?.id === "game", animating: this.animating || this.autoAdvancing });
    const p = screen === "calling" ? callingPlacement(l) : placeOverlay(l, this.animator.cameraY(), this.loading !== null || this.fatal !== null ? null : this.guard(), markYards, this.animator.ballX());
    this.root.canvas.style.visibility = screen === "calling" ? "hidden" : "";
    // A switch fades the incoming screen in (DESIGN.md UI transitions); the timeline never waits on it.
    if (screen !== this.screenShown) {
      if (screen === "play") for (const el of [this.root.canvas, this.root.rail]) restartAnimation(el, "screen-in");
      else if (screen === "calling" && this.screenShown === "play") restartAnimation(this.root.panel, "screen-in");
      this.screenShown = screen;
    }
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
    // The calling screen has no panel background: the stage shows through and the cards are glass
    // (DESIGN.md Calling screen). Sheets placed by placeOverlay keep the opaque dark board (U1).
    panel.style.background = p.where === "screen" ? "transparent" : overlayBackground();
    // In the side column the panel fills it, top bar to window bottom, so the footer sits at the bottom.
    panel.style.height = p.fill ? `${p.maxHeight}px` : "";
    panel.classList.toggle("side", p.where === "side");
    panel.classList.toggle("screen", p.where === "screen");
    // Two cards side by side at 760 px of content width and up (the content is at most 1160 px, 24 px padding each side).
    const content = p.where === "screen" ? Math.min(1160, p.width - 48) : p.width;
    panel.classList.toggle("wide", this.top()?.id === "game" && p.where !== "sheet" && p.where !== "side" && content >= 760);
    panel.classList.toggle("compact", p.compact);
    const card = this.root.markCard;
    if (shown["mark-card"]) {
      // The play screen places the card from the drawn stage (the centered column and rail), never
      // from layoutFor's flush-left side margin, so it never lands on the column.
      const onCard = screen === "play" ? playCardPlacement(playStage(l, this.settings.textSize / 100)) : null;
      if (onCard !== null) {
        this.position(card, onCard.left, onCard.width, onCard.top, onCard.maxHeight, "top");
      } else if (screen !== "play" && (p.where === "side" || p.where === "screen")) {
        // Over the calling screen's panel (the field isn't shown), or menu mode's side column.
        this.position(card, p.left, Math.min(360, p.width), p.top, p.maxHeight, "top");
      } else {
        // Beside the panel's stretch, on the side away from the player; full height while the play is paused.
        const hit = this.animator.marks().find((x) => x.id === this.markCard);
        const f = floatingCardPlacement(l, hit?.x ?? null);
        if (shown.panel) this.position(card, f.left, f.width, p.top, p.maxHeight, p.anchor);
        else this.position(card, f.left, f.width, f.top, f.maxHeight, "top");
      }
    }
  }

  private position(el: HTMLElement, left: number, width: number, top: number, maxHeight: number, anchor: "top" | "bottom"): void {
    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
    el.style.maxHeight = `${maxHeight}px`;
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

  /**
   * U1: focusing Same call or Earlier call previews that call on its own lineup, formation (or
   * package) plus play art, drawn from the call only (calling spec decision 9, P3). Null for a call
   * with no lineup (a kick, a kneel) or no call yet: the committed state stays.
   */
  private recentCallCounts(g: GameView, option: string): ReturnType<App["countsFor"]> {
    const ui = this.ui;
    const req = g.request;
    if (ui === null || req === null) return null;
    if (req.kind === "defenseCall") {
      if (option !== "sameCall" || req.sameCall === null) return null;
      const pkg = ui.presetPackage[req.sameCall] ?? "base";
      return { counts: ui.personnel.packages[pkg] ?? {}, side: "defense", unit: pkg, call: req.sameCall };
    }
    if (req.kind !== "offenseCall" && req.kind !== "try") return null;
    const e = option === EARLIER_CALL && req.kind === "offenseCall" ? earlierCall(g.events, g.human, req) : null;
    const call = option === EARLIER_CALL ? (e?.on === true ? e.call : null) : req.sameCall;
    if (call === null || call.formation === undefined) return null;
    const leaf = call.call === "goForTwo" ? (call.twoPointPlay ?? null) : call.call;
    return { counts: ui.personnel.offense[call.formation] ?? {}, side: "offense", unit: call.formation, call: leaf };
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
        { class: `play-card${r.on ? "" : " off"}${i === this.highlight ? " hl" : ""}`, type: "button", "data-i": String(i), "data-key": r.key, "aria-label": name, "aria-description": desc, "aria-disabled": r.on ? undefined : "true" },
        h("span", { class: "play-card-label" }, h("span", { class: "key" }, r.key), " ", r.label, r.on ? "" : ` (${r.reason ?? "not now"})`),
      );
      const art = h("span", { class: "play-card-art", "aria-hidden": "true" });
      art.innerHTML = cardSvg(cardArt(kind, c.unit, c.call, c.counts, t), c.side);
      b.append(art);
      if (personnel !== null) b.append(h("span", { class: "play-card-personnel" }, personnel));
      b.addEventListener("click", (e) => {
        if (clickPicks(e.detail) && !this.animating) this.pick(r.key);
      });
      // Hover moves the highlight and the field preview in place: rebuilding the panel here swapped
      // the card out between press and release, and the click never picked (click.ts).
      b.addEventListener("mouseenter", () => {
        if (this.highlight === i && this.previewArmed && this.status === desc) return;
        this.highlight = i;
        this.previewArmed = true;
        this.status = desc;
        this.markHighlight();
        if (this.markCard === null && document.activeElement !== b) b.focus({ preventScroll: true });
        this.updatePreview();
        this.renderStatus();
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
    // Before a kickoff, theirs or yours: both units lined up from the moment the dead ball shows (U8).
    if (req.kind === "kickoff" || (req.kind === "continue" && req.about.what === "theyKickOff")) return this.showPublic(g, req.seq, "kickoff");
    // U1: their visible line-up (punt, field goal, extra point, kneel, spike): both units, no input needed.
    if (req.kind === "continue" && req.about.what === "theyLineUp" && PUBLIC_CALLS.has(req.about.call)) return this.showPublic(g, req.seq, req.about.call as PublicCall);
    if (req.kind !== "offenseCall" && req.kind !== "try" && req.kind !== "defenseCall") return;
    const m = g.menu;
    const s = g.state;
    const list = menuRows(m, this.menuData(), this.menuExtra(g));
    const focused = list[this.highlight]?.option;
    // U1: your Kick rows on focus line up your kick unit and their return unit (public before every kick).
    if (current(m) === "offense.kick" && (focused === "punt" || focused === "fieldGoal") && this.previewArmed) return this.showPublic(g, req.seq, focused);
    let c = focused === undefined ? null : focused === "sameCall" || focused === EARLIER_CALL ? this.recentCallCounts(g, focused) : this.countsFor(m, focused);
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
    const scale = this.previewScale();
    const key = JSON.stringify([req.seq, c.unit, c.call, scale.s]);
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
      pxPerYard: scale.s,
      markPx: scale.markPx,
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
    if (this.game !== null && this.box === null) this.requestBox();
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
    // U1: when the board shows, M cycles the marks on the board; else the field's.
    const marks = this.boardMarks() ?? this.animator.marks().map((m) => m.id);
    if (marks.length === 0) return;
    const i = marks.indexOf(this.markCard ?? "");
    this.openMarkCard(marks[(i + 1) % marks.length] as string);
    this.markCardHovered = false;
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
    // The header band in the team's fill, its text in the slot's outline color (DESIGN.md card.panel).
    const ink = this.teamInkOf(team);
    // One row per rating: name, value, league rank. "of N TEs" goes once in the header, not on every row.
    let of: number | undefined;
    const ratings = [...Object.entries(p.ratings), ...Object.entries(p.skills)].map(([k, v]) => {
      const r = ranks?.[k];
      if (r !== undefined) of = r.of;
      return h("tr", {}, h("th", { scope: "row" }, RATING_NAME[k] ?? k), h("td", { class: "val" }, String(v)), h("td", { class: "rank" }, r === undefined ? "" : ordinalRank(r.rank)));
    });
    const ratingHead = h("tr", {}, h("th", { scope: "col" }, ""), h("th", { scope: "col", class: "val" }, ""), h("th", { scope: "col", class: "rank" }, of === undefined ? "" : `Rank of ${of} ${plural}`));
    const play = playLines(id, this.game?.lastPlay ?? null);
    const line = this.box?.players.find((l) => l.id === id);
    return [
      h(
        "section",
        { class: "mark-card", role: "dialog", tabindex: "-1", "aria-label": `${p.name}, #${p.number}, ${p.position}`, "aria-live": "polite" },
        teamHead(ink, h("span", { class: "mono num" }, `#${p.number}`), h("span", { class: "name" }, p.name), h("span", { class: "pos" }, p.position), h("span", { class: "team-word" }, team.nickname)),
        h("h3", {}, "Ratings"),
        h("table", { class: "ratings" }, h("thead", {}, ratingHead), h("tbody", {}, h("tr", { class: "overall" }, h("th", { scope: "row" }, "Overall"), h("td", { class: "val" }, this.templates === null ? "" : String(overallRating(p, this.templates.overallWeights))), h("td", { class: "rank" }, "")), ...ratings)),
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
        return titleScreen({ hasSave: this.hasSave, storage: this.storage, checking: this.checking });
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
        return settingsScreen({ ...this.settings, systemReduced: this.reducedQuery.matches });
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

  /** Shows the regions of the current mode and hides the others, together (main menu spec decision 1). */
  private applyMode(): void {
    const hidden = regionsHidden(uiMode(this.game));
    this.root.menu.hidden = hidden.mainMenu;
    this.root.topBar.hidden = hidden.topBar;
    this.root.main.hidden = hidden.layout;
  }

  /** Where the current screen's rows are: #main-menu in menu mode, the game panel in game mode. */
  private container(): HTMLElement {
    return uiMode(this.game) === "menu" ? this.root.menu : this.root.panel;
  }

  private render(): void {
    // The in-game reduced-motion setting turns UI transitions off like the system setting does.
    document.documentElement.classList.toggle("reduce-motion", this.reducedMotion());
    this.applyMode();
    if (uiMode(this.game) === "menu") return this.renderMenu();
    this.renderTopBar();
    const p = this.root.panel;
    this.captureHighlight();
    // S1: the game log keeps its focus and scroll through a rebuild (the box score's reply re-renders).
    const oldLog = p.querySelector<HTMLElement>(".game-log");
    const logFocused = oldLog !== null && document.activeElement === oldLog;
    const logScroll = oldLog?.scrollTop ?? 0;
    p.replaceChildren(...this.panelContent());
    const newLog = p.querySelector<HTMLElement>(".game-log");
    if (newLog !== null && newLog === oldLog) newLog.scrollTop = logScroll;
    this.sheetMotion(p);
    this.root.markCard.replaceChildren(...this.markCardContent());
    this.placeOverlays();
    // The board first: the calling previews line up at its scale when it shows (U1).
    this.fitBoard();
    if (this.fitCallCard()) return;
    this.updatePreview();
    this.placeCallingCard();
    this.fitTracker();
    this.placeHighlights();
    this.renderRail();
    this.renderStatus();
    // Keep keyboard focus on the highlighted row or card, so screen readers follow the menu; the
    // player card keeps focus while it is open.
    const btn = p.querySelector<HTMLButtonElement>(`button[data-i="${this.highlight}"]`);
    if (btn !== null && !p.hidden && this.markCard === null && document.activeElement !== btn && !this.focusLog && !logFocused) btn.focus({ preventScroll: true });
    // Q2: on opening the game log, focus goes to the list (it scrolls with the arrows, Page Up and Down, Home and End).
    const log = p.querySelector<HTMLElement>(".game-log");
    if (log !== null && (this.focusLog || logFocused)) log.focus({ preventScroll: true });
    this.focusLog = false;
  }

  /** Sheets (pause, details, box score) rise 12 px and fade in over dur.slow when they open; hide in one frame. */
  private sheetMotion(p: HTMLElement): void {
    const top = this.top();
    const was = this.sheetShown;
    this.sheetShown = top;
    if (top === was || this.reducedMotion()) return;
    if (top?.id === "pause" || top?.id === "details" || top?.id === "box") restartAnimation(p, "sheet-in");
  }

  /** Menu mode (no game): the screen fills #main-menu; no top bar, no field, no frame loop. */
  private renderMenu(): void {
    const top = this.top();
    if (top?.id === "title" && this.autoHighlight) this.highlight = openingHighlight(this.screenModel() as ScreenModel);
    const menu = this.root.menu;
    this.captureHighlight();
    const frame = this.menuFrame();
    menu.replaceChildren(frame);
    this.menuMotion(frame, top);
    this.placeHighlights();
    this.root.markCard.replaceChildren();
    this.renderStatus();
    this.drawMenuArt();
    const btn = menu.querySelector<HTMLButtonElement>(`button[data-i="${this.highlight}"]`);
    if (btn !== null && document.activeElement !== btn) btn.focus({ preventScroll: true });
  }

  /**
   * Menu-mode motion (DESIGN.md Main menu, menu.enter; Screen transitions, menu mode). The main
   * menu's entrance runs on its first show after load only; a new screen enters from 24 px right,
   * Back from 24 px left. Rebuilds of the same screen start nothing. Reduced motion: none of it.
   */
  private menuMotion(frame: HTMLElement, top: Overlay | undefined): void {
    const now = performance.now();
    const still = this.reducedMotion();
    const depth = this.stack.length;
    const last = this.menuShown;
    this.menuShown = { top, depth };
    if (this.splashScreen() && this.loading === null && top?.id === "title") {
      if (this.heroEnter === undefined) this.heroEnter = still ? null : now;
      const at = this.heroEnter;
      if (at !== null && now - at < MENU_ENTER.wordmarkMs + MENU_ENTER.rowsAt) {
        resume(frame, "enter", now - at);
        const rows = frame.querySelector<HTMLElement>(".rows");
        // The rows enter as in Rows, Menu change, starting at 240 ms.
        if (rows !== null) resume(rows, "enter", now - at - MENU_ENTER.rowsAt);
        return;
      }
      this.heroEnter = null;
    }
    if (still || last === null || last.top === top) return;
    restartAnimation(frame, depth < last.depth ? "push-back" : "push-in");
  }

  /** The splash from first paint until a screen other than the main menu is up (no bare frame while loading). */
  private splashScreen(): boolean {
    return this.fatal === null && (this.loading !== null || this.stack.length === 0 || this.top()?.id === "title");
  }

  private menuFrame(): HTMLElement {
    if (this.splashScreen()) {
      const shown = artShown({ textSize: this.settings.textSize, windowWidth: window.innerWidth, canvas2d: this.canvas2d });
      return h(
        "div",
        { class: `menu-frame splash${shown ? "" : " no-art"}` },
        // menu.hero: "CLIPBOARD" over "FOOTBALL" at 88 px; 56 px under a 720 px frame or at 150% text.
        h("h1", { class: window.innerWidth - 64 < 720 || this.settings.textSize >= 150 ? "wordmark small" : "wordmark" }, h("span", { class: "wm-line" }, "Clipboard"), " ", h("span", { class: "wm-line" }, "Football")),
        h("div", { class: "menu-rule", "aria-hidden": "true" }),
        h("div", { class: "menu-cols" }, h("div", { class: "menu-left" }, ...this.splashLeft()), shown ? h("div", { class: "menu-art-col" }, this.menuArt) : null),
      );
    }
    const top = this.top();
    if (this.fatal !== null || top === undefined) {
      const f = this.fatal;
      return h("div", { class: "menu-frame narrow" }, h("h1", { class: "menu-title" }, f?.title ?? "Clipboard Football"), ...(f?.lines ?? []).map((l) => h("p", { class: "soft" }, l)));
    }
    const model = this.screenModel() as ScreenModel;
    return h(
      "div",
      { class: `menu-frame${NARROW_MENU_SCREENS.has(top.id) ? " narrow" : ""}` },
      // Pregame: the face-off is the title; the screen title shrinks to a type.label line.
      top.id === "pregame" ? h("h1", { class: "pregame-label" }, model.title) : h("h1", { class: "menu-title" }, model.title),
      h("section", { class: "glass" }, ...(model.lines ?? []).map((l) => h("p", { class: "soft mono seeds" }, l)), ...this.screenBody(top), this.rowsGroup(model.title, model.rows), ...this.afterRows(top), h("p", { class: "status", role: "status" })),
      this.footer(false),
    );
  }

  /** The main menu's left column: the tagline, then the loading meter, or the storage line and the rows. */
  private splashLeft(): HTMLElement[] {
    const tagline = h("p", { class: "tagline" }, "Call the plays. The X's and O's run them.");
    // Before the worker's first progress message: the first paint's "Loading...", unchanged.
    if (this.loading === null ? this.stack.length === 0 : this.loading.file === "" && this.loading.done === 0) return [tagline, h("p", { class: "menu-lead" }, "Loading...")];
    if (this.loading !== null) {
      const pct = Math.round((this.loading.done / Math.max(1, this.loading.total)) * 100);
      const meter = h("div", { class: "progress", role: "progressbar", "aria-label": "Loading league data", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) });
      const fill = h("div", { class: "progress-fill" });
      fill.style.width = `${pct}%`;
      meter.append(fill);
      return [tagline, h("p", { class: "menu-lead" }, "Loading league data"), h("div", { class: "progress-row" }, meter, h("span", { class: "soft mono" }, `${pct}%`)), h("p", { class: "soft mono" }, `${this.loading.done} of ${this.loading.total} files`)];
    }
    const model = this.screenModel() as ScreenModel;
    // One storage line at most: blocked storage, else a failed last write (Continue resumes an older save).
    const storageLine = !this.storage ? STORAGE_BLOCKED : this.saveFailed ? SAVE_FAILED : null;
    return [tagline, storageLine === null ? null : h("p", { class: "soft" }, storageLine), this.rowsGroup("Main menu", model.rows), h("p", { class: "status", role: "status" }), this.footer(false)].filter((x): x is HTMLElement => x !== null);
  }

  /** Starts the splash animation when it is in the page and its width, text size, motion setting or data changed. */
  private drawMenuArt(): void {
    const c = this.menuArt;
    if (!c.isConnected) return;
    const width = Math.floor(c.parentElement?.clientWidth ?? 0);
    if (width <= 0) return;
    const t = this.templates;
    const ui = this.ui;
    const still = this.reducedMotion();
    const key = JSON.stringify([width, this.settings.textSize, t !== null && ui !== null, window.devicePixelRatio, still]);
    // A loop that stopped (the canvas left the page) restarts when the menu comes back.
    if (key === this.menuArtKey && (this.splashLoop.running || still || t === null || ui === null)) return;
    this.menuArtKey = key;
    const art = t !== null && ui !== null ? (call: SplashCall, s: number) => splashFrame(t, { offense: ui.personnel.offense[call.formation] ?? {}, defense: ui.personnel.packages[call.pkg] ?? {} }, s, call) : null;
    this.splashLoop.run(c, width, t?.field ?? { markYards: 1.4, markMinPx: 14 }, art, still);
  }

  private renderStatus(): void {
    const box = this.container();
    const el = box.querySelector<HTMLElement>(".status");
    // In menu mode the storage line shows once, in the main menu's body (main menu spec decision 11).
    const warning = uiMode(this.game) === "menu" ? "" : (this.storageWarning ?? "");
    if (el !== null) el.textContent = [this.working ? "Working..." : "", this.status === "" ? this.offReason() : this.status, warning].filter((x) => x !== "").join(" ");
    // Settings: what the highlighted row changes (decision 7).
    const desc = box.querySelector<HTMLElement>(".setting-desc");
    if (desc !== null) desc.textContent = SETTINGS_DESCRIPTION[this.screenModel()?.rows[this.highlight]?.action ?? ""] ?? "";
  }

  /** Lines under a screen's rows: on Settings, the highlighted row's description and the not-stored line. */
  private afterRows(top: Overlay): HTMLElement[] {
    if (top.id !== "settings") return [];
    return [h("p", { class: "setting-desc soft" }), this.settingsStored ? null : h("p", { class: "soft" }, SETTINGS_NOT_STORED)].filter((x): x is HTMLElement => x !== null);
  }

  /** An off row under the highlight says why it is off in the status line too (usability pass U2). */
  private offReason(): string {
    const top = this.top();
    if (top === undefined) return "";
    if (top.id === "game") {
      const g = this.game;
      if (g === null || g.menu === null || this.ui === null || this.animating) return "";
      const r = menuRows(g.menu, this.menuData(), this.menuExtra(g))[this.highlight];
      return r === undefined || r.on ? "" : `${r.label}: ${r.reasonText ?? reasonText(r.reason)}.`;
    }
    const r = this.screenModel()?.rows[this.highlight];
    return r === undefined || r.on ? "" : `${r.label}: ${r.reason ?? "not available"}.`;
  }

  /** The state the HUD shows: the open request's state (the moment it is decided in) over the committed state. */
  private hudState(g: GameView): GameState | null {
    const s = g.state;
    const r = g.request?.state ?? null;
    if (s === null || r === null || g.committed === true) return s;
    return { ...s, ...r };
  }

  /** The two team swatches of the matchup on screen: never the same family or value (U4). */
  private swatches(m: Matchup): { readonly away: string; readonly home: string } {
    return matchupSwatches(m.away.index, m.home.index);
  }

  /**
   * The score bug (DESIGN.md Prime Time, HUD Score bug; usability pass U5): one fused unit, away then
   * home, each a name plate in its team's fill (name over timeout bars, the You tag) and a dark score
   * box (possession glyph, score), then the game segment (period and clock over the clock state) and
   * the down segment. Outside it: the Under 2:00 tag, the tempo tag, then the key hints that work now.
   * A change from the last build starts its motion (noteBug); the clock itself never animates.
   */
  private renderTopBar(): void {
    const bar = this.root.topBar;
    const g = this.game;
    if (g === null) {
      bar.replaceChildren(h("span", { class: "brand" }, "Clipboard Football"));
      return;
    }
    const inks = this.inks(g.matchup);
    const s = this.hudState(g);
    const now = performance.now();
    const still = this.reducedMotion();
    // During the play the rail holds Space, S and M when it fits; otherwise they show here.
    const railShown = playStage(this.layoutNow, this.settings.textSize / 100).rail !== null;
    const keys = this.animating
      ? h("span", { class: "bar-keys" }, ...(railShown ? [] : this.playKeys()))
      : this.top()?.id === "game"
        ? h("span", { class: "bar-keys" }, keyHint("Esc", "Menu"))
        : h("span", { class: "bar-keys" });
    const perHalf = this.ui?.rules.timeouts.perHalf ?? 3;
    // "1st & 10 at OPP 39": the down and distance in display caps, the spot under it.
    const sit = s === null ? "" : situationText(s, g.human);
    const at = sit.indexOf(" at ");
    const dd = at < 0 ? sit : sit.slice(0, at);
    const spot = at < 0 ? "" : sit.slice(at + 4);
    const ball = s !== null && s.phase !== "final" ? s.possession : null;
    this.noteBug({ seed: g.matchup.seed, score: { home: s?.score.home ?? 0, away: s?.score.away ?? 0 }, ball, dd, spot }, now, still);
    const plate = (t: Team): HTMLElement => {
      const ink = inks[t];
      const el = h("div", { class: darkTier(ink.fill) ? "cell plate dark" : "cell plate" });
      el.style.background = ink.fill;
      el.style.color = ink.ring;
      const left = s === null ? perHalf : s.timeouts[t];
      const pips = h("span", { class: "pips", "aria-label": `${left} timeouts left` });
      for (let i = 0; i < perHalf; i++) pips.append(h("span", { class: i < left ? "pip on" : "pip", "aria-hidden": "true" }));
      el.append(h("span", { class: "name" }, g.matchup[t].nickname), h("span", { class: "plate-sub" }, pips, t === g.human ? h("span", { class: "you" }, "You") : null));
      return el;
    };
    const scoreBox = (t: Team): HTMLElement => {
      const box = h("div", { class: "cell score-box" });
      const digits = h("span", { class: "score" }, h("span", { class: "score-now" }, String(s === null ? 0 : s.score[t])));
      // Odometer: the old number rolls up and out, the new one up into place, while the box takes
      // the scoring team's fill at 0.35 and lets it go.
      const f = still ? null : this.flights.get(`score-${t}`, DUR.fast * 5, now);
      if (f !== null) {
        digits.classList.add("odo");
        digits.append(h("span", { class: "score-old", "aria-hidden": "true" }, f.data["from"] ?? ""));
        const [r, gg, b] = rgbOf(inks[t].fill);
        box.style.setProperty("--flash", `rgba(${r}, ${gg}, ${b}, 0.35)`);
        resume(box, "flash", f.elapsed);
      }
      box.append(h("span", { class: "poss" }, ball === t ? h("span", { class: "dot", "aria-hidden": "true" }) : null), digits);
      if (ball === t) box.append(h("span", { class: "visually-hidden" }, "ball"));
      return box;
    };
    if (s === null) {
      // Before the opening toss is settled.
      bar.replaceChildren(h("div", { class: "bug" }, plate("away"), scoreBox("away"), plate("home"), scoreBox("home"), h("div", { class: "cell seg game" }, h("span", { class: "period" }, "Coin toss"))), keys);
      this.fitTopBar();
      return;
    }
    const clock = this.clockOverride ?? s.clock;
    const regulation = this.ui?.rules.game.regulationPeriods ?? 4;
    const lateHalf = s.phase !== "final" && clock <= 120 && (s.period % 2 === 0 || s.period > regulation);
    const game = h(
      "div",
      { class: "cell seg game" },
      h("span", { class: "game-line" }, h("span", { class: "period" }, s.phase === "final" ? "Final" : g.periodEnd != null ? `End ${periodText(g.periodEnd, regulation)}` : periodText(s.period, regulation)), h("span", { class: lateHalf ? "clock late" : "clock" }, clockText(clock))),
      s.phase === "final" ? null : h("span", { class: "clock-state" }, s.clockRunning ? "Running" : "Stopped"),
    );
    // Hidden at Final: the bug ends at the game segment.
    const down = s.phase === "final" ? null : this.downSegment(dd, spot, now, still);
    const late = lateHalf ? h("span", { class: "tag late-tag" }, "Under 2:00") : null;
    // moment.twoMinute: the clock turns signal over dur.base and the tag comes in from 8 px left.
    const tm = still || !lateHalf ? null : this.flights.get("twoMin", DUR.base, now);
    if (tm !== null) {
      const c = game.querySelector<HTMLElement>(".clock");
      if (c !== null) resume(c, "two-min", tm.elapsed);
      if (late !== null) resume(late, "two-min", tm.elapsed);
    }
    const tempo = g.request?.kind === "offenseCall" && g.request.tempo !== "normal" ? h("span", { class: "tag tempo" }, tempoText(g.request.tempo)) : null;
    bar.replaceChildren(...[h("div", { class: "bug" }, plate("away"), scoreBox("away"), plate("home"), scoreBox("home"), game, down), late, tempo, keys].filter((x): x is HTMLElement => x !== null));
    this.fitTopBar();
    // Possession change: the glyph slides from the other score box along the bug (measured once laid out).
    const pf = still || ball === null ? null : this.flights.get("poss", DUR.tick, now);
    if (pf !== null) {
      const slots = bar.querySelectorAll<HTMLElement>(".score-box .poss");
      const slot = (t: string | null | undefined): HTMLElement | undefined => slots[t === "away" ? 0 : 1];
      const to = slot(ball);
      const from = slot(pf.data["from"]);
      const dot = to?.querySelector<HTMLElement>(".dot") ?? null;
      if (dot !== null && to !== undefined && from !== undefined) {
        dot.style.setProperty("--poss-dx", `${Math.round(from.getBoundingClientRect().left - to.getBoundingClientRect().left)}px`);
        resume(dot, "slide", pf.elapsed);
      }
    }
  }

  /**
   * The bug's motion marks a change the engine made (DESIGN.md "How the bug moves"): a score, the
   * team with the ball, the down and distance or the spot. Compared with the last build of the same
   * game; reduced motion starts nothing (the new value shows at once).
   */
  private noteBug(v: BugShown, now: number, still: boolean): void {
    const last = this.bugShown;
    this.bugShown = v;
    if (last === null || last.seed !== v.seed || still) return;
    for (const t of ["away", "home"] as const) if (v.score[t] !== last.score[t]) this.flights.start(`score-${t}`, { from: String(last.score[t]) }, now);
    if (v.ball !== null && last.ball !== null && v.ball !== last.ball) this.flights.start("poss", { from: last.ball }, now);
    if (v.dd !== last.dd || v.spot !== last.spot) this.flights.start("down", { dd: last.dd, spot: last.spot }, now);
  }

  /**
   * hud.downDistance: "3RD & 4" over the spot. A change swaps it (the old text up and out over
   * dur.fast, the new up from 8 px below over dur.base); a new first down then fills it signal once.
   */
  private downSegment(dd: string, spot: string, now: number, still: boolean): HTMLElement {
    const seg = h("div", { class: "cell seg down" }, h("span", { class: "dd-now" }, h("span", { class: "bar-dd" }, dd), spot === "" ? null : h("span", { class: "bar-spot" }, spot)));
    const f = still ? null : this.flights.get("down", DUR.base, now);
    if (f !== null) {
      const oldSpot = f.data["spot"] ?? "";
      seg.append(h("span", { class: "dd-old", "aria-hidden": "true" }, h("span", { class: "bar-dd" }, f.data["dd"] ?? ""), oldSpot === "" ? null : h("span", { class: "bar-spot" }, oldSpot)));
      resume(seg, "swap", f.elapsed);
    }
    // One flash, never repeated. Reduced motion: the fill shows as a state for the same time.
    // 900 ms in all, from data/ui/motion.json moments.firstDown (the CSS animation reads it from the element).
    const flash = this.motion?.moments.firstDown.flashMs ?? BUG_MOTION.firstDownFlash;
    seg.style.setProperty("--first-down-flash", `${flash}ms`);
    const fd = this.flights.get("firstDown", still ? flash : DUR.base + flash, now);
    if (fd !== null) {
      if (!still) resume(seg, "first-down", fd.elapsed, "--fd-since");
      else {
        seg.classList.add("first-down-still");
        window.clearTimeout(this.barTimer);
        this.barTimer = window.setTimeout(() => this.renderTopBar(), Math.max(0, flash - fd.elapsed));
      }
    }
    return seg;
  }

  /** Space, S and M: the keys that work during the play (top bar or rail). */
  private playKeys(): HTMLElement[] {
    return [keyHint("Space", "Skip"), keyHint("S", "Speed", this.settings.speed), keyHint("M", "Player card")];
  }

  /**
   * The bar never clips a score, the clock or down and distance (U5): when it is wider than the
   * window it applies TOP_BAR_FIT_STEPS in order (ui/topbar.ts).
   */
  private fitTopBar(): void {
    const bar = this.root.topBar;
    bar.classList.remove(...TOP_BAR_FIT_STEPS);
    fitBar(
      () => bar.scrollWidth > bar.clientWidth,
      (c) => bar.classList.add(c),
    );
  }

  /**
   * The play rail (DESIGN.md Play screen, hud.playRail): read only, beside the field when it fits.
   * This play from the snap and the keys that work now, pinned to the bottom (no result card:
   * DESIGN.md Broadcast build review 5). Rebuilt only when its text or phase changes.
   */
  private renderRail(): void {
    const el = this.root.rail;
    const stage = playStage(this.layoutNow, this.settings.textSize / 100).rail;
    const r = this.railPlay;
    const show = this.animating && r !== null && stage !== null && uiMode(this.game) === "game" && !this.layoutNow.tooSmall;
    el.hidden = !show;
    if (!show || r === null || stage === null) {
      this.railKey = "";
      return;
    }
    el.style.left = `${stage.left}px`;
    el.style.top = `${stage.top}px`;
    el.style.width = `${stage.width}px`;
    el.style.height = `${stage.height}px`;
    const key = JSON.stringify([r.calls, r.phase]);
    const keys = h("div", { class: "rail-card rail-keys" }, ...this.playKeys());
    if (key === this.railKey) {
      el.querySelector(".rail-keys")?.replaceWith(keys);
      return;
    }
    this.railKey = key;
    const cards: HTMLElement[] = [];
    if (r.phase !== "pre") cards.push(h("section", { class: "rail-card rail-play", "aria-label": "This play" }, h("p", { class: "section-label" }, r.auto === true ? "This play (auto)" : "This play"), ...r.calls.map((c) => h("p", { class: "rail-calls" }, c))));
    el.replaceChildren(...cards, keys);
  }

  private rowButton(r: { key: string; label: string; on: boolean; reason?: string; note?: string; option?: string }, i: number, onClick: () => void): HTMLElement {
    const keyText = r.key === "Esc" ? "Esc" : r.key === "Space" ? "Space" : r.key === "Left" ? "←" : r.key === "Right" ? "→" : r.key;
    const b = h(
      "button",
      // U5: Earlier call's accessible name carries its key ("5, Earlier call: Under center, Inside run").
      { class: `row${r.on ? "" : " off"}${i === this.highlight ? " hl" : ""}`, type: "button", "data-i": String(i), "data-key": r.key, "aria-disabled": r.on ? undefined : "true", "aria-label": r.option === EARLIER_CALL ? `${r.key}, ${r.label}${r.on ? "" : ` (${r.reason ?? "not now"})`}` : undefined },
      h("span", { class: "key" }, keyText),
      h("span", { class: "label" }, r.label),
      r.note === undefined ? null : h("span", { class: "note" }, `(${r.note})`),
      r.on ? null : h("span", { class: "reason" }, `(${r.reason ?? "not now"})`),
    );
    const pr = this.pressed;
    if (pr !== null && r.on && pr.key === r.key && pr.screen === this.clickScreen()) {
      const elapsed = performance.now() - pr.at;
      if (elapsed < DUR.fast) resume(b, "pressed", elapsed);
      else this.pressed = null;
    }
    b.addEventListener("click", (e) => {
      if (clickPicks(e.detail)) onClick();
    });
    const hover = (): void => {
      this.highlight = i;
      this.markHighlight();
      this.renderStatus();
    };
    // On the main menu only a moving pointer takes the highlight: a row rebuilt under a resting
    // cursor gets mouseenter too, and that must not pull the highlight off Continue (decision 4).
    b.addEventListener("mouseenter", () => {
      if (this.top()?.id !== "title") hover();
    });
    b.addEventListener("pointermove", (e) => {
      if (this.top()?.id !== "title" || (e.movementX === 0 && e.movementY === 0)) return;
      if (!this.autoHighlight && this.highlight === i) return;
      this.autoHighlight = false;
      hover();
    });
    return b;
  }

  /** The .hl class on the highlighted row or card only (rows and cards share data-i); the highlight follows. */
  private markHighlight(): void {
    for (const x of this.container().querySelectorAll<HTMLElement>("button[data-i]")) x.classList.toggle("hl", x.dataset.i === String(this.highlight));
    this.placeHighlights();
  }

  /** Just before a rebuild: where the travelling highlight is drawn now, mid-slide included. */
  private captureHighlight(): void {
    const hl = this.container().querySelector<HTMLElement>(".rows.travel > .row-hl:not([hidden])");
    const group = hl?.parentElement ?? null;
    if (hl === null || group === null || this.hlShown === null) return;
    const a = hl.getBoundingClientRect();
    const b = group.getBoundingClientRect();
    if (a.height > 0) this.hlShown = { ...this.hlShown, top: a.top - b.top, height: a.height };
  }

  /**
   * Selection travel (DESIGN.md Rows): each menu's one highlight slides to the selected row over
   * dur.base. A rebuilt menu of the same screen slides on from where the last build left it; a new
   * screen starts on its row with no slide; reduced motion jumps. The selected row's weight and
   * gold key wait for the end of the slide (.sliding). Off rows show their own dashed outline.
   */
  private placeHighlights(): void {
    const screen = this.clickScreen();
    const still = this.reducedMotion();
    for (const group of this.container().querySelectorAll<HTMLElement>(".rows")) {
      const hl = group.querySelector<HTMLElement>(":scope > .row-hl");
      if (hl === null) continue;
      const row = group.querySelector<HTMLElement>(":scope > .row.hl");
      if (row === null || row.offsetHeight === 0) {
        group.classList.remove("travel");
        continue;
      }
      const label = group.getAttribute("aria-label") ?? "";
      const to = { top: row.offsetTop, height: row.offsetHeight };
      const placed = hl.dataset["top"] !== undefined;
      const last = this.hlShown;
      const from = placed ? { top: Number(hl.dataset["top"]), height: Number(hl.dataset["height"]) } : last !== null && last.screen === screen && last.label === label ? last : null;
      const moves = !still && from !== null && (Math.abs(from.top - to.top) > 0.5 || Math.abs(from.height - to.height) > 0.5);
      const put = (b: { top: number; height: number }): void => {
        hl.style.transform = `translateY(${b.top}px)`;
        hl.style.height = `${b.height}px`;
      };
      if (!placed) {
        hl.classList.add("no-anim");
        group.classList.add("travel");
        put(moves && from !== null ? from : to);
        void hl.offsetWidth;
        hl.classList.remove("no-anim");
      }
      put(to);
      hl.dataset["top"] = String(to.top);
      hl.dataset["height"] = String(to.height);
      hl.hidden = row.classList.contains("off");
      if (moves) {
        group.classList.add("sliding");
        window.clearTimeout(this.slideTimer);
        this.slideTimer = window.setTimeout(() => group.classList.remove("sliding"), DUR.base);
      }
      this.hlShown = { screen, label, ...to };
    }
  }

  /**
   * The row key under the pointer, or null off any row. Read at the point, not from the event
   * target: a touch keeps its pressed button as the target, so lifting over another row would pick
   * the first.
   */
  private rowKeyAt(e: PointerEvent): string | null {
    const at = document.elementFromPoint(e.clientX, e.clientY);
    const b = at !== null && this.container().contains(at) ? at.closest<HTMLElement>("button[data-key]") : null;
    return b?.dataset.key ?? null;
  }

  /** What a click must start and end on: the game menu screen (a new object per screen), else the top overlay. */
  private clickScreen(): unknown {
    const top = this.top();
    return top?.id === "game" ? (this.game?.menu ?? null) : top;
  }

  /**
   * A menu's rows, with its travelling highlight (placeHighlights). `menu`: the game menu these rows
   * show, so a pick or Back that just opened it plays the menu change entrance.
   */
  private rowsGroup(label: string, list: readonly { key: string; label: string; on: boolean; reason?: string; note?: string }[], menu: MenuState | null = null): HTMLElement {
    const group = h("div", { class: "rows", role: "group", "aria-label": label }, h("span", { class: "row-hl", "aria-hidden": "true" }));
    list.forEach((r, i) => {
      const b = this.rowButton(r, i, () => (this.animating ? undefined : this.pick(r.key)));
      b.style.setProperty("--row-i", String(i));
      group.append(b);
    });
    const e = this.menuEnter;
    if (menu !== null && e !== null && e.menu === menu) {
      const elapsed = performance.now() - e.at;
      if (elapsed < DUR.base + BUG_MOTION.rowStagger * (MAX_ROWS - 1)) resume(group, e.back ? "enter-back" : "enter", elapsed);
      else this.menuEnter = null;
    }
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
    // "FINAL, OT" when overtime was played (DESIGN.md Halftime and end of game).
    const ot = top.id === "end" && this.game?.state != null && this.game.state.period > (this.ui?.rules.game.regulationPeriods ?? 4);
    // The title, then the screen's content in one glass card (DESIGN.md Main menu, other screens).
    return [
      h("h1", {}, ot ? `${model.title}, OT` : model.title),
      h("section", { class: "glass" }, ...(model.lines ?? []).map((l) => h("p", { class: "soft mono seeds" }, l)), ...this.screenBody(top), this.rowsGroup(model.title, model.rows), ...this.afterRows(top), h("p", { class: "status", role: "status" })),
      this.footer(false),
    ];
  }

  private gamePanel(): HTMLElement[] {
    const g = this.game;
    if (g === null || this.ui === null) return [];
    const s = this.hudState(g);
    // U1: in state 2 the Last play card goes compact so the board takes the height it frees.
    const compact = this.compactCard(g);
    const playText = this.lastPlayCard(g, compact);
    // The situation plate, then the report, then the call (DESIGN.md Prime Time, Calling screen):
    // the down and distance and "You're on..." left the call card for the plate.
    const out: HTMLElement[] = [];
    if (g.menu !== null && g.request !== null && !this.animating) {
      const m = g.menu;
      const crumbs = breadcrumb(m, this.menuData());
      const req = g.request;
      // The card opens with the breadcrumb in type.label: the step name, then the earlier pick that
      // changes what the rows mean (U3), on one line.
      out.push(h("h2", { class: "section-label crumbs" }, crumbs === "" ? menuTitle(m) : `${menuTitle(m)}, ${crumbs}`));
      if (req.kind === "continue") out.push(h("p", { class: "lineup" }, continueText(req.about, this.textCtx(g))));
      // M2 G: what is in doubt, then what a challenge risks, from the rule set (design "Challenge prompt").
      if (req.kind === "challenge") out.push(h("p", { class: "lineup" }, `Close call: ${req.closeCall.question} ${req.challengesLeft} challenge${req.challengesLeft === 1 ? "" : "s"} left; ${req.failedCostsTimeout ? `a failed challenge costs a timeout (${req.timeoutsLeft} left)` : "a failed challenge costs nothing"}.`));
      const list = menuRows(m, this.menuData(), this.menuExtra(g)).map((r: Row) => (r.on ? r : { ...r, reason: r.reasonText ?? reasonText(r.reason) }));
      out.push(this.onCardScreen() && !this.compact() ? this.cardGrid(m, list) : this.rowsGroup(menuTitle(m), this.compact() ? this.withPersonnel(m, list) : list, m));
      if (current(m) === "offense.clock" && req.kind === "offenseCall") out.push(h("p", { class: "soft" }, `Clock ${req.clockRunning ? "running" : "stopped"}. Tempo: ${tempoText(req.tempo)} (resets each drive).`));
    }
    out.push(h("p", { class: "status", role: "status" }));
    // The left column: the Last play card, then the board when it fits (U1, placed by fitBoard).
    const left = h("div", { class: "call-left" }, h("section", { class: compact ? "ov-report glass compact" : "ov-report glass", "aria-label": "Last play" }, playText));
    return [this.situationPlate(g, s), left, h("section", { class: "ov-menu glass", "aria-label": "Your call" }, ...out), this.footer(true)];
  }

  /**
   * The Last play card (U2, approved by Joseph 2026-11-15; it brings back the calls and why lines
   * he had dropped that morning): the result line with names, the calls line, the why headline and
   * the D Details hint, the event lines, then "Before that:" with the auto-advanced plays (Q1).
   * Compact (U1 state 2): the label, the result's first sentence and the hint.
   */
  private lastPlayCard(g: GameView, compact: boolean): HTMLElement {
    const ev = g.lastPlay;
    const label = h("p", { class: "section-label" }, "Last play");
    const hint = h("p", { class: "key-hints" }, keyHint("D", "Details"));
    if (ev === null || g.cardResult === "") return h("div", { class: "report" }, label, h("p", { class: "result soft" }, "No plays yet."));
    const ctx = this.textCtx(g);
    // The label and the D hint share one line, so the compact card is the result's first sentence plus one line.
    if (compact) return h("div", { class: "report compact-card" }, h("div", { class: "compact-head" }, label, hint), h("p", { class: "result" }, resultHead(ev, ctx)));
    const before = g.before.length === 0 ? [] : [h("p", { class: "before-label" }, "Before that:"), ...g.before.map((b) => h("p", { class: "event before" }, playResultText(b, ctx))), h("p", { class: "key-hints" }, keyHint("L", "Game log"))];
    return h(
      "div",
      { class: "report" },
      label,
      h("p", { class: "result" }, g.cardResult),
      h("p", { class: "calls" }, g.calls),
      h("p", { class: "why-line" }, g.why ?? NO_EXPLANATION),
      hint,
      ...g.eventLines.map((l) => h("p", { class: "event" }, l)),
      ...before,
    );
  }

  /** U1 state 2: after the first input on a first screen, or on any screen past it (a call's screens only). */
  private callingState2(g: GameView): boolean {
    const req = g.request;
    if (g.menu === null || req === null || (req.kind !== "offenseCall" && req.kind !== "try" && req.kind !== "defenseCall")) return false;
    return !isFirstScreen(g.menu) || this.previewArmed;
  }

  /** The compact card only where the board then fits (else the full card alone, as before U1). */
  private compactCard(g: GameView): boolean {
    if (!this.callingState2(g) || this.animating || this.autoAdvancing) return false;
    const win = { width: window.innerWidth, height: window.innerHeight };
    const ts = this.settings.textSize / 100;
    return boardLayout(win, ts, Math.round(COMPACT_CARD_PX * ts), this.cardsRow ?? undefined) !== null;
  }

  /**
   * U1: shows the board under the Last play card when all four conditions hold, measured on the
   * built panel (the cards row from the plate to the legend, the card's own height). It never adds
   * height: the board takes only what the cards row leaves. Otherwise the left column is the card alone.
   */
  private fitBoard(): void {
    const panel = this.root.panel;
    const left = panel.querySelector<HTMLElement>(".call-left");
    const g = this.game;
    panel.style.gridTemplateColumns = "";
    const was = this.boardShown;
    this.boardShown = null;
    this.boardView = null;
    const win = { width: window.innerWidth, height: window.innerHeight };
    const ts = this.settings.textSize / 100;
    const possible = boardLayout(win, ts, 0, { top: 0, legendTop: Number.MAX_SAFE_INTEGER });
    if (left === null || g === null || g.state === null || this.animating || this.autoAdvancing || panel.hidden || !panel.classList.contains("wide") || !this.canvas2d || possible === null || this.templates === null) {
      this.board.remove();
      return;
    }
    panel.style.gridTemplateColumns = `${possible.boardW}px minmax(0, 1fr)`;
    const plate = panel.querySelector<HTMLElement>(".situation-plate");
    const report = left.querySelector<HTMLElement>(".ov-report");
    const foot = panel.querySelector<HTMLElement>(".panel-foot");
    if (plate === null || report === null || foot === null) {
      panel.style.gridTemplateColumns = "";
      this.board.remove();
      return;
    }
    const pr = panel.getBoundingClientRect();
    const row = { top: plate.getBoundingClientRect().bottom + BOARD.rowGap, legendTop: pr.bottom - foot.getBoundingClientRect().height };
    this.cardsRow = row;
    let lay = boardLayout(win, ts, report.getBoundingClientRect().height, row);
    // The compact card was chosen from the last measurement; with no room after all, the full card comes back.
    if (lay === null && report.querySelector(".compact-card") !== null) {
      report.classList.remove("compact");
      report.replaceChildren(this.lastPlayCard(g, false));
    }
    if (lay === null) {
      panel.style.gridTemplateColumns = "";
      this.board.remove();
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    if (this.board.width !== Math.round(lay.boardW * dpr) || this.board.height !== Math.round(lay.boardH * dpr)) {
      this.board.width = Math.round(lay.boardW * dpr);
      this.board.height = Math.round(lay.boardH * dpr);
    }
    this.board.style.width = `${lay.boardW}px`;
    this.board.style.height = `${lay.boardH}px`;
    if (this.board.parentElement !== left) left.append(this.board);
    // The compact switch crossfades in the left column only (dur.base; reduced motion: a cut).
    const compact = report.querySelector(".compact-card") !== null;
    if (was !== null && (this.boardCompact !== compact) && !this.reducedMotion()) restartAnimation(left, "swap-in");
    this.boardCompact = compact;
    lay = { ...lay };
    this.boardShown = lay;
    this.drawBoard();
  }

  /**
   * Calling spec K5: no call screen scrolls. When the call card runs past the legend's top, its card
   * art shrinks so it fits (`--card-art-max`); when even the smallest art doesn't, this screen shows
   * the text rows instead and the panel is built again (returns true: that render has done the rest).
   */
  private fitCallCard(): boolean {
    const panel = this.root.panel;
    const menu = panel.querySelector<HTMLElement>(".ov-menu");
    const foot = panel.querySelector<HTMLElement>(".panel-foot");
    const g = this.game;
    if (menu === null || foot === null || g === null || g.menu === null || panel.hidden || this.top()?.id !== "game") return false;
    const limit = (): number => panel.getBoundingClientRect().bottom - foot.getBoundingClientRect().height - BOARD.rowGap;
    const over = (): number => menu.getBoundingClientRect().bottom - limit();
    const cards = [...menu.querySelectorAll<HTMLElement>(".play-card")];
    // Text rows that still run past: the tight spacing (smaller padding, gaps and row height).
    if (cards.length === 0) {
      if (over() > 0.5) menu.classList.add("tight");
      return false;
    }
    // Rows by layout position: the highlighted card is lifted 2 px (a transform), which offsetTop ignores.
    const rows = new Set(cards.map((c) => c.offsetTop)).size;
    const art = menu.querySelector<HTMLElement>(".play-card-art svg")?.getBoundingClientRect().height ?? 0;
    const fit = callCardFit(over(), rows, art);
    if (fit === null) return false;
    if (fit !== "rows") {
      menu.style.setProperty("--card-art-max", `${fit}px`);
      if (callCardFit(over(), rows, menu.querySelector<HTMLElement>(".play-card-art svg")?.getBoundingClientRect().height ?? 0) === null) return false;
    }
    if (this.textRowsFor === g.menu) return false;
    this.textRowsFor = g.menu;
    this.render();
    return true;
  }

  /** Draws the frame the field shows now on the board, at the board's scale and camera (U1). */
  private drawBoard(): void {
    const lay = this.boardShown;
    const f = this.animator.shown();
    const g = this.game;
    const t = this.templates;
    if (lay === null || f === null || g === null || t === null || !this.board.isConnected) return;
    const c = this.board.getContext("2d");
    if (c === null) return;
    const dpr = window.devicePixelRatio || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, lay.boardW, lay.boardH);
    const view = boardViewOf(lay, f, g.framePossession === null || g.framePossession === g.human ? "O" : "X", t);
    this.boardView = view;
    drawField(c, view, f.scene, this.settings.textSize / 100);
    drawFrame(c, view, f.tl, f.t, withScene(this.frameOpts(), f.scene));
  }

  /**
   * The scale the calling previews are lined up at: the board's when it shows (U1: the board draws
   * them, and the line's spacing and the huddle are in pixels), else the field's.
   */
  private previewScale(): { readonly s: number; readonly markPx: number } {
    const b = this.boardShown;
    const f = this.templates?.field;
    if (b === null || f === undefined) return { s: this.layoutNow.s, markPx: this.layoutNow.markPx };
    return { s: b.sB, markPx: Math.max(f.markMinPx, f.markYards * b.sB) };
  }

  /** Both units lined up for a public call (U8, U1), still, on the field and the board. */
  private showPublic(g: GameView, seq: number, call: PublicCall): void {
    const t = this.templates;
    const ui = this.ui;
    const s = this.hudState(g) ?? g.state;
    if (t === null || s === null) return;
    const scale = this.previewScale();
    const key = JSON.stringify([seq, "public", call, scale.s]);
    if (key === this.previewKey) return;
    this.previewKey = key;
    const counts = ui === null ? undefined : { offense: ui.personnel.offense["underCenter"] ?? {}, defense: ui.personnel.packages["base"] ?? {} };
    // An extra point lines up at the try's kick spot, as its timeline does (R2); the state's spot is the two-point spot.
    const los = call === "extraPoint" ? (g.state?.trySpots?.kick ?? s.spot) : s.spot;
    const frame = publicLineupFrame({ los, humanKicks: s.possession === g.human, templates: t, pxPerYard: scale.s, call, ...(counts === undefined ? {} : { counts }) });
    this.previewFrame = frame;
    this.animator.still(frame, this.sceneFor(s.possession, los, null), 0);
  }

  /** Hovering a mark on the board opens his player card, as on the field; huddle marks are skipped. */
  private onBoardHover(e: MouseEvent): void {
    const v = this.boardView;
    const f = this.animator.shown();
    if (v === null || f === null) return;
    const rect = this.board.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = markPositions(v, f.tl, f.t).find((m) => Math.hypot(m.x - x, m.y - y) <= v.markPx / 2 + 4);
    if (hit === undefined) {
      // Only a card hovering opened closes when the mouse leaves the marks; one opened with M stays (N4).
      if (this.markCard !== null && this.markCardHovered) this.closeMarkCard();
      return;
    }
    if (hit.id !== this.markCard) {
      this.openMarkCard(hit.id);
      this.markCardHovered = true;
    }
  }

  /** The marks inside the board's edges (M cycles these when the board shows). */
  private boardMarks(): string[] | null {
    const v = this.boardView;
    const f = this.animator.shown();
    if (this.boardShown === null || v === null || f === null) return null;
    return markPositions(v, f.tl, f.t)
      .filter((m) => m.x >= 0 && m.x <= v.width && m.y >= 0 && m.y <= v.height)
      .map((m) => m.id);
  }

  /** Q3: on the calling screen the player card opens over the call column, under the plate, down to the legend; the covered rows are inert. */
  private placeCallingCard(): void {
    const menu = this.root.panel.querySelector<HTMLElement>(".ov-menu");
    const open = this.markCard !== null && !this.animating && this.stack[0]?.id === "game" && this.top()?.id === "game";
    if (menu !== null) menu.inert = open;
    if (!open || menu === null || this.root.panel.hidden) return;
    const foot = this.root.panel.querySelector<HTMLElement>(".panel-foot");
    const pr = this.root.panel.getBoundingClientRect();
    const legendTop = foot === null ? pr.bottom : pr.bottom - foot.getBoundingClientRect().height;
    const r = menu.getBoundingClientRect();
    const box = callingCardBox({ left: r.left, top: r.top, width: r.width }, legendTop, window.innerHeight);
    this.position(this.root.markCard, box.left, box.width, box.top, box.maxHeight, "top");
  }

  /**
   * The situation plate (DESIGN.md hud.situation): the team edge, the down block on the team tint,
   * the spot with "You're on...", and the drive tracker. Read only: nothing in it is a choice.
   */
  private situationPlate(g: GameView, s: GameState | null): HTMLElement {
    const plate = h("section", { class: "situation-plate glass", "aria-label": "Situation" });
    if (s === null) {
      plate.append(h("div", { class: "sit-down" }, h("span", { class: "sit-dd" }, "Coin toss")));
      return plate;
    }
    const now = performance.now();
    const still = this.reducedMotion();
    const inks = this.inks(g.matchup);
    const ink = inks[s.possession];
    const [r, gg, b] = rgbOf(ink.fill);
    const edge = h("span", { class: darkTier(ink.fill) ? "sit-edge dark" : "sit-edge", "aria-hidden": "true" });
    edge.style.background = ink.fill;
    // The same string the bug's down segment shows.
    const sit = situationText(s, g.human);
    const at = sit.indexOf(" at ");
    const dd = at < 0 ? sit : sit.slice(0, at);
    const down = h("div", { class: "sit-down" }, h("span", { class: "sit-dd" }, dd));
    down.style.background = `linear-gradient(90deg, rgba(${r}, ${gg}, ${b}, 0.14) 0%, transparent 70%)`;
    const swap = still ? null : this.flights.get("down", DUR.base, now);
    if (swap !== null && swap.data["dd"] !== undefined && swap.data["dd"] !== dd) {
      down.append(h("span", { class: "sit-dd-old", "aria-hidden": "true" }, swap.data["dd"]));
      resume(down, "swap", swap.elapsed);
    }
    const onField = s.phase === "scrimmage" || s.phase === "kickoff" || s.phase === "try";
    const side = sideText(s, g.human);
    plate.append(edge, down);
    if (onField)
      plate.append(
        h("span", { class: "sit-divider", "aria-hidden": "true" }),
        h("div", { class: "sit-spot" }, h("span", { class: "sit-yard" }, yardLineText(s.spot, s.possession, g.human)), side === "" ? null : h("span", { class: "sit-side" }, side)),
        g.periodEnd != null ? this.lineScorePlate(g, now, still) : this.driveTracker(g, s, now, still),
      );
    return plate;
  }

  /**
   * The drive tracker (DESIGN.md hud.driveTracker): a mini field on its side, the team with the ball
   * attacking right. The ball, both lines and the drive band slide from their last spots after a
   * play; a change of possession redraws it with a fade. The drive line comes from the worker's
   * drive count (the box score's), and is hidden when there is none or no play yet.
   */
  private driveTracker(g: GameView, s: GameState, now: number, still: boolean): HTMLElement {
    const inks = this.inks(g.matchup);
    const own = inks[s.possession];
    const opp = inks[other(s.possession)];
    const los = s.spot;
    const fd = s.phase === "scrimmage" && !s.goalToGo ? Math.min(100, s.spot + s.distance) : null;
    const drive = s.phase === "scrimmage" && g.drive !== null && g.drive.team === s.possession ? g.drive : null;
    const band: readonly [number, number] | null = drive === null ? null : [Math.min(drive.start, los), Math.abs(los - drive.start)];
    const last = this.trackerShown;
    const ms = Math.max(DUR.tick, DUR.base);
    if (last !== null && last.seed === g.matchup.seed && !still) {
      // One play is one slide from its pre-play spots: a step builds the plate more than once (the
      // play's render, then the step's with its drive), so a change inside a slide already running
      // keeps that slide's start and its "from" (the end is always the spot drawn now).
      const running = this.flights.get("tracker", ms, now);
      if (last.possession !== s.possession) this.flights.start("tracker", { mode: "fade" }, now);
      else if (running === null && (last.los !== los || last.fd !== fd || last.band?.[0] !== band?.[0] || last.band?.[1] !== band?.[1]))
        this.flights.start("tracker", { mode: "slide", los: String(last.los), fd: last.fd === null ? "" : String(last.fd), bandLeft: last.band === null ? "" : String(last.band[0]), bandWidth: last.band === null ? "" : String(last.band[1]) }, now);
    }
    this.trackerShown = { seed: g.matchup.seed, possession: s.possession, los, fd, band };
    const f = still ? null : this.flights.get("tracker", ms, now);
    const pct = (n: number): string => `${n}%`;
    const tk = h("div", { class: "tracker", "aria-hidden": "true" });
    const at = (cls: string, yards: number, fromYards?: string): HTMLElement => {
      const el = h("span", { class: cls });
      el.style.left = pct(trackerX(yards));
      if (f?.data["mode"] === "slide" && fromYards !== undefined && fromYards !== "" && Number(fromYards) !== yards) {
        el.classList.add("from");
        el.style.setProperty("--from-left", pct(trackerX(Number(fromYards))));
      }
      return el;
    };
    const ezLeft = h("span", { class: "tk-ez left" });
    ezLeft.style.left = "0";
    ezLeft.style.background = own.endZone;
    const ezRight = h("span", { class: "tk-ez right" });
    ezRight.style.background = opp.endZone;
    tk.append(ezLeft, ezRight);
    for (let y = 0; y <= 100; y += 10) tk.append(at(y === 50 ? "tk-yl mid" : "tk-yl", y));
    if (band !== null) {
      const el = at("tk-band", band[0]);
      el.style.width = pct((band[1] / 120) * 100);
      const [r, gg, b] = rgbOf(own.fill);
      el.style.background = `rgba(${r}, ${gg}, ${b}, 0.4)`;
      const fromW = f?.data["bandWidth"];
      if (f?.data["mode"] === "slide" && fromW !== undefined && fromW !== "") {
        el.classList.add("from");
        el.style.setProperty("--from-left", pct(trackerX(Number(f.data["bandLeft"]))));
        el.style.setProperty("--from-width", pct((Number(fromW) / 120) * 100));
      }
      tk.append(el);
    }
    if (fd !== null) tk.append(at("tk-fd", fd, f?.data["fd"]));
    tk.append(at("tk-los", los, f?.data["los"]), at("tk-ball", los, f?.data["los"]));
    if (f !== null) resume(tk, f.data["mode"] === "fade" ? "fade" : "slide", f.elapsed);
    const plays = drive?.plays ?? 0;
    const yards = drive === null ? 0 : los - drive.start;
    const line = drive === null || plays === 0 ? null : h("p", { class: "drive-line" }, `Drive: ${plays} play${plays === 1 ? "" : "s"}, ${yards} yd${Math.abs(yards) === 1 ? "" : "s"}`);
    return h("div", { class: "tracker-wrap" }, tk, line);
  }

  /**
   * hud.lineScore in the plate (moment.periodEnd): after the 1st and 3rd quarters, in place of the
   * drive tracker until the next snap, wiping in over dur.wipe. Points by quarter from the
   * committed play events, then the total; display 700 tabular, quarters chalkSoft, totals chalk.
   */
  private lineScorePlate(g: GameView, now: number, still: boolean): HTMLElement {
    const regulation = this.ui?.rules.game.regulationPeriods ?? 4;
    const box = lineScore(g.events, regulation);
    const sw = this.swatches(g.matchup);
    const row = (t: Team): HTMLElement =>
      h(
        "tr",
        {},
        h("th", { scope: "row" }, swatch(sw[t]), ` ${g.matchup[t].nickname}`),
        ...box[t].map((n, i) => h("td", { class: "ls-q" }, i < (g.periodEnd ?? 0) ? String(n) : "")),
        h("td", { class: "ls-total" }, String(g.state?.score[t] ?? 0)),
      );
    const head = h("tr", {}, h("th", {}, ""), ...box.home.map((_, i) => h("th", { scope: "col" }, periodText(i + 1, regulation))), h("th", { scope: "col" }, "T"));
    const table = h("table", { class: "line-score", "aria-label": "Score by quarter" }, head, row("away"), row("home"));
    const wrap = h("div", { class: "line-score-wrap" }, table);
    const f = still ? null : this.flights.get("lineScore", DUR.wipe, now);
    if (f !== null) resume(wrap, "wipe-in", f.elapsed);
    return wrap;
  }

  /** The tracker takes the rest of the plate's width, at least 280 px; under that it hides and the plate keeps down and spot. */
  private fitTracker(): void {
    const w = this.root.panel.querySelector<HTMLElement>(".tracker-wrap");
    if (w !== null && w.clientWidth < 280) w.hidden = true;
  }

  /**
   * The panel footer (usability pass U9): the keys you can use, and on game screens what the mark
   * labels are (U7). Visible text, not choices: no buttons, so the seven-choice count is unchanged.
   */
  private footer(game: boolean): HTMLElement {
    const chip = (key: string, label: string): HTMLElement => keyHint(key, label);
    const keys = game
      ? [chip("Arrows", "Move"), chip("Enter", "Pick"), chip("D", "Details"), chip("L", "Log"), chip("M", "Player cards")]
      : this.top()?.id === "title"
        ? [chip("Arrows", "Move"), chip("Enter", "Pick")]
        : [chip("Esc", "Back"), chip("Enter", "Pick")];
    const legend = game || this.top()?.id === "settings" ? h("p", { class: "legend" }, LABEL_LEGEND[this.settings.labelContent]) : null;
    return h("footer", { class: "panel-foot" }, h("p", { class: "keys-line" }, ...keys), legend);
  }

  private screenBody(top: Overlay): HTMLElement[] {
    switch (top.id) {
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
              ["Arrows", "On play cards, move across and down the grid"],
              ["M", "Player card for each mark in turn; Esc or Enter closes it"],
              ["L", "Game log (drives and plays); L or Esc closes it"],
              ["Space", "Continue a dead ball"],
            ].map(([k, v]) => h("tr", {}, h("th", { class: "mono" }, k as string), h("td", {}, v as string))),
          ),
        ];
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

  /** pregame.faceoff (DESIGN.md Prime Time): the face-off band, then the tale of the tape by unit. */
  private pregameBody(): HTMLElement[] {
    const m = this.matchup;
    if (m === null) return [h("p", { class: "soft" }, "Drawing a matchup...")];
    const teams = this.faceoffTeams(m);
    const rows = UNITS.map((u) => ({ label: u, away: this.unitAverage(m.away.pool, u), home: this.unitAverage(m.home.pool, u) }));
    return [faceoffBand(teams, { you: this.human }), taleOfTape(rows, { away: teams.away.fill, home: teams.home.fill })];
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
      h("div", { class: "card" }, teamHead(this.teamInkOf(team), h("span", { class: "mono num" }, `#${p.number}`), h("span", { class: "name" }, p.name), h("span", { class: "pos" }, p.position), h("span", { class: "team-word" }, team.nickname)), h("p", { class: "soft" }, `Compared with other ${plural}${ranks === undefined ? " (loading)" : ""}`), ...bars),
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
    const out: HTMLElement[] = this.scoreHero(g, "halftime");
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
    if (scored.length === 0) return h("p", { class: "soft" }, "No player stats yet.");
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
      ...this.scoreHero(g, "end"),
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
    const sw = this.swatches(t);
    const teams = h("p", {}, swatch(sw.away), ` ${t.away.name} at `, swatch(sw.home), ` ${t.home.name}`);
    if (this.box === null) return [teams, h("p", { class: "soft" }, "Loading...")];
    const { box, players } = this.box;
    const reg = this.ui?.rules.game.regulationPeriods ?? 4;
    const byQ = h(
      "table",
      { class: "box" },
      h("tr", {}, h("th", {}, ""), ...Array.from({ length: box.periods }, (_, i) => h("th", {}, periodText(i + 1, reg))), h("th", {}, "Final")),
      ...(["away", "home"] as const).map((side) => h("tr", {}, h("th", {}, swatch(sw[side]), ` ${t[side].nickname}`), ...box[side].byPeriod.map((x) => h("td", { class: "mono" }, String(x))), h("td", { class: "mono" }, String(g.state?.score[side] ?? 0)))),
    );
    const out: HTMLElement[] = [teams, byQ];
    if (!g.events.some((e) => e.t === "play")) return [...out, h("p", { class: "soft" }, "No plays yet.")];
    const dash = (v: number | undefined): string => (v === undefined ? "-" : String(v));
    const table = (head: readonly string[], rows: readonly (readonly string[])[]): HTMLElement =>
      rows.length === 0 ? h("p", { class: "soft" }, "No player stats yet.") : h("table", { class: "box" }, h("tr", {}, ...head.map((c) => h("th", {}, c))), ...rows.map((r) => h("tr", {}, ...r.map((c, i) => h(i === 0 ? "th" : "td", { class: i === 0 ? "" : "mono" }, c)))));
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
            ],
          ),
        );
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
      case "Game log":
        out.push(...this.gameLogBody(g));
        break;
    }
    return out;
  }

  /**
   * Last play details in plain words (U3): the why headline once, the trace in four groups (each an
   * h3 and a list; an empty group is left out), the note on edges, the seed. detail.why, the cell key
   * and the raw multipliers stay in Copy details only.
   */
  private detailsBody(): HTMLElement[] {
    const g = this.game;
    const ev = g?.lastPlay ?? null;
    if (g === null || ev === null) return [h("p", { class: "soft" }, "No plays yet.")];
    const sheet = detailSheet(ev, this.textCtx(g));
    const out: HTMLElement[] = [h("p", { class: "why" }, sheet.headline)];
    if ((readDetail(ev.play).trace ?? []).length === 0) out.push(h("p", { class: "soft" }, NO_FACTORS));
    for (const grp of sheet.groups) out.push(h("section", { class: "detail-group", "aria-label": grp.title }, h("h3", {}, grp.title), h("ul", { class: "trace" }, ...grp.lines.map((l) => h("li", {}, l)))));
    out.push(h("p", { class: "note soft" }, EDGES_NOTE));
    out.push(h("p", { class: "soft mono" }, `Seed ${g.matchup.seed}, play ${g.state?.playCount ?? 0}.`));
    return out;
  }

  /**
   * Q2: the game log tab: every play and loop event, newest first, under a header where each of the
   * box score's drives starts. Headers come from driveSpans, pinned to boxScore; when its count
   * disagrees with the box score's drives the log shows no headers (one warning), never a wrong one.
   */
  private gameLogBody(g: GameView): HTMLElement[] {
    const ui = this.ui;
    if (ui === null) return [];
    const ctx = this.textCtx(g);
    const reg = ui.rules.game.regulationPeriods;
    if (!g.events.some((e) => e.t === "play")) return [h("p", { class: "soft" }, "No plays yet.")];
    // S2: a box built over fewer events (or another game) is stale: the drive totals load again.
    const b = this.box;
    const current = b !== null && (b.seed === undefined || b.seed === g.matchup.seed) && (b.events === undefined || b.events === g.events.length);
    // (Opening the box score asks for a fresh one; until it arrives the headers say their totals are loading.)
    const box = current ? (b?.box ?? null) : null;
    // Built once per new event or box (S1): a render in between keeps the same list, its focus and scroll.
    const key = JSON.stringify([g.matchup.seed, g.events.length, box === null ? -1 : box.drives.length, g.drive?.plays ?? null, g.state?.phase ?? null]);
    if (this.logCache?.key === key) return [this.logCache.el];
    let spans: DriveSpan[] | null = driveSpans(g.events, { scoring: ui.rules.scoring, regulationPeriods: reg, periodsPerHalf: ui.rules.game.periodsPerHalf });
    if (box !== null && spans.length !== box.drives.length) {
      if (!this.warned.has(`log:${g.matchup.seed}:${g.events.length}`)) {
        this.warned.add(`log:${g.matchup.seed}:${g.events.length}`);
        console.warn(`Game log: ${spans.length} drives in the log, ${box.drives.length} in the box score (seed ${g.matchup.seed}). Drive headers left out.`);
      }
      spans = null;
    }
    const rows = logRows(g.events, spans, (e) => e.t !== "play" && e.t !== "runoff" && eventLine(e, ctx) !== null);
    const sw = this.swatches(g.matchup);
    const res: Record<string, string> = { touchdown: "Touchdown", fieldGoal: "Field goal", missedFieldGoal: "Missed field goal", punt: "Punt", turnover: "Turnover", downs: "Turnover on downs", endOfHalf: "End of half", safety: "Safety" };
    const list = h("div", { class: "game-log", tabindex: "0", role: "region", "aria-label": "Game log, newest first" });
    let group: HTMLElement = list;
    for (const r of rows) {
      if (r.t === "drive") {
        const span = (spans as DriveSpan[])[r.drive] as DriveSpan;
        const start = g.events[span.start] as PlayEvent;
        const where = yardLineText(start.before.spot, span.team, g.human);
        const d = box?.drives[r.drive];
        const inProgress = span.open && g.state?.phase !== "final";
        const plays = g.drive !== null && inProgress ? g.drive.plays : d?.plays;
        const line =
          d === undefined && !inProgress
            ? `drive, started ${where}. Loading drive totals...`
            : inProgress
              ? `drive in progress, started ${where}: ${plays ?? 0} play${plays === 1 ? "" : "s"}, ${(g.state?.possession === span.team ? (g.state?.spot ?? start.before.spot) : start.before.spot) - start.before.spot} yds.`
              : `drive, started ${where}: ${d?.plays ?? 0} play${d?.plays === 1 ? "" : "s"}, ${d?.yards ?? 0} yds, ${clockText(d?.seconds ?? 0)}. ${res[d?.result ?? ""] ?? d?.result ?? ""}.`;
        group = h("section", { class: "log-drive", role: "group", "aria-label": `${g.matchup[span.team].nickname} ${line}` }, h("p", { class: "log-head" }, swatch(sw[span.team]), ` ${g.matchup[span.team].nickname} ${line}`));
        list.append(group);
        continue;
      }
      const e = g.events[r.index] as GameEvent;
      // A row outside every drive (a kickoff, a try, an event between drives) sits outside the drive groups.
      if (!this.inDrive(spans, r.index)) group = list;
      if (r.t === "event") {
        group.append(h("p", { class: "log-event" }, eventLine(e, ctx) ?? ""));
        continue;
      }
      const ev = e as PlayEvent;
      const sit = `${situationText(ev.before, g.human)}, ${periodText(ev.before.period, reg)} ${clockText(ev.before.clock)}`;
      group.append(h("div", { class: "log-play" }, h("p", { class: "section-label" }, sit), h("p", { class: "result" }, playResultText(ev, ctx)), h("p", { class: "calls" }, callsLine(ev, ctx)), h("p", { class: "note" }, whyHeadline(ev.play, ev.standout) ?? NO_EXPLANATION)));
    }
    this.logCache = { key, el: list };
    return [list];
  }

  private inDrive(spans: readonly DriveSpan[] | null, i: number): boolean {
    return spans !== null && spans.some((s) => inSpan(s, i));
  }
}

/** A player card's header band: the team fill with its outline color for text, or plain without a team. */
function teamHead(ink: TeamInk | null, ...children: HTMLElement[]): HTMLElement {
  const el = h("div", { class: ink === null ? "card-head" : "card-head team-band" }, ...children);
  if (ink !== null) {
    el.style.background = ink.fill;
    el.style.color = ink.ring;
  }
  return el;
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
