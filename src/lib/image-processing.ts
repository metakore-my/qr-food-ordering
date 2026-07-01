/**
 * Pure, DOM-free image-sizing math for the upload pipeline. Kept separate from
 * the canvas rendering (`image-canvas.ts`) so the arithmetic is unit-testable in
 * jsdom (which has no canvas). See
 * docs/superpowers/specs/2026-06-29-image-upload-features-design.md.
 */

export interface Dims {
  width: number;
  height: number;
}

/**
 * Scale `(w, h)` so its LONGER edge is at most `maxEdge`, preserving aspect
 * ratio. Never upscales: if already within the cap, returns the input dims
 * unchanged. Rounds to integer pixels.
 */
export function fitWithinMaxEdge(w: number, h: number, maxEdge: number): Dims {
  const longer = Math.max(w, h);
  if (longer <= maxEdge) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  const scale = maxEdge / longer;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/**
 * Output dimensions for a crop region of `cropWidthPx × cropHeightPx`, capped at
 * `maxEdge`. A thin alias over `fitWithinMaxEdge`, named for the call site so the
 * upload code reads intentionally.
 */
export function outputDimsForCrop(
  cropWidthPx: number,
  cropHeightPx: number,
  maxEdge: number
): Dims {
  return fitWithinMaxEdge(cropWidthPx, cropHeightPx, maxEdge);
}
