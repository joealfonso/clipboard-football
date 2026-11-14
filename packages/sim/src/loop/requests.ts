// M2 milestone E: the requests the step-wise loop pauses on, built from the game state and the
// human's own side only, and what an answer's path means. Legality comes from the catalog's
// availability rules and the rule set; every off option carries a reason code (design decision
// 9). Nothing here reads the other team's call for the coming snap.

import type { Catalog, DecisionRequest, OffenseCallChoice, ReasonCode, RequestOption, RequestScreen, RuleSet, Situation, Tempo } from "../../../shared/src/types";
import { MAX_CHOICES_PER_SCREEN, TEMPOS } from "../../../shared/src/types";
import { indexCatalog, type AvailabilityIndex } from "../caller/availability";
import { FORMATION_PLAYS } from "../caller/offense";
import type { GameState, Team } from "../game/types";

export type Unseq<T> = T extends unknown ? Omit<T, "seq"> : never;
export type RequestDraft = Unseq<DecisionRequest>;

const FORMATIONS = ["shotgun", "underCenter", "pistol", "empty", "heavy"] as const;
const PACKAGES = ["base", "nickel", "dime", "specials"] as const;
/** Scrimmage calls that take no formation. */
const SCRIMMAGE_OTHER: readonly string[] = ["punt", "fieldGoal", "spike", "kneel"];

const indexes = new WeakMap<Catalog, AvailabilityIndex>();
function availability(catalog: Catalog): AvailabilityIndex {
  let i = indexes.get(catalog);
  if (i === undefined) {
    i = indexCatalog(catalog);
    indexes.set(catalog, i);
  }
  return i;
}

const on = (id: string, opens?: string): RequestOption => (opens === undefined ? { id, legal: true } : { id, legal: true, opens });
const off = (id: string, reason: ReasonCode, opens?: string): RequestOption => (opens === undefined ? { id, legal: false, reason } : { id, legal: false, reason, opens });

/** The timeout option for `team` now. */
export function timeoutOption(s: GameState, rules: RuleSet, team: Team): RequestOption {
  if (s.timeouts[team] <= 0) return off("timeout", "noTimeouts");
  if (s.timeoutsThisDeadBall[team] >= rules.timeouts.perTeamPerDeadBall) return off("timeout", "timeoutTaken");
  return on("timeout");
}

function screen(id: string, options: readonly RequestOption[]): RequestScreen {
  if (options.length + 1 > MAX_CHOICES_PER_SCREEN) throw new RangeError(`screen ${id} has ${options.length} options plus Esc, over ${MAX_CHOICES_PER_SCREEN}`);
  return { id, options };
}

function catalogScreen(catalog: Catalog, id: string, legal: (choice: string) => RequestOption | null = () => null): RequestScreen {
  const s = catalog.screens.find((x) => x.id === id);
  if (s === undefined) throw new RangeError(`catalog has no screen ${id}`);
  return screen(id, s.choices.map((c) => legal(c.id) ?? on(c.id, c.opens)));
}

function formationScreens(): RequestScreen[] {
  return [
    screen("offense.formation.run", FORMATIONS.map((f) => on(f, "offense.run"))),
    screen("offense.formation.pass", FORMATIONS.map((f) => on(f, "offense.pass"))),
  ];
}

/** Whether a call (as taken by the loop) is legal now, by the catalog's availability rules. */
function callLegal(call: OffenseCallChoice, sit: Situation, catalog: Catalog): boolean {
  const a = availability(catalog);
  if (sit.phase === "try") return call.call === "goForTwo" ? call.twoPointPlay !== undefined && FORMATION_PLAYS.includes(call.twoPointPlay) : call.call === "extraPoint";
  if (FORMATION_PLAYS.includes(call.call)) return call.formation !== undefined;
  return SCRIMMAGE_OTHER.includes(call.call) && a.isAvailable(call.call, sit);
}

function sameCallOption(last: OffenseCallChoice | null, legal: boolean): RequestOption {
  if (last === null) return off("sameCall", "noEarlierCall");
  return legal ? on("sameCall") : off("sameCall", "lastCallNotLegal");
}

/** First screen and menus for the human offense before a scrimmage snap. */
export function offenseRequest(s: GameState, rules: RuleSet, catalog: Catalog, sit: Situation, team: Team, tempo: Tempo, last: OffenseCallChoice | null, kickDepth: number): RequestDraft {
  const a = availability(catalog);
  const kick = a.isAvailable("kick", sit) ? on("kick", "offense.kick") : off("kick", "kickNotNow", "offense.kick");
  const first = screen("offense.playType", [
    on("run", "offense.formation.run"),
    on("pass", "offense.formation.pass"),
    kick,
    on("clock", "offense.clock"),
    sameCallOption(last, last !== null && callLegal(last, sit, catalog)),
    timeoutOption(s, rules, team),
  ]);
  const kickScreen = catalogScreen(catalog, "offense.kick", (id) => (a.isAvailable(id, sit) ? null : off(id, "kickNotNow")));
  const clock = screen("offense.clock", [on("spike"), on("kneel"), ...TEMPOS.map((t) => on(t))]);
  return {
    kind: "offenseCall",
    team,
    screens: [first, ...formationScreens(), catalogScreen(catalog, "offense.run"), catalogScreen(catalog, "offense.pass"), kickScreen, clock],
    tempo,
    clockRunning: s.clockRunning,
    sameCall: last,
    fieldGoalYards: 100 - Math.max(1, s.spot - kickDepth) + rules.field.endZoneYards,
  };
}

