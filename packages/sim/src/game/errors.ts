export type GameErrorCode =
  | "gameOver"
  | "wrongPhase"
  | "badPlay"
  | "contradictoryPlay"
  | "unknownPenalty"
  | "unsupportedFouls"
  | "badChoice"
  | "onsideNotAllowed"
  | "fairCatchNotAllowed"
  | "noTimeouts"
  | "timeoutNotAllowed"
  | "runoffTooLong"
  | "invariantViolation";

/** Every rejected input throws this. The state passed in is never changed. */
export class GameRuleError extends Error {
  readonly code: GameErrorCode;

  constructor(code: GameErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "GameRuleError";
    this.code = code;
  }
}

export function reject(code: GameErrorCode, message: string): never {
  throw new GameRuleError(code, message);
}
