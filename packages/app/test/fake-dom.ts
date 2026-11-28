// A tiny fake DOM for running the App's own render methods in node (the repo has no jsdom), after
// prime-time-chunk1.spec.test.ts: elements with attributes, classes, children, text, style and a
// box that a test can set. Only what the calling screen pass's methods touch.

import { App } from "../src/ui/app";
import { catalogLabels } from "../src/ui/text";
import { uiDataOf } from "../src/engine/session";
import { parseMotion, parseTemplates } from "../src/ui/templates";
import { DEFAULT_SETTINGS, type Settings } from "../src/ui/storage";
import { layoutFor } from "../src/ui/layout";
import type { Matchup } from "../src/engine/protocol";
import type { GameEvent, Team } from "../src/engine/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepared } from "./support";

export class FakeText {
  constructor(readonly data: string) {}
  get textContent(): string {
    return this.data;
  }
}
type FakeNode = FakeEl | FakeText;

export class FakeEl {
  readonly attrs = new Map<string, string>();
  children: FakeNode[] = [];
  parentElement: FakeEl | null = null;
  hidden = false;
  inert = false;
  focused = false;
  rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  readonly style: Record<string, string> & { setProperty(k: string, v: string): void };
  constructor(readonly tagName: string) {
    const st: Record<string, string> = {};
    this.style = Object.assign(st, { setProperty: (k: string, v: string): void => void (st[k] = v) }) as FakeEl["style"];
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
  set className(v: string) {
    this.attrs.set("class", v);
  }
  readonly classList = {
    add: (...cs: string[]): void => void this.attrs.set("class", [...new Set([...this.classes, ...cs])].join(" ")),
    remove: (...cs: string[]): void => void this.attrs.set("class", this.classes.filter((c) => !cs.includes(c)).join(" ")),
    contains: (c: string): boolean => this.classes.includes(c),
    toggle: (c: string, on?: boolean): boolean => {
      const want = on ?? !this.classes.includes(c);
      if (want) this.classList.add(c);
      else this.classList.remove(c);
      return want;
    },
  };
  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) {
      const node = typeof n === "string" ? new FakeText(n) : n;
      if (node instanceof FakeEl) node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeNode[]): void {
    this.children = [];
    this.append(...nodes);
  }
  remove(): void {
    if (this.parentElement !== null) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  get isConnected(): boolean {
    return this.parentElement !== null;
  }
  contains(n: unknown): boolean {
    return n === this || this.all().includes(n as FakeEl);
  }
  addEventListener(): void {}
  focus(): void {
    this.focused = true;
  }
  getContext(): null {
    return null;
  }
  get textContent(): string {
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.children = [new FakeText(v)];
  }
  get elements(): FakeEl[] {
    return this.children.filter((c): c is FakeEl => c instanceof FakeEl);
  }
  getBoundingClientRect(): FakeEl["rect"] {
    return this.rect;
  }
  all(): FakeEl[] {
    return this.elements.flatMap((e) => [e, ...e.all()]);
  }
  /** Class compounds only (".a .b.c"), or a tag name. */
  querySelectorAll(sel: string): FakeEl[] {
    const parts = sel.trim().split(/\s+/);
    const matches = (e: FakeEl, p: string): boolean => (p.startsWith(".") ? p.split(".").filter((x) => x !== "").every((c) => e.classes.includes(c)) : e.tagName === p);
    let set: FakeEl[] = [this];
    for (const p of parts) set = [...new Set(set.flatMap((e) => e.all().filter((d) => matches(d, p))))];
    return set;
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  has(cls: string): boolean {
    return this.classes.includes(cls);
  }
}

/** Installs the fake document and window (call in beforeAll). */
export function installFakeDom(width = 1280, height = 720): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g["document"] = { createElement: (t: string) => new FakeEl(t), createTextNode: (s: string) => new FakeText(s), activeElement: null };
  g["window"] = { setTimeout: () => 0, clearTimeout: () => undefined, innerWidth: width, innerHeight: height, devicePixelRatio: 1 };
  g["HTMLElement"] = FakeEl;
  g["requestAnimationFrame"] = () => 0;
  g["cancelAnimationFrame"] = () => undefined;
}

const root = join(import.meta.dirname, "../../..");
const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));
export const TEMPLATES = parseTemplates(read("data/ui/templates.json"));
export const MOTION = parseMotion(read("data/ui/motion.json"));

/** The App's labels as onWorker("ready") builds them. */
export function appLabels(): Record<string, string> {
  const ui = uiDataOf(prepared(), read("data/ui/templates.json"), read("data/ui/motion.json"));
  const labels: Record<string, string> = { ...ui.labels, ...catalogLabels(ui.catalog) };
  for (const s of ui.catalog.screens) if (s.id === "offense.pass") for (const c of s.choices) labels[c.id] = `${c.label} pass`;
  return labels;
}

export interface AppHarness {
  readonly app: Record<string, unknown> & App;
  readonly game: Record<string, unknown>;
  readonly panel: FakeEl;
  readonly markCard: FakeEl;
  call<T>(name: string, ...args: unknown[]): T;
}

/** An App made with Object.create (no constructor, no worker), with a game view over `events`. */
export function appHarness(o: { matchup: Matchup; human: Team; events?: GameEvent[]; settings?: Partial<Settings> }): AppHarness {
  const ui = uiDataOf(prepared(), read("data/ui/templates.json"), read("data/ui/motion.json"));
  const panel = new FakeEl("div");
  const markCard = new FakeEl("aside");
  const game: Record<string, unknown> = {
    matchup: o.matchup,
    human: o.human,
    state: null,
    request: null,
    menu: null,
    events: o.events ?? [],
    lastPlay: null,
    result: "",
    cardResult: "",
    before: [],
    autoChain: [],
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
  const app = Object.create(App.prototype) as Record<string, unknown> & App;
  Object.assign(app, {
    root: { panel, markCard, topBar: new FakeEl("header"), live: new FakeEl("div"), main: new FakeEl("main"), canvas: new FakeEl("canvas"), rail: new FakeEl("div"), menu: new FakeEl("div"), small: new FakeEl("div") },
    game,
    ui,
    templates: TEMPLATES,
    motion: MOTION,
    labels: appLabels(),
    stack: [{ id: "game" }],
    settings: { ...DEFAULT_SETTINGS, reducedMotion: "on", ...o.settings },
    reducedQuery: { matches: true },
    layoutNow: layoutFor(1280, 720, TEMPLATES.field),
    animating: false,
    autoAdvancing: false,
    autoPlay: false,
    markCard: null,
    previewArmed: false,
    highlight: 0,
    warned: new Set<string>(),
    box: null,
    logCache: null,
    status: "",
    fatal: null,
    loading: null,
    boardShown: null,
    boardView: null,
    cardsRow: null,
    focusLog: false,
  });
  return { app, game, panel, markCard, call: <T>(name: string, ...args: unknown[]): T => (app[name] as (...a: unknown[]) => T).apply(app, args) };
}
