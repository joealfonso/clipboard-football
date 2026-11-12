export { createEngine } from "./resolve";
export type { Players, ResolvePlay } from "./resolve";
export { EngineError } from "./errors";
export type { EngineErrorCode } from "./errors";
export { byPosition, curveAt, generateTeam, onField, percentileOf, ratingFromMeasurements, ratingOf, slotNeeds } from "./players";
export type { GeneratorData } from "./players";
export { applyEffect, deviation, leagueMeans } from "./effects";
export { TRACE_FIELDS, dominant, isFluke, render, slotsOf } from "./why";
export type { TraceEntry, TraceFactor } from "./why";
