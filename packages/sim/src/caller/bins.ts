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

const MAX_TIMEOUTS = 3;

/** Step 5d: "d" and the timeout counts on the same side of the split, e.g. split 2: d01 or d23. */
function timeoutBand(timeouts: number, split: number): string {
  let out = "d";
  if (timeouts < split) for (let i = 0; i < split; i++) out += String(i);
  else for (let i = split; i <= MAX_TIMEOUTS; i++) out += String(i);
  return out;
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
      // A Situation always carries every field; a missing one is a bug in the caller of this
      // function and fails loudly (as pipeline/caller/bins.py does), never a silent null.
      const value = "field" in dim ? (situation[dim.field] as number | undefined) : 0;
      if (value === undefined) throw new RangeError(`${name}: the situation has no ${"field" in dim ? dim.field : "field"}`);
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
          for (const x of dim.buckets) if (situation[x.field] === undefined) throw new RangeError(`${name}: the situation has no ${x.field}`);
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
          // clock out if the defense used no timeout (K0c) or not even then (K0x), each by the
          // defense's timeouts at the split points in the config (step 5d milestone D:
          // `concedeSplit`, and `k0xSplit` when present); shortOnly makes K1 null.
          if (!can && dim.concede === true) {
            if (dim.concedeSplit === undefined) throw new RangeError(`${name}: concede needs concedeSplit`);
            label =
              left * dim.playClock + dim.kneelSeconds >= situation.secondsLeftInGame
                ? `K0c.${timeoutBand(situation.defenseTimeouts, dim.concedeSplit)}`
                : dim.k0xSplit === undefined
                  ? "K0x"
                  : `K0x.${timeoutBand(situation.defenseTimeouts, dim.k0xSplit)}`;
          }
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
