"use client";

import { outputDimsForCrop } from "@/lib/image-processing";

/** A crop rectangle in SOURCE-image pixels (react-easy-crop's `croppedAreaPixels`). */
export interface CropAreaPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for cropping"));
    img.src = src;
  });
}

/**
 * Render the crop region to a canvas capped at `maxEdge`, encode as WebP, and
 * resolve with the Blob. Rejects if image load, canvas context, or encode fails
 * — the caller (`image-upload`) falls back to the original file on rejection so a
 * processing bug never blocks a save.
 *
 * Not unit-tested: jsdom has no real canvas. Verified manually in the browser
 * (see the plan's verification task). The sizing math it relies on lives in the
 * pure, tested `image-processing.ts`.
 */
export async function renderCropToWebpBlob(
  imageSrc: string,
  crop: CropAreaPixels,
  maxEdge = 1600,
  quality = 0.82
): Promise<Blob> {
  const img = await loadImage(imageSrc);
  const { width, height } = outputDimsForCrop(crop.width, crop.height, maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Draw the source crop rectangle into the full (possibly downscaled) canvas.
  ctx.drawImage(
    img,
    crop.x, crop.y, crop.width, crop.height, // source rect
    0, 0, width, height // destination rect
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null"))),
      "image/webp",
      quality
    );
  });
}
