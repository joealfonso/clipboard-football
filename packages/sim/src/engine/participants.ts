// M2 milestone B: who made each play. resolvePlay draws the outcome first, exactly as in M1, and
// then credits players to the roles the result implies, by the designed rule in
// data/engine/participants.json. Every draw here comes from a per-play credit stream, never from
// the outcome stream, so crediting changes no outcome for any seed (B2, B7). A role that did not
// happen is absent, never filled with a guess.

import type { OnField, OnFieldSide, Participants, ParticipantRole, PlayResult } from "../../../shared/src/play";
import type { ParticipantRole as RoleConfig, ParticipantsConfig, Player, Position, PositionShares } from "../../../shared/src/engine";
import { POSITIONS } from "../../../shared/src/engine";
import { Rng } from "../rng";
import { fail } from "./errors";
import type { TraceEntry } from "./why";

/** On-field players by position, slot order. */
export type Unit = Readonly<Record<string, readonly Player[]>>;

export interface CreditInput {
  readonly play: PlayResult;
  /** The class as enforced (detail.class), or null for kneels, spikes and pre-snap fouls. */
  readonly cls: string | null;
  /** The call's leaf: a run or pass play, or the kick, kneel or spike. */
  readonly leaf: string;
  /** The team that snapped or kicked. */
  readonly offense: Unit;
  /** The other team: its defense package, or its return unit on a kickoff or punt. */
  readonly defense: Unit;
  /** The return unit's name when `defense` is one. */
  readonly unit: string | null;
  /**
   * M2 F: when a standout factor raised the drawn class, the role it raised and each elite's
   * multiplier; crediting weights those players by it (they made the class more likely).
   */
  readonly boost?: { readonly role: string; readonly weights: ReadonlyMap<string, number> };
}

export interface Credited {
  readonly participants: Participants;
  readonly onField: OnField;
  /** One entry per role present, then one `fouler` per foul (TRACE_FIELDS). */
  readonly trace: TraceEntry[];
}

/**
 * The credit stream for one play: seeded from the outcome stream's state before the play's first
 * draw, which it reads and never advances. Same game, same participants (B7).
 */
export function creditStream(rng: Rng): Rng {
  const [a, b, c, d] = rng.getState();
  const hi = (a ^ Math.imul(c, 0x9e3779b1)) >>> 0;
  const lo = (b ^ Math.imul(d, 0x85ebca6b)) >>> 0;
  return Rng.fromSeed((hi & 0x1fffff) * 4294967296 + lo);
}

function sideOf(u: Unit): OnFieldSide {
  const out: Record<string, readonly string[]> = {};
  for (const p of POSITIONS) {
    const xs = u[p];
    if (xs !== undefined && xs.length > 0) out[p] = xs.map((x) => x.id);
  }
  return out;
}

function ratingOr(p: Player, rating: string, fallback: number): number {
  const v = (p.ratings as Readonly<Record<string, number>>)[rating] ?? p.skills[rating];
  return v === undefined ? fallback : v;
}

/** Shares of a role on one unit before any class tilt (M2 F: the standout weighting). Normalized; empty with no candidate. */
export function baseShares(cfg: ParticipantsConfig, name: string, r: RoleConfig, unit: Unit, ctx: { cls: string | null; leaf: string; unit: string | null }): Map<Player, number> {
  const xs = weighted(cfg, name, r, unit, { ...ctx, cls: ctx.cls }, new Set(), false);
  const total = xs.reduce((a, x) => a + x.w, 0);
  return new Map(total > 0 ? xs.map((x) => [x.p, x.w / total]) : []);
}

/** Weighted candidates for a role on one unit (participants.json); `tilt` applies the class tilts. */
function weighted(cfg: ParticipantsConfig, name: string, r: RoleConfig, unit: Unit, ctx: { cls: string | null; leaf: string; unit: string | null }, exclude: ReadonlySet<string>, tilt: boolean): { p: Player; w: number }[] {
  const shares: PositionShares | undefined = (r.byLeaf?.[ctx.leaf]) ?? (ctx.cls !== null ? r.byClass?.[ctx.cls] : undefined) ?? (ctx.unit !== null ? r.byUnit?.[ctx.unit] : undefined) ?? r.flat;
  const tilts = tilt ? cfg.tilts.filter((t) => t.role === name && (t.classes.includes("*") || (ctx.cls !== null && t.classes.includes(ctx.cls)))) : [];
  const out: { p: Player; w: number }[] = [];
  for (const pos of POSITIONS) {
    const share = shares?.[pos] ?? 0;
    const xs = (unit[pos] ?? []).filter((x) => !exclude.has(x.id));
    if (share <= 0 || xs.length === 0) continue;
    const sw = cfg.slotWeights[pos as Position] ?? [];
    const slot = (i: number): number => sw[Math.min(i, sw.length - 1)] ?? 1;
    let total = 0;
    for (let i = 0; i < xs.length; i++) total += slot(i);
    xs.forEach((x, i) => {
      let w = (share * slot(i)) / total;
      for (const t of tilts) w *= Math.exp(t.coef * (ratingOr(x, t.rating, cfg.center) - cfg.center));
      out.push({ p: x, w });
    });
  }
  if (out.length > 0) return out;
  for (const pos of r.fallback ?? []) for (const x of unit[pos] ?? []) if (!exclude.has(x.id)) out.push({ p: x, w: 1 });
  return out;
}

