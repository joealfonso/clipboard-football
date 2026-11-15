// The why line's text: the engine's plain-words headline (milestone D). The UI never writes its
// own: a play with no headline gives null, and the UI says "No explanation for this play."

import type { PlayResult } from "@clipboard-football/shared";
import { readDetail } from "./types";

/** M2 F: a standout (the loop's final call, GameEvent `standout`) has its own headline. */
export function whyHeadline(play: PlayResult, standout?: { readonly headline: string }): string | null {
  return standout?.headline ?? readDetail(play).headline ?? null;
}