/** The human offense's try: extra point or two (then Run or Pass only). */
export function tryRequest(s: GameState, rules: RuleSet, catalog: Catalog, team: Team, last: OffenseCallChoice | null): RequestDraft {
  const twoLegal = last !== null && last.formation !== undefined && FORMATION_PLAYS.includes(last.call);
  return {
    kind: "try",
    team,
    screens: [
      screen("offense.try", [on("extraPoint"), on("goForTwo", "offense.playType.try"), timeoutOption(s, rules, team)]),
      screen("offense.playType.try", [
        on("run", "offense.formation.run"),
        on("pass", "offense.formation.pass"),
        off("kick", "notOnTry"),
        off("clock", "notOnTry"),
        sameCallOption(last, twoLegal),
      ]),
      ...formationScreens(),
      catalogScreen(catalog, "offense.run"),
      catalogScreen(catalog, "offense.pass"),
    ],
    sameCall: last,
  };
}

export function defenseRequest(s: GameState, rules: RuleSet, catalog: Catalog, team: Team, last: string | null, timeout: boolean): RequestDraft {
  const first = screen("defense.package", [
    ...PACKAGES.map((p) => on(p, `defense.${p}`)),
    sameCallOption(last === null ? null : { call: last }, last !== null),
    ...(timeout ? [timeoutOption(s, rules, team)] : []),
  ]);
  return {
    kind: "defenseCall",
    team,
    screens: [first, ...PACKAGES.map((p) => catalogScreen(catalog, `defense.${p}`))],
    onTry: s.phase === "try",
    sameCall: last,
  };
}

export function kickoffRequest(s: GameState, rules: RuleSet, team: Team, onsideAllowed: boolean): RequestDraft {
  return {
    kind: "kickoff",
    team,
    screens: [screen("kickoff", [on("kickoff"), onsideAllowed ? on("onsideKick") : off("onsideKick", "onsideNotAllowed"), timeoutOption(s, rules, team)])],
    safetyKick: s.safetyKick,
  };
}

export function continueRequest(team: Team, about: Extract<DecisionRequest, { kind: "continue" }>["about"], timeout: RequestOption | null): RequestDraft {
  return { kind: "continue", team, screens: [screen("continue", [on("continue"), ...(timeout === null ? [] : [timeout])])], about };
}

export function tossRequest(team: Team, overtime: boolean): RequestDraft {
  return overtime
    ? { kind: "overtimeToss", team, screens: [screen("overtimeToss", [on("receive"), on("kick")])] }
    : { kind: "toss", team, screens: [screen("toss", [on("receive"), on("defer")])] };
}

/** Option ids of a penalty request: "accept:<foul index>", "decline". */
export function penaltyOptionId(o: { readonly kind: string; readonly foul?: number }): string {
  return o.kind === "accept" ? `accept:${o.foul ?? 0}` : o.kind;
}

// ---------------------------------------------------------------- answers

export type OffenseAnswer = { readonly timeout: true } | { readonly tempo: Tempo } | { readonly call: OffenseCallChoice };

/** An offense or try path as a call, a timeout or a tempo change. `last` resolves Same call. */
export function offenseAnswer(path: readonly string[], last: OffenseCallChoice | null): OffenseAnswer {
  const [a, b, c, d] = path;
  if (a === "timeout") return { timeout: true };
  if (a === "sameCall") return { call: last as OffenseCallChoice };
  if (a === "clock" && (TEMPOS as readonly string[]).includes(b ?? "")) return { tempo: b as Tempo };
  if (a === "clock" || a === "kick") return { call: { call: b as string } };
  if (a === "run" || a === "pass") return { call: { call: c as string, formation: b as string } };
  if (a === "extraPoint") return { call: { call: "extraPoint" } };
  if (a === "goForTwo") {
    if (b === "sameCall") {
      const l = last as OffenseCallChoice;
      return { call: { call: "goForTwo", twoPointPlay: l.call, formation: l.formation as string } };
    }
    return { call: { call: "goForTwo", twoPointPlay: d as string, formation: c as string } };
  }
  throw new RangeError(`not an offense answer: ${path.join(" > ")}`);
}

export type DefenseAnswer = { readonly timeout: true } | { readonly preset: string };

export function defenseAnswer(path: readonly string[], last: string | null): DefenseAnswer {
  const [a, b] = path;
  if (a === "timeout") return { timeout: true };
  if (a === "sameCall") return { preset: last as string };
  return { preset: b as string };
}