export function createCredit(cfg: ParticipantsConfig): (input: CreditInput, rng: Rng) => Credited {
  const role = (name: string): RoleConfig => {
    const r = cfg.roles[name];
    if (r === undefined) return fail("badPlayers", `participants.json has no role ${name}`);
    return r;
  };

  /** Weighted candidates for a role on one unit, class tilts applied. */
  function candidates(name: string, r: RoleConfig, unit: Unit, ctx: { cls: string | null; leaf: string; unit: string | null }, exclude: ReadonlySet<string>): { p: Player; w: number }[] {
    return weighted(cfg, name, r, unit, ctx, exclude, true);
  }

  return function credit(input, rng) {
    const { play, cls, leaf } = input;
    const ctx = { cls, leaf, unit: input.unit };
    const parts: Partial<Record<ParticipantRole, string>> = {};
    const trace: TraceEntry[] = [];
    const named = new Map<string, Player>();
    const set = (as: ParticipantRole, p: Player | undefined): Player | undefined => {
      if (p === undefined) return undefined;
      parts[as] = p.id;
      named.set(as, p);
      return p;
    };
    /** One draw from the credit stream; undefined when the role has no candidate on the field. */
    const pick = (configRole: string, exclude: ReadonlySet<string> = new Set()): Player | undefined => {
      const r = role(configRole);
      const unit = r.side === "offense" ? input.offense : input.defense;
      const boost = input.boost !== undefined && input.boost.role === configRole ? input.boost.weights : null;
      const xs = candidates(configRole, r, unit, ctx, exclude).map((x) => (boost === null ? x : { p: x.p, w: x.w * (boost.get(x.p.id) ?? 1) }));
      const u = rng.nextFloat();
      if (xs.length === 0) return undefined;
      const total = xs.reduce((a, x) => a + x.w, 0);
      let acc = 0;
      for (const x of xs) {
        acc += x.w;
        if (u * total < acc) return x.p;
      }
      return (xs[xs.length - 1] as { p: Player }).p;
    };
    const first = (u: Unit, pos: Position): Player | undefined => u[pos]?.[0];
    const qb = (): Player | undefined => first(input.offense, "QB");

    const noTackle = (p: PlayResult): boolean => {
      if (p.kind === "noPlay" || !("end" in p) || p.end === undefined) return true;
      if ("touchdown" in p && p.touchdown === true) return true;
      if (p.end.possession === "offense" && p.end.spot >= 100) return true;
      if (p.end.possession === "defense" && p.end.spot <= 0) return true;
      return "outOfBounds" in p && p.outOfBounds === true;
    };

    /** After the ball is in the carrier's hands: fumbles, regains, the tackle. */
    const afterCarry = (p: PlayResult, carrierTackled: boolean, forcer?: Player): void => {
      if (!("end" in p) || p.end === undefined) return;
      const turnover = "turnover" in p ? p.turnover : undefined;
      const regained = "defensePossessedDuringPlay" in p && p.defensePossessedDuringPlay === true;
      if (turnover === "fumble") {
        set("fumbleForcer", forcer ?? pick("fumbleForcer"));
        set("fumbleRecoverer", pick("defenseRecoverer"));
        if (!noTackle(p)) set("tackler", pick("returnTackler"));
        return;
      }
      if (regained) {
        set("fumbleForcer", forcer ?? pick("fumbleForcer"));
        set("fumbleRecoverer", pick("offenseRecoverer"));
        return;
      }
      if ("fumbleOutOfBounds" in p && p.fumbleOutOfBounds === true) {
        set("fumbleForcer", forcer ?? pick("fumbleForcer"));
        return;
      }
      if (carrierTackled && !noTackle(p)) set("tackler", pick("tackler"));
    };

    const fouls = play.fouls ?? [];
    const groundingOnly = fouls.some((f) => cfg.noTarget.includes(f.penalty));
    switch (play.kind) {
      case "noPlay":
        break;
      case "kneel":
        set("ballCarrier", qb());
        break;
      case "spike":
        set("passer", qb());
        break;
      case "run":
        set("ballCarrier", pick("ballCarrier"));
        afterCarry(play, true);
        break;
      case "scramble":
        set("ballCarrier", qb());
        afterCarry(play, true);
        break;
      case "sack": {
        set("passer", qb());
        const sacker = set("sacker", pick("sacker"));
        afterCarry(play, false, sacker);
        break;
      }
      case "pass":
      case "twoPoint": {
        const runLeaf = play.kind === "twoPoint" && role("ballCarrier").byLeaf?.[leaf] !== undefined;
        if (runLeaf) {
          set("ballCarrier", pick("ballCarrier"));
          if (play.end.possession === "defense") {
            set("fumbleForcer", pick("fumbleForcer"));
            set("fumbleRecoverer", pick("defenseRecoverer"));
          } else if (!noTackle(play)) set("tackler", pick("tackler"));
          break;
        }
        if (cls === "sack") {
          set("passer", qb());
          const sacker = set("sacker", pick("sacker"));
          if (play.end.possession === "defense") {
            set("fumbleForcer", sacker);
            set("fumbleRecoverer", pick("defenseRecoverer"));
          }
          break;
        }
        if (cls === "scramble") {
          set("ballCarrier", qb());
          if (play.end.possession === "defense") {
            set("fumbleForcer", pick("fumbleForcer"));
            set("fumbleRecoverer", pick("defenseRecoverer"));
          } else if (!noTackle(play)) set("tackler", pick("tackler"));
          break;
        }
        set("passer", qb());
        if (groundingOnly) break;
        const target = set("target", pick("target"));
        if (play.incomplete === true) break;
        const turnover = play.kind === "pass" ? play.turnover : undefined;
        const regained = play.kind === "pass" && play.defensePossessedDuringPlay === true;
        if (turnover === "interception" || (play.kind === "twoPoint" && play.end.possession === "defense" && cls === "int")) {
          set("interceptor", pick("interceptor"));
          if (!noTackle(play)) set("tackler", pick("returnTackler"));
          break;
        }
        if (regained && cls === "int") {
          set("interceptor", pick("interceptor"));
          set("fumbleRecoverer", pick("offenseRecoverer"));
          break;
        }
        set("receiver", target);
        if (play.kind === "twoPoint") {
          if (play.end.possession === "defense") {
            set("fumbleForcer", pick("fumbleForcer"));
            set("fumbleRecoverer", pick("defenseRecoverer"));
          } else if (!noTackle(play)) set("tackler", pick("tackler"));
          break;
        }
        afterCarry(play, true);
        break;
      }
      case "kickoff":
      case "onsideKick": {
        set("kicker", first(input.offense, "K"));
        if (play.end === undefined) break;
        if (play.kind === "onsideKick") {
          set("fumbleRecoverer", pick(play.end.possession === "offense" ? "offenseRecoverer" : "defenseRecoverer"));
          break;
        }
        if (play.outcome === "fairCatch") set("returner", pick("returner"));
        else if (play.end.possession === "defense") {
          set("returner", pick("returner"));
          if (!noTackle(play)) set("tackler", pick("coverageTackler"));
        } else set("fumbleRecoverer", pick("offenseRecoverer"));
        break;
      }
      case "punt": {
        set("punter", first(input.offense, "P"));
        const c = cls ?? "";
        if (c === "blocked") {
          set("fumbleRecoverer", pick(play.end.possession === "offense" ? "offenseRecoverer" : "defenseRecoverer"));
        } else if (c === "muffed") {
          set("returner", pick("returner"));
          set("fumbleRecoverer", pick(play.end.possession === "offense" ? "offenseRecoverer" : "defenseRecoverer"));
        } else if (c === "returnTD" || c.startsWith("fairCatch")) {
          set("returner", pick("returner"));
        } else if (c.startsWith("returned")) {
          set("returner", pick("returner"));
          if (!noTackle(play)) set("tackler", pick("coverageTackler"));
        }
        break;
      }
      case "fieldGoal":
      case "extraPoint":
        set("kicker", first(input.offense, "K"));
        if (play.end !== undefined) set("fumbleRecoverer", pick(play.end.possession === "offense" ? "offenseRecoverer" : "defenseRecoverer"));
        break;
    }

    for (const [as, p] of named) trace.push({ factor: as as TraceEntry["factor"], id: p.id, number: p.number, name: p.name });
    const foulers: string[] = [];
    for (const f of fouls) {
      const allowed = cfg.foulers[f.penalty]?.[f.by] ?? [];
      const unit = f.by === "offense" ? input.offense : input.defense;
      const xs = allowed.flatMap((pos) => unit[pos] ?? []);
      const u = rng.nextFloat();
      const p = xs[Math.floor(u * xs.length)];
      if (p === undefined) return fail("badPlayers", `no ${f.by} player on the field may commit ${f.penalty} (participants.json foulers)`);
      foulers.push(p.id);
      trace.push({ factor: "fouler", id: p.id, number: p.number, name: p.name, penalty: f.penalty });
    }
    const participants: Participants = foulers.length > 0 ? { ...parts, foulers } : { ...parts };
    return { participants, onField: { offense: sideOf(input.offense), defense: sideOf(input.defense) }, trace };
  };
}
