// Canvas text and the bundled fonts (DESIGN.md Typography: "Canvas waits for document.fonts.load()
// of the faces it uses and redraws when document.fonts.ready resolves"). Canvas never triggers a
// font load on its own, so the faces it draws with are requested here; anything drawn before they
// arrive uses the fallback and is drawn again once they have. Placement doesn't depend on the face:
// labelWidth is an upper-bound estimate, and pills, yard-number gaps and tags are measured at draw
// time, so a redraw measures them in the loaded face.

/** The faces the field, splash and toasts draw with (font shorthand, family as in styles.css). */
export const CANVAS_FACES = ['600 12px "Inter"', '700 12px "Inter"', '700 26px "Barlow Condensed"', '600 20px "Barlow Condensed"'] as const;

interface FontSet {
  load(font: string): Promise<unknown>;
  readonly ready: Promise<unknown>;
}

/**
 * Requests every canvas face, then calls `redraw` once when they have loaded and document.fonts is
 * ready. A face that fails to load still ends the wait (the fallback stays). No FontFaceSet: nothing.
 */
export function whenCanvasFontsReady(fonts: FontSet | undefined, redraw: () => void): Promise<void> {
  if (fonts === undefined) return Promise.resolve();
  return Promise.all(CANVAS_FACES.map((f) => fonts.load(f).catch(() => undefined)))
    .then(() => fonts.ready)
    .then(
      () => redraw(),
      () => redraw(),
    );
}
