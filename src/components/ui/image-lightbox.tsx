"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

interface ImageLightboxProps {
  src: string;
  alt: string;
  caption?: string;
  onClose: () => void;
}

/**
 * Full-screen "tap to enlarge" view for a customer menu photo. Follows the
 * app's modal contract (mirrors `item-options-sheet.tsx`): `role="dialog"` +
 * `aria-modal`, focus the close button on open, lock body scroll, Escape /
 * backdrop / ✕ to close, and restore focus to the triggering element on close.
 * Uses a plain <img> with `object-contain` so the WHOLE dish shows (an arbitrary
 * R2 image has no fixed box; `next/image fill` would force one).
 */
export function ImageLightbox({ src, alt, caption, onClose }: ImageLightboxProps) {
  const tCommon = useTranslations("common");
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // The caller passes a STABLE onClose (useCallback), so this effect runs once
  // on mount / once on unmount — a re-render while the lightbox is open won't
  // re-run it (which would re-capture `previouslyFocused` wrong / re-lock scroll).
  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={tCommon("close")}
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] max-w-full rounded-lg object-contain"
      />
      {caption && (
        <p className="mt-4 text-center text-sm font-medium text-white">{caption}</p>
      )}
    </div>
  );
}
