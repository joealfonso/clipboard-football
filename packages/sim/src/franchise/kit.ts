// The game kit a franchise plays with (M4 milestone A): the same data and engine as quick play, with
// the franchise's own standout centering (data/franchise/pool.json). The best receiver takes the first
// slot on a drafted team, so an elite player is the target more often than in quick play. The
// centering goes into a copy of the data the kit is made from: no engine file changes, and quick
// play keeps its own.

import type { FranchiseData } from "../../../shared/src/franchise";
import { prepareGame } from "../loop/play";
import type { GameKit } from "../loop/play";

export function franchiseKit(data: FranchiseData, options: { readonly standouts?: boolean; readonly closeCalls?: boolean } = {}): GameKit {
  const { engine } = data.game;
  return prepareGame({ ...data.game, engine: { ...engine, standouts: { ...engine.standouts, centering: data.pool.standoutCentering } } }, options);
}
