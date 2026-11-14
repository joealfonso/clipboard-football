// Shared test helpers: the real data and engine through the adapter, and a scripted human.

import { loadGameData } from "../../../scripts/game/data";
import { prepare, type Prepared } from "../src/engine/adapter";
import type { Answer, DecisionRequest } from "../src/engine/types";

let cached: Prepared | null = null;

export function prepared(): Prepared {
  cached ??= prepare(loadGameData(), "test-data-hash");
  return cached;
}

/** A tiny deterministic hash so the scripted human varies its calls without an Rng. */
function mix(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

const FORMATIONS = ["shotgun", "underCenter", "pistol", "empty", "heavy"];

/**
 * A scripted human: answers every request with a legal choice that depends on the request's seq,
 * so a game covers runs, passes, kicks, timeouts, Same call and tempo.
 */
export function scriptedAnswer(req: DecisionRequest, salt = 0): Answer {
  const r = mix(req.seq * 31 + salt);
  switch (req.kind) {
    case "continue":
      return req.timeout.on && r % 23 === 0 ? { kind: "timeout" } : { kind: "continue" };
    case "penaltyChoice":
      return { kind: "penalty", index: r % req.choices.length };
    case "kickoffType": {
      const on = req.options.filter((o) => o.on);
      return { kind: "offense", call: { call: (on[r % on.length] ?? on[0])?.id ?? "kickoff" } };
    }
    case "try":
      if (r % 3 === 0) {
        const plays = req.calls.filter((c) => c.on);
        return { kind: "offense", call: { call: "goForTwo", twoPointPlay: (plays[r % plays.length] as { id: string }).id, formation: FORMATIONS[r % 5] as string } };
      }
      return { kind: "offense", call: { call: "extraPoint" } };
    case "defenseCall":
      if (req.timeout.on && r % 29 === 0) return { kind: "timeout" };
      if (req.sameCall.on && r % 4 === 0 && req.sameCall.defense !== undefined) return { kind: "defense", call: req.sameCall.defense };
      return { kind: "defense", call: (req.calls[r % req.calls.length] as { id: string }).id };
    case "offenseCall": {
      if (req.timeout.on && r % 31 === 0) return { kind: "timeout" };
      if (req.sameCall.on && r % 5 === 0 && req.sameCall.offense !== undefined) return { kind: "offense", call: req.sameCall.offense };
      const kick = req.calls.find((c) => c.id === "punt");
      if (kick?.on === true && req.view.down === 4) return { kind: "offense", call: { call: r % 2 === 0 ? "punt" : "fieldGoal" } };
      const plays = req.calls.filter((c) => c.on && !["punt", "fieldGoal", "spike", "kneel"].includes(c.id));
      const p = (plays[r % plays.length] as { id: string }).id;
      return { kind: "offense", call: { call: p, formation: FORMATIONS[(r >>> 4) % 5] as string } };
    }
    default:
      throw new Error(`the scripted human can't answer ${req.kind}`);
  }
}
