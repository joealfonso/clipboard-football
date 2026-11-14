// Shared by the sim and the future app. packages/sim imports only ./types (no zod);
// the app validates data files through ./schema before handing them to the sim.
export * from "./types";
export { callerConfigSchema, callerTablesSchema, catalogSchema, checkCallerTables, withRulePlayClock, parseCallerConfig, parseCallerTables, parseCatalog, ruleSchema } from "./schema";
export { parseRuleSet, ruleSetSchema } from "./rules-schema";
export {
  baselinePenaltiesSchema,
  baselineScrimmageSchema,
  baselineSpecialSchema,
  distributionsSchema,
  engineConfigSchema,
  kickoffSchema,
  matchupCenteredSchema,
  namesSchema,
  parseEngineData,
  parsePlayer,
  parseTeamPool,
  parseTeamPoolV1,
  participantsSchema,
  personnelSchema,
  playerSchema,
  ratingsSchema,
  teamPoolSchema,
  teamPoolV1Schema,
  playerV1Schema,
  whySchema,
} from "./engine-schema";
export type { EngineFiles } from "./engine-schema";
export { gameConfigSchema, leagueSettingsSchema, onsideTableSchema, parseGameData, rateTableSchema, teamNamesSchema, tempoTableSchema, timeoutTableSchema } from "./game-schema";
export type { GameFiles } from "./game-schema";
export {
  decisionAnswerSchema,
  decisionRequestSchema,
  onFieldSchema,
  parseDecisionAnswer,
  parseDecisionRequest,
  parseOnField,
  parseParticipants,
  parsePlayerBoxScore,
  parseRatingRanks,
  playerBoxScoreSchema,
  playerLineSchema,
  playParticipantsSchema,
  ratingRanksSchema,
} from "./m2-schema";
