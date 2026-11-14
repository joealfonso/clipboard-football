// The why line's text: the engine's plain-words headline (milestone D). The UI never writes its
// own: a play with no headline gives null, and the UI says "No explanation for this play."

import type { PlayResult } from "@clipboard-football/shared";
import { readDetail } from "./types";

export function whyHeadline(play: PlayResult): string | null {
  return readDetail(play).headline ?? null;
}
