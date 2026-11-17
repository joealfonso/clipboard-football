// The calling screen's board (docs/specs/m2-calling-screen-pass.md, U1): the frame the field shows
// now (the animator's), drawn with the field's own drawing functions at the board's scale and
// camera. It adds no frame logic: what it draws is exactly the hidden play canvas's frame (CB2).
// Pure: the view only.

import type { View } from "./field";
import { BOARD, boardCamera, FIELD_WIDTH_YARDS, type BoardLayout } from "./layout";
import type { Templates } from "./templates";
import { at, type Timeline } from "./timeline";

/** The compact Last play card's height at 100% text (label, one result line, the D hint): about 64 px. */
export const COMPACT_CARD_PX = 64;

/** Your lined-up marks' field y in a frame (your side's marks that aren't in a huddle). */
export function ownLinedUpYs(tl: Timeline, t: number, own: "O" | "X"): number[] {
  return tl.marks.filter((m) => m.side === own && !m.huddle && !m.playerId.startsWith("huddle:")).map((m) => at(m.keys, t).y);
}

/**
 * The board's view of a frame: 56 yards across at sB px per yard (the field's 53.3 plus 1.35 yards
 * each side), the camera from boardCamera, marks and labels at the field's own sizes for that scale.
 */
export function boardViewOf(lay: BoardLayout, frame: { readonly tl: Timeline; readonly t: number }, own: "O" | "X", templates: Pick<Templates, "field">): View {
  const visible = lay.boardH / lay.sB;
  const cameraY = boardCamera(frame.tl.los, visible, ownLinedUpYs(frame.tl, frame.t, own), own, templates.field.losFromTop);
  // field.ts puts the left sideline 1 yard right of `ox`: the extra 0.35 yard centers the field.
  const ox = ((BOARD.yards - FIELD_WIDTH_YARDS) / 2 - 1) * lay.sB;
  return { s: lay.sB, ox, width: lay.boardW, columnWidth: lay.boardW, height: lay.boardH, cameraY, markPx: Math.max(templates.field.markMinPx, templates.field.markYards * lay.sB) };
}
