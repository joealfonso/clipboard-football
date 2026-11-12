export type EngineErrorCode =
  /** The game state is not in a phase that has a play (scrimmage, try, kickoff). */
  | "wrongPhase"
  /** The offense call does not fit the phase, or is not a call the engine knows. */
  | "badCall"
  /** A run, pass or two-point play needs a defensive preset. */
  | "missingDefenseCall"
  | "badDefenseCall"
  /** A team's pool cannot fill the slots the call puts on the field. */
  | "badPlayers"
  /** The engine tables have no usable cell or pool for this play. */
  | "noCell"
  /** A why template slot has no value in the trace. */
  | "unboundSlot";

/** Every input the engine rejects throws this. Inputs are never changed. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "EngineError";
    this.code = code;
  }
}

export function fail(code: EngineErrorCode, message: string): never {
  throw new EngineError(code, message);
}
