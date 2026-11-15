// data/ui/templates.json: the designed diagram (alignments, routes, drops) and the animation's
// timing. Checked by hand here (the app has no zod dependency); a bad file fails loading with
// the file named, as the data-failed-validation state says.

export type Pair = readonly [number, number];
export type Alignment = Readonly<Record<string, Pair>>;
export type Waypoints = Readonly<Record<string, readonly Pair[]>>;

export interface Timing {
  readonly runoffMaxMs: number;
  readonly setMs: number;
  readonly liveMinMs: number;
  readonly liveMaxMs: number;
  readonly liveSecondsMin: number;
  readonly liveSecondsMax: number;
  readonly holdMs: number;
  readonly scoreHoldMs: number;
  readonly crossfadeMs: number;
  readonly routeAlpha: number;
}

export interface Templates {
  readonly version: number;
  readonly timing: Timing;
  readonly field: { readonly markYards: number; readonly markMinPx: number; readonly losFromTop: number; readonly panEdgeYards: number; readonly clearOfBallYards: number; readonly linemanClearYards: number };
  readonly offense: Readonly<Record<string, Alignment>>;
  readonly kick: Readonly<Record<string, Alignment>>;
  readonly defense: Readonly<Record<string, Alignment>>;
  readonly returnUnits: Readonly<Record<string, Alignment>>;
  readonly routes: Readonly<Record<string, Waypoints>>;
  readonly drops: Readonly<Record<string, Waypoints>>;
  readonly presetDrops: Readonly<Record<string, string>>;
  readonly passDepth: Readonly<Record<string, number>>;
  /** OL and DL movement by play family: they stop at contact (path.block), whatever the call. */
  readonly lineContact: Readonly<Record<"run" | "pass" | "kick", Waypoints>>;
  /** DESIGN.md Spacing: line marks at least minPx apart, spread out from the center; maxDepth picks the line. */
  readonly lineSpacing: { readonly minPx: number; readonly maxDepth: number };
  /** Per-preset overrides of the package alignment (two-high, single-high, no deep safety). */
  readonly presetAlignment: Readonly<Record<string, Alignment>>;
  /** Per preset and slot: the zone [x0, depth0, x1, depth1, "deep" | "under"] a zone defender drops to. */
  readonly zones: Readonly<Record<string, Readonly<Record<string, Zone>>>>;
  /** Per preset and slot: the generic receiver spot [x, depth] a man defender mirrors. */
  readonly manTargets: Readonly<Record<string, Alignment>>;
  /** Per pass play: the class's throw depth band [from, to] past the line (MENUS.md). */
  readonly depthBands: Readonly<Record<string, Pair>>;
  /** The rating each position is judged on, for the rating label beside a mark's number. */
  readonly keyRating: Readonly<Record<string, string>>;
}

export type Zone = readonly [number, number, number, number, "deep" | "under"];

