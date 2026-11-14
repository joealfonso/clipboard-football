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
}

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
  if (!isObj(v["passDepth"]) || !Object.values(v["passDepth"]).every(isNum)) throw new TemplateError("passDepth must map pass plays to yards");
  const t = v["timing"] as Record<string, number>;
  if ((t["liveMinMs"] as number) > (t["liveMaxMs"] as number)) throw new TemplateError("timing.liveMinMs is above liveMaxMs");
  return v as unknown as Templates;
}
