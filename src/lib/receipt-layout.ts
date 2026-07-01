/**
 * Pure, DOM-free layout math for the downloadable post-checkout receipt. Kept
 * separate from the canvas rendering (`receipt-canvas.ts`) so the geometry is
 * unit-testable in jsdom (which has no canvas / no `measureText`). Mirrors the
 * `image-processing.ts` (pure) + `image-canvas.ts` (thin DOM wrapper) split.
 *
 * The caller pre-resolves every display value to a plain string (money via
 * `formatMoneyWith`, option notes via `resolveOptionName`, table/takeaway label,
 * date) so this module needs neither `Intl` nor a canvas. Text wrapping uses a
 * deterministic character-width ESTIMATE (not `measureText`), and the canvas
 * wrapper reuses the same estimator so wrapping never disagrees with rendering.
 *
 * See docs/superpowers/specs/2026-07-01-downloadable-receipt-design.md.
 */

export interface ReceiptLineItem {
  qty: number;
  /** Localized dish name, already resolved to the viewer's locale. */
  name: string;
  /** Rendered option snapshot (e.g. "Size: Large +RM2"); "" when none. */
  options: string;
  /** Formatted line price (unitPrice × qty), e.g. "RM24.00". */
  price: string;
}

export interface ReceiptOrder {
  /** e.g. "Order #1". */
  title: string;
  items: ReceiptLineItem[];
  /** Formatted order subtotal. */
  subtotal: string;
}

export interface ReceiptData {
  appName: string;
  logoUrl: string | null;
  /** "Table 5" or "Takeaway" — resolved by the caller. */
  locationLabel: string;
  dateLabel: string;
  /** Non-declined orders only (caller filters). */
  orders: ReceiptOrder[];
  /** Localized "Grand Total" label. */
  grandTotalLabel: string;
  /** Formatted grand total. */
  grandTotal: string;
  /** Localized thank-you subtitle. */
  thankYouNote: string;
  /** Localized "Subtotal" label used per order. */
  subtotalLabel: string;
}

export interface ReceiptLayoutOptions {
  /** Content width in CSS px. Default 720. */
  width?: number;
  /** Horizontal padding in CSS px. Default 40. */
  padding?: number;
}

export type DrawOp =
  | { type: "text"; x: number; y: number; text: string; font: FontSpec; align: "left" | "right" | "center"; color: string }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { type: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { type: "logoSlot"; x: number; y: number; w: number; h: number };

export interface FontSpec {
  size: number;
  weight: "normal" | "bold";
}

export interface ReceiptLayout {
  width: number;
  height: number;
  ops: DrawOp[];
}

const INK = "#111827"; // gray-900
const MUTED = "#6B7280"; // gray-500
const FAINT = "#9CA3AF"; // gray-400
const RULE = "#E5E7EB"; // gray-200
const BG = "#FFFFFF";

/**
 * Deterministic width estimate for `text` at `fontSizePx`, in CSS px. Uses a
 * simple average-glyph model (wide-ish so wrapping errs toward more lines, never
 * clipping). CJK/Thai glyphs are counted as full-width. Shared with the canvas
 * wrapper so wrapping matches rendering.
 */
export function estimateTextWidth(text: string, fontSizePx: number): number {
  let units = 0;
  for (const ch of text) {
    // Roughly: CJK/fullwidth glyphs ~1em, others ~0.55em.
    units += isWideGlyph(ch) ? 1 : 0.55;
  }
  return units * fontSizePx;
}

function isWideGlyph(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+
  );
}

/**
 * Word-wrap `text` to at most `maxWidth` CSS px at `fontSizePx`. Splits on spaces;
 * a single token longer than `maxWidth` is hard-broken by characters so it never
 * overflows. Returns at least one line (possibly empty string for empty input).
 */