export class TemplateError extends Error {
  constructor(message: string) {
    super(`data/ui/templates.json: ${message}`);
    this.name = "TemplateError";
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(isNum);

function numbers(v: unknown, path: string, keys: readonly string[]): void {
  if (!isObj(v)) throw new TemplateError(`${path} must be an object`);
  for (const k of keys) if (!isNum(v[k])) throw new TemplateError(`${path}.${k} must be a number`);
}

function groupOf(v: unknown, path: string, leaf: (x: unknown) => boolean): void {
  if (!isObj(v)) throw new TemplateError(`${path} must be an object`);
  for (const [name, unit] of Object.entries(v)) {
    if (!isObj(unit)) throw new TemplateError(`${path}.${name} must be an object`);
    for (const [k, x] of Object.entries(unit)) if (!leaf(x)) throw new TemplateError(`${path}.${name}.${k} is malformed`);
  }
}

export function parseTemplates(v: unknown): Templates {
  if (!isObj(v) || v["designed"] !== true || !isNum(v["version"])) throw new TemplateError("needs version and designed: true");
  numbers(v["timing"], "timing", ["runoffMaxMs", "setMs", "liveMinMs", "liveMaxMs", "liveSecondsMin", "liveSecondsMax", "holdMs", "scoreHoldMs", "crossfadeMs", "routeAlpha"]);
  numbers(v["field"], "field", ["markYards", "markMinPx", "losFromTop", "panEdgeYards", "clearOfBallYards", "linemanClearYards"]);
  for (const k of ["offense", "kick", "defense", "returnUnits"]) groupOf(v[k], k, isPair);
  for (const k of ["routes", "drops"]) groupOf(v[k], k, (x) => Array.isArray(x) && x.every(isPair));
  if (!isObj(v["presetDrops"]) || !Object.values(v["presetDrops"]).every((x) => typeof x === "string")) throw new TemplateError("presetDrops must map presets to drop names");
  const lc = v["lineContact"];
  if (!isObj(lc)) throw new TemplateError("lineContact must be an object");
  for (const k of ["run", "pass", "kick"]) {
    const g = lc[k];
    if (!isObj(g) || !Object.values(g).every((x) => Array.isArray(x) && x.every(isPair))) throw new TemplateError(`lineContact.${k} is malformed`);
  }
  numbers(v["lineSpacing"], "lineSpacing", ["minPx", "maxDepth"]);
  groupOf(v["presetAlignment"], "presetAlignment", isPair);
  groupOf(v["manTargets"], "manTargets", isPair);
  groupOf(v["zones"], "zones", (x) => Array.isArray(x) && x.length === 5 && x.slice(0, 4).every(isNum) && (x[4] === "deep" || x[4] === "under"));
  if (!isObj(v["depthBands"]) || !Object.values(v["depthBands"]).every(isPair)) throw new TemplateError("depthBands must map pass plays to [from, to]");
  if (!isObj(v["keyRating"]) || !Object.values(v["keyRating"]).every((x) => typeof x === "string")) throw new TemplateError("keyRating must map positions to rating names");
  if (!isObj(v["passDepth"]) || !Object.values(v["passDepth"]).every(isNum)) throw new TemplateError("passDepth must map pass plays to yards");
  const t = v["timing"] as Record<string, number>;
  if ((t["liveMinMs"] as number) > (t["liveMaxMs"] as number)) throw new TemplateError("timing.liveMinMs is above liveMaxMs");
  return v as unknown as Templates;
}

// ---------------------------------------------------------------- data/ui/motion.json

export interface Motion {
  readonly keyMs: number;
  readonly speed: Readonly<Record<string, number>>;
  readonly accelMs: Readonly<Record<string, number>>;
  readonly decelMs: number;
  readonly startMs: Readonly<Record<string, number>>;
  readonly slotOffsetMs: number;
  readonly maxStartMs: number;
  readonly snapMs: Readonly<Record<string, number>>;
  readonly dropMs: Readonly<Record<string, number>>;
  readonly hitchMs: number;
  readonly handoffMs: number;
  readonly flight: { readonly baseMs: number; readonly perYardMs: number; readonly minMs: number; readonly maxMs: number; readonly apexPerYard: number; readonly apexMax: number };
  readonly punt: { readonly kickAfterSnapMs: number; readonly hangBaseMs: number; readonly hangPerYardMs: number; readonly hangMaxMs: number; readonly apex: number };
  readonly kickoff: { readonly approachMs: number; readonly hangBaseMs: number; readonly hangPerYardMs: number; readonly hangMaxMs: number; readonly apex: number; readonly onsideMs: number; readonly onsideApex: number };
  readonly fieldGoal: { readonly holdMs: number; readonly kickMs: number; readonly flightBaseMs: number; readonly flightPerYardMs: number; readonly flightMaxMs: number; readonly apex: number; readonly endScale: number };
  readonly reactionMs: Readonly<Record<string, number>>;
  readonly pursuit: { readonly leadMs: number; readonly turnDegPerS: number; readonly ringYards: number; readonly corridorHalfYards: number; readonly corridorMs: number; readonly brakeYards: number };
  readonly release: { readonly carrierPastLineYards: number; readonly afterThrowMs: number };
  readonly convergeMs: number;
  readonly settleMs: number;
  readonly settleMaxYards: number;
  readonly live: { readonly minMs: number; readonly maxMs: number; readonly kneelMs: number; readonly spikeMs: number };
  readonly preSnap: { readonly lineUpMs: number; readonly runoffMaxMs: number; readonly setMs: number; readonly glideMs: number };
  readonly fillet: { readonly roundRadius: number; readonly sharpRadius: number; readonly sharpDeg: number };
  readonly huddle: { readonly offenseBehind: number; readonly defensePast: number; readonly markGapPx: number };
}

export class MotionError extends Error {
  constructor(message: string) {
    super(`data/ui/motion.json: ${message}`);
    this.name = "MotionError";
  }
}

const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];

export function parseMotion(v: unknown): Motion {
  const bad = (m: string): never => {
    throw new MotionError(m);
  };
  if (!isObj(v) || v["designed"] !== true || !isNum(v["version"])) bad("needs version and designed: true");
  const o = v as Record<string, unknown>;
  for (const k of ["keyMs", "decelMs", "slotOffsetMs", "maxStartMs", "hitchMs", "handoffMs", "convergeMs", "settleMs", "settleMaxYards"]) if (!isNum(o[k])) bad(`${k} must be a number`);
  for (const k of ["speed", "accelMs", "startMs"]) {
    const g = o[k];
    if (!isObj(g)) bad(`${k} must be an object`);
    for (const pos of GROUPS) if (!isNum((g as Record<string, unknown>)[pos])) bad(`${k}.${pos} must be a number`);
  }
  for (const k of ["snapMs", "dropMs", "reactionMs"]) if (!isObj(o[k]) || !Object.values(o[k] as object).every(isNum)) bad(`${k} must map names to numbers`);
  const sub = (k: string, keys: readonly string[]): void => {
    if (!isObj(o[k])) bad(`${k} must be an object`);
    for (const x of keys) if (!isNum((o[k] as Record<string, unknown>)[x])) bad(`${k}.${x} must be a number`);
  };
  sub("flight", ["baseMs", "perYardMs", "minMs", "maxMs", "apexPerYard", "apexMax"]);
  sub("punt", ["kickAfterSnapMs", "hangBaseMs", "hangPerYardMs", "hangMaxMs", "apex"]);
  sub("kickoff", ["approachMs", "hangBaseMs", "hangPerYardMs", "hangMaxMs", "apex", "onsideMs", "onsideApex"]);
  sub("fieldGoal", ["holdMs", "kickMs", "flightBaseMs", "flightPerYardMs", "flightMaxMs", "apex", "endScale"]);
  sub("pursuit", ["leadMs", "turnDegPerS", "ringYards", "corridorHalfYards", "corridorMs", "brakeYards"]);
  sub("release", ["carrierPastLineYards", "afterThrowMs"]);
  sub("live", ["minMs", "maxMs", "kneelMs", "spikeMs"]);
  sub("preSnap", ["lineUpMs", "runoffMaxMs", "setMs", "glideMs"]);
  sub("fillet", ["roundRadius", "sharpRadius", "sharpDeg"]);
  sub("huddle", ["offenseBehind", "defensePast", "markGapPx"]);
  const live = o["live"] as Record<string, number>;
  if ((live["minMs"] as number) > (live["maxMs"] as number)) bad("live.minMs is above live.maxMs");
  if ((o["maxStartMs"] as number) > 150) bad("maxStartMs is over 150 (Joseph: every player moves within 150 ms of the snap)");
  return v as unknown as Motion;
}
