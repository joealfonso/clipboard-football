// Situation binning, driven entirely by data/caller/config.json. The pipeline's
// pipeline/caller/bins.py implements the same rules; test/fixtures/caller-bins.json is
// checked by both.

import type { Dimension, Level, RangeBucket, Situation } from "../../../shared/src/types";

export type BinLabels = Readonly<Record<string, string | null>>;
/** Values for context dimensions ("leaf", "front") that do not come from the Situation. */
export type LevelContext = Readonly<Record<string, string>>;

function inRange(value: number, b: RangeBucket): boolean {
  return (b.min === null || value >= b.min) && (b.max === null || value <= b.max);
}

function rangeLabel(value: number, buckets: readonly RangeBucket[], what: string): string {
  const b = buckets.find((x) => inRange(value, x));
  if (b === undefined) throw new RangeError(`${what}: ${value} is outside every bucket`);
  return b.label;
}

/** Bins a situation on every configured dimension. null means "does not apply in this phase". */
export function binSituation(situation: Situation, dimensions: Readonly<Record<string, Dimension>>): BinLabels {
  const out: Record<string, string | null> = {};
  const visit = (name: string): string | null => {
    if (name in out) return out[name] ?? null;
    const dim = dimensions[name];
    if (dim === undefined) throw new RangeError(`unknown dimension ${name}`);
    let label: string | null;
    if (!dim.phases.includes(situation.phase)) {
      label = null;
    } else {
      // Step 5d: a field the situation lacks (a frozen fixture made before the field existed)
      // makes the dimension not apply, as in pipeline/caller/bins.py.
      const value = "field" in dim ? (situation[dim.field] as number | undefined) : 0;
      if (value === undefined) {
        out[name] = null;
        return null;
      }
      switch (dim.type) {
        case "exact":
          label = String(value);
          break;
        case "range":
          label = rangeLabel(value, dim.buckets, name);
          break;
        case "clip":
          label = String(Math.min(dim.max, Math.max(dim.min, value)));
          break;
        case "rules": {
          const b = dim.buckets.find(
            (x) =>
              situation.quarter >= x.quarterMin &&
              situation.quarter <= x.quarterMax &&
              inRange(situation[x.field], x),
          );
          if (b === undefined) throw new RangeError(`${name}: no bucket for this situation`);
          label = b.label;
          break;
        }
        case "group": {
          const inner = visit(dim.of);
          const g = dim.groups.find((x) => inner !== null && x.members.includes(inner));
          label = g === undefined ? null : g.label;
          break;
        }
        case "window": {
          const inner = visit(dim.of);
          if (inner !== null && dim.members.includes(inner)) label = rangeLabel(situation[dim.field], dim.buckets, name);
          else label = dim.otherwise === null ? null : visit(dim.otherwise);
          break;
        }
        case "kneelOut": {
          const inner = visit(dim.of);
          const d = situation.down;
          if (inner === null || !dim.members.includes(inner) || situation.scoreDiff <= 0 || d < 1 || d > 3) {
            label = null;
            break;
          }
          if (dim.playClock === undefined) throw new RangeError(`${name}: no play clock (load the config with the rule set)`);
          const left = 4 - d;
          const can = left * dim.playClock + dim.kneelSeconds - dim.playClock * Math.min(situation.defenseTimeouts, left) >= situation.secondsLeftInGame;
          label = can ? "K1" : "K0";
          // Step 5c milestone F (designed, optional): K0 split by whether the kneels would run the
          // clock out if the defense used no timeout (K0c, with the defense holding 0-1 or 2-3
          // timeouts) or not even then (K0x); shortOnly makes K1 null.
          if (!can && dim.concede === true) label = left * dim.playClock + dim.kneelSeconds >= situation.secondsLeftInGame ? (situation.defenseTimeouts >= 2 ? "K0c.d23" : "K0c.d01") : "K0x";
          if (can && dim.shortOnly === true) label = null;
          break;
        }
        case "endState": {
          const inner = visit(dim.of);
          label =
            inner !== null && dim.appliesTo.includes(inner)
              ? dim.parts.map((p) => rangeLabel(situation[p.field], p.buckets, `${name}.${p.field}`)).join(".")
              : dim.otherwise;
          break;
        }
      }
    }
    out[name] = label;
    return label;
  };
  for (const name of Object.keys(dimensions)) visit(name);
  return out;
}

/**
 * The cell key for one backoff level, or null when the level cannot be used for this
 * situation (one of its dimensions does not apply). The global level's key is "".
 */
export function levelKey(level: Level, labels: BinLabels, context: LevelContext = {}): string | null {
  const parts: string[] = [];
  if (level.tag !== undefined) parts.push(level.tag);
  for (const d of level.dims) {
    const v = d in context ? context[d] : labels[d];
    if (v === undefined || v === null) return null;
    parts.push(v);
  }
  return parts.join("|");
}
