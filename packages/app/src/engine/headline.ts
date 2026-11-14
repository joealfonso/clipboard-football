// The why line's text. The engine's headline variant (milestone D) when the PlayResult has one.
// ADAPTER STAND-IN until milestone D ships: the engine's existing why sentence (step 4), which is
// still engine text bound to the trace but carries the multipliers the headline will drop. The UI
// never writes its own: no text at all gives null, and the UI says "No explanation for this play."

import type { PlayResult } from "@clipboard-football/shared";
import { readDetail } from "./types";

export function whyHeadline(play: PlayResult): string | null {
  const d = readDetail(play);
  return d.headline ?? d.why ?? null;
}
