"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Cropper, { type Area } from "react-easy-crop";
import { renderCropToWebpBlob } from "@/lib/image-canvas";

interface ImageCropModalProps {
  /** Object URL of the just-picked file. */
  imageSrc: string;
  /** Called with the cropped+encoded WebP blob when the operator confirms. */
  onConfirm: (blob: Blob) => void;
  /** Called when the operator cancels (return to dropzone, no upload). */
  onCancel: () => void;
}

export function ImageCropModal({ imageSrc, onConfirm, onCancel }: ImageCropModalProps) {
  const t = useTranslations("imageUpload");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDivElement>(null);
  // Restore focus to the element that opened the modal on close (matches the
  // options-sheet modal contract — otherwise focus is dumped to <body>).
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The caller passes a STABLE onCancel (useCallback), so this effect runs once
  // on mount / once on unmount — a re-render while the cropper is open (e.g. a
  // dragOver toggle on the dropzone behind the modal) won't re-run it (which
  // would re-capture `previouslyFocused` wrong / re-lock scroll).
  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    };
  }, [onCancel]);

  const onCropComplete = useCallback((_: Area, areaPx: Area) => {
    setAreaPixels(areaPx);
  }, []);

  async function handleConfirm() {
    if (!areaPixels) return;
    setProcessing(true);

    // Resolve the blob to upload, then call onConfirm exactly ONCE, outside the
    // try/catch — so a throwing parent callback can't be mistaken for a
    // processing failure and re-fire onConfirm with the original file.
    let blob: Blob | null = null;
    try {
      blob = await renderCropToWebpBlob(imageSrc, areaPixels);
    } catch {
      // Crop/encode failed — fall back to the original file. Guard the fallback
      // too: if even that fails (object URL revoked, fetch error), surface an
      // error and re-enable the button instead of an unhandled rejection.
      try {
        blob = await fetch(imageSrc).then((r) => r.blob());
      } catch {
        blob = null;
      }
    } finally {
      setProcessing(false);
    }

    if (blob) {
      onConfirm(blob);
    } else {
      setError(t("uploadFailed"));
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("cropTitle")}
        tabIndex={-1}
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 p-4">
          <h3 className="text-base font-semibold text-gray-900">{t("cropTitle")}</h3>
          <p className="mt-0.5 text-sm text-gray-500">{t("cropHint")}</p>
        </div>

        <div className="relative h-72 w-full bg-gray-900">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={4 / 3}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="space-y-4 p-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500" aria-hidden>🔍</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label={t("cropZoom")}
              className="h-2 flex-1 cursor-pointer accent-primary-500"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] flex-1 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!areaPixels || processing}
              className="min-h-[44px] flex-1 rounded-lg bg-primary-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
            >
              {processing ? t("cropProcessing") : t("cropConfirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