export function wrapText(text: string, maxWidth: number, fontSizePx: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontSizePx) <= maxWidth || !current) {
      // Fits, or `current` is empty (must place at least this word).
      if (estimateTextWidth(candidate, fontSizePx) <= maxWidth) {
        current = candidate;
        continue;
      }
      // Single word wider than the line: hard-break it by characters.
      const broken = hardBreak(word, maxWidth, fontSizePx);
      // All but the last fragment become their own full lines.
      for (let i = 0; i < broken.length - 1; i++) lines.push(broken[i]);
      current = broken[broken.length - 1];
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function hardBreak(word: string, maxWidth: number, fontSizePx: number): string[] {
  const out: string[] = [];
  let chunk = "";
  for (const ch of word) {
    const candidate = chunk + ch;
    if (chunk && estimateTextWidth(candidate, fontSizePx) > maxWidth) {
      out.push(chunk);
      chunk = ch;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) out.push(chunk);
  return out.length ? out : [word];
}

/**
 * Lay out a receipt into a content-sized canvas description. Single-column
 * vertical flow; height is computed from the final cursor so nothing clips.
 * Always emits BOTH a `logoSlot` op (the wrapper fills it if the logo loads) and
 * the app-name text header (always present, logo-independent).
 */
export function layoutReceipt(data: ReceiptData, options: ReceiptLayoutOptions = {}): ReceiptLayout {
  const width = options.width ?? 720;
  const pad = options.padding ?? 40;
  const contentW = width - pad * 2;
  const left = pad;
  const right = width - pad;

  const ops: DrawOp[] = [];
  let y = pad;

  // --- Header: logo slot + app name ---
  const LOGO_H = 96;
  const logoW = 96;
  ops.push({ type: "logoSlot", x: (width - logoW) / 2, y, w: logoW, h: LOGO_H });
  y += LOGO_H + 16;

  ops.push({
    type: "text",
    x: width / 2,
    y,
    text: data.appName,
    font: { size: 28, weight: "bold" },
    align: "center",
    color: INK,
  });
  y += 34;

  // Location + date line.
  ops.push({
    type: "text",
    x: width / 2,
    y,
    text: `${data.locationLabel} · ${data.dateLabel}`,
    font: { size: 15, weight: "normal" },
    align: "center",
    color: MUTED,
  });
  y += 30;

  // Divider.
  y = pushRule(ops, left, right, y);
  y += 18;

  // --- Orders ---
  for (const order of data.orders) {
    ops.push({
      type: "text",
      x: left,
      y,
      text: order.title,
      font: { size: 16, weight: "bold" },
      align: "left",
      color: INK,
    });
    y += 26;

    for (const item of order.items) {
      const qtyName = `${item.qty}×  ${item.name}`;
      // Reserve room on the right for the price so the name column wraps clear of it.
      const priceW = estimateTextWidth(item.price, 15) + 16;
      const nameMaxW = contentW - priceW;
      const nameLines = wrapText(qtyName, nameMaxW, 15);

      nameLines.forEach((line, i) => {
        ops.push({
          type: "text",
          x: left,
          y,
          text: line,
          font: { size: 15, weight: "normal" },
          align: "left",
          color: INK,
        });
        if (i === 0) {
          // Price aligned right on the first line of the item.
          ops.push({
            type: "text",
            x: right,
            y,
            text: item.price,
            font: { size: 15, weight: "normal" },
            align: "right",
            color: INK,
          });
        }
        y += 22;
      });

      if (item.options) {
        const optLines = wrapText(item.options, contentW - 20, 13);
        for (const line of optLines) {
          ops.push({
            type: "text",
            x: left + 20,
            y,
            text: line,
            font: { size: 13, weight: "normal" },
            align: "left",
            color: FAINT,
          });
          y += 18;
        }
      }
      y += 4;
    }

    // Order subtotal row.
    y += 4;
    ops.push({
      type: "text",
      x: left,
      y,
      text: data.subtotalLabel,
      font: { size: 13, weight: "normal" },
      align: "left",
      color: MUTED,
    });
    ops.push({
      type: "text",
      x: right,
      y,
      text: order.subtotal,
      font: { size: 14, weight: "bold" },
      align: "right",
      color: INK,
    });
    y += 26;

    y = pushRule(ops, left, right, y);
    y += 16;
  }

  // --- Grand total ---
  const GT_H = 56;
  ops.push({ type: "rect", x: left, y, w: contentW, h: GT_H, color: "#F0FDF4" }); // primary-50-ish
  ops.push({
    type: "text",
    x: left + 16,
    y: y + GT_H / 2 + 6,
    text: data.grandTotalLabel,
    font: { size: 17, weight: "bold" },
    align: "left",
    color: INK,
  });
  ops.push({
    type: "text",
    x: right - 16,
    y: y + GT_H / 2 + 7,
    text: data.grandTotal,
    font: { size: 20, weight: "bold" },
    align: "right",
    color: "#15803D", // primary-700-ish
  });
  y += GT_H + 24;

  // --- Thank-you footer ---
  const noteLines = wrapText(data.thankYouNote, contentW, 14);
  for (const line of noteLines) {
    ops.push({
      type: "text",
      x: width / 2,
      y,
      text: line,
      font: { size: 14, weight: "normal" },
      align: "center",
      color: MUTED,
    });
    y += 20;
  }

  y += pad; // bottom padding

  return { width, height: Math.ceil(y), ops };
}

function pushRule(ops: DrawOp[], x1: number, x2: number, y: number): number {
  ops.push({ type: "line", x1, y1: y, x2, y2: y, color: RULE });
  return y;
}

export const RECEIPT_BG = BG;
