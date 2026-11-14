// Checks on every message that crosses the worker boundary, both ways. Structural and
// hand-written, so the UI thread's bundle stays free of zod and the sim. The worker also checks
// each request and every saved answer against the shared zod schemas (session.ts).

import type { FromWorker, ToWorker } from "./protocol";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isTeam = (v: unknown): boolean => v === "home" || v === "away";
const isStr = (v: unknown): v is string => typeof v === "string";

/** An answer as the engine takes it: a positive seq and a non-empty path of ids. */
export function isAnswerShape(v: unknown): boolean {
  return isObj(v) && isInt(v["seq"]) && (v["seq"] as number) > 0 && Array.isArray(v["path"]) && v["path"].length > 0 && v["path"].every(isStr);
}

/** A message the worker accepts; anything else is dropped with a warning. */
export function isToWorker(v: unknown): v is ToWorker {
  if (!isObj(v) || !isStr(v["t"])) return false;
  switch (v["t"]) {
    case "init":
    case "box":
      return true;
    case "matchup":
    case "rematch":
      return isInt(v["leagueSeed"]) && isInt(v["seed"]);
    case "newGame":
      return isInt(v["leagueSeed"]) && isInt(v["seed"]) && isTeam(v["human"]);
    case "resume":
      // The save itself is checked in full by the session.
      return "save" in v;
    case "answer":
      return isAnswerShape(v["answer"]);
    case "ranks":
      return isStr(v["playerId"]) && isInt(v["leagueSeed"]);
    default:
      return false;
  }
}

/** A message the UI thread accepts from the worker; anything else becomes a sim error. */
export function isFromWorker(v: unknown): v is FromWorker {
  if (!isObj(v) || !isStr(v["t"])) return false;
  switch (v["t"]) {
    case "progress":
      return isStr(v["file"]) && isInt(v["done"]) && isInt(v["total"]);
    case "ready":
      return isObj(v["ui"]) && isInt(v["leagueSeed"]);
    case "dataError":
      return isStr(v["file"]) && isStr(v["message"]);
    case "matchup":
      return isObj(v["matchup"]);
    case "step":
      return (
        isObj(v["matchup"]) &&
        isTeam(v["human"]) &&
        Array.isArray(v["events"]) &&
        (v["request"] === null || (isObj(v["request"]) && isStr(v["request"]["kind"]) && isInt(v["request"]["seq"]) && Array.isArray(v["request"]["screens"]))) &&
        (v["state"] === null || isObj(v["state"])) &&
        isObj(v["save"]) &&
        typeof v["resumed"] === "boolean"
      );
    case "answerError":
      return isStr(v["code"]) && isStr(v["message"]);
    case "saveError":
      return v["reason"] === "older" || v["reason"] === "damaged";
    case "box":
      return isObj(v["box"]) && isObj(v["players"]);
    case "ranks":
      return isStr(v["playerId"]) && isObj(v["ranks"]);
    case "simError":
      return isObj(v["error"]) && isStr(v["error"]["message"]);
    default:
      return false;
  }
}
