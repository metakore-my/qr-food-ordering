"use client";

/**
 * Thin, client-only canvas wrapper that paints a `ReceiptData` into a PNG Blob for
 * the post-checkout "Download receipt" button. The layout geometry lives in the
 * pure, unit-tested `receipt-layout.ts`; this file is the untestable DOM boundary
 * (jsdom has no real canvas), browser-verified — mirroring `image-canvas.ts`.
 */

import { layoutReceipt, RECEIPT_BG, type ReceiptData, type DrawOp, type FontSpec } from "@/lib/receipt-layout";

/** Same font stack the app renders with, so Thai/CJK dish names encode correctly. */
const FONT_STACK = '"Noto Sans Thai", "Noto Sans", system-ui, -apple-system, sans-serif';

function cssFont(font: FontSpec): string {
  return `${font.weight === "bold" ? "700" : "400"} ${font.size}px ${FONT_STACK}`;
}

/**
 * Load an image with anonymous CORS. Resolves only on a clean, untainted load, so
 * anything drawn from the resolved element is safe to read back via `toBlob`. Any
 * failure (network, 403, missing CORS headers) rejects and the caller renders
 * without the logo.
 */
function loadImageCors(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo load failed"));
    img.src = src;
  });
}

/** "contain"-fit `(iw, ih)` inside `(bw, bh)`, centered; returns dest rect. */
function containFit(iw: number, ih: number, bx: number, by: number, bw: number, bh: number) {
  if (iw <= 0 || ih <= 0) return { x: bx, y: by, w: bw, h: bh };
  const scale = Math.min(bw / iw, bh / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h };
}

/**
 * Render `data` to a PNG Blob. Tries to draw `data.logoUrl` into its reserved slot;
 * if the logo can't be loaded cleanly it's skipped and the app-name text header
 * (always emitted by the layout) stands alone. Rejects only if the canvas context
 * or the final PNG encode is unavailable — the caller surfaces a localized error.
 */
export async function renderReceiptToPngBlob(
  data: ReceiptData,
  opts: { pixelRatio?: number } = {}
): Promise<Blob> {
  const { width, height, ops } = layoutReceipt(data);
  const dpr = Math.max(1, Math.min(opts.pixelRatio ?? getDevicePixelRatio(), 3));

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(dpr, dpr);
  ctx.textBaseline = "alphabetic";

  // Background.
  ctx.fillStyle = RECEIPT_BG;
  ctx.fillRect(0, 0, width, height);

  // Attempt the logo (optional). A clean anonymous-CORS load is untainted, so the
  // later toBlob() stays safe. On failure we simply don't fill the slot.
  let logo: HTMLImageElement | null = null;
  if (data.logoUrl) {
    try {
      logo = await loadImageCors(data.logoUrl);
    } catch {
      logo = null;
    }
  }

  for (const op of ops) {
    paintOp(ctx, op, logo);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Receipt PNG encode failed"))),
      "image/png"
    );
  });
}

function paintOp(ctx: CanvasRenderingContext2D, op: DrawOp, logo: HTMLImageElement | null): void {
  switch (op.type) {
    case "rect":
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      return;
    case "line":
      ctx.strokeStyle = op.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1 + 0.5);
      ctx.lineTo(op.x2, op.y2 + 0.5);
      ctx.stroke();
      return;
    case "text":
      ctx.fillStyle = op.color;
      ctx.font = cssFont(op.font);
      ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y);
      return;
    case "logoSlot":
      if (logo) {
        const fit = containFit(logo.naturalWidth, logo.naturalHeight, op.x, op.y, op.w, op.h);
        ctx.drawImage(logo, fit.x, fit.y, fit.w, fit.h);
      }
      return;
  }
}

function getDevicePixelRatio(): number {
  return typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 2;
}
