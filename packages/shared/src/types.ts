// Type-only entry point. packages/sim imports from here and never from schema.ts, so the
// sim never pulls in zod.
export type { Phase, Situation, SituationField, NumericSituationField } from "./situation";
export { SITUATION_FIELDS } from "./situation";
export type { Catalog, Choice, CompareOp, CompareRule, Rule, Screen } from "./catalog";
export { MAX_CHOICES_PER_SCREEN } from "./catalog";
export type {
  CallerConfig,
  CallerData,
  CallerTables,
  ContextDimension,
  DefenseMapping,
  Dimension,
  FactorConfig,
  FactorId,
  FactorTable,
  Level,
  PresetCell,
  RangeBucket,
  RuleBucket,
  SeasonRange,
} from "./caller";
export { CELL_TOTAL, CONTEXT_DIMENSIONS, FACTOR_IDS } from "./caller";
export type {
  EnforcementSpot,
  FoulSide,
  FoulTiming,
  OnsideAllowedWhen,
  OvertimeFormat,
  OvertimeScore,
  PenaltyRule,
  RuleSet,
} from "./rules";
export type {
  BallEnd,
  ExtraPointPlay,
  FieldGoalPlay,
  Foul,
  KickoffOutcome,
  KickoffPlay,
  NoPlay,
  OnsideKickPlay,
  PlayResult,
  PlaySide,
  PuntPlay,
  ScrimmageKind,
  ScrimmagePlay,
  TwoPointPlay,
} from "./play";
