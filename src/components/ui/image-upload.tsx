"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/providers/confirm-provider";
import { ImageCropModal } from "@/components/ui/image-crop-modal";

interface ImageUploadProps {
  value?: string;
  onUpload: (url: string) => void;
  onRemove?: () => void;
  /**
   * Notifies the parent whether the LAST upload attempt failed (true) or the
   * control is in a clean state (false — after a successful upload, a removal, or
   * a client-side validation rejection that didn't reach the network). Lets a
   * parent form block its "Saved" success toast when an embedded upload silently
   * failed (e.g. an R2 CORS rejection), instead of reporting success.
   */
  onError?: (failed: boolean) => void;
  className?: string;
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export function ImageUpload({
  value,
  onUpload,
  onRemove,
  onError,
  className = "",
}: ImageUploadProps) {
  const t = useTranslations("imageUpload");
  const confirm = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  // Object URL of a just-picked file awaiting crop; non-null = cropper open.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  // R2 PUT progress 0–100 (null when not uploading).
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke a pending crop object URL if this control unmounts while the cropper
  // is still open (the onConfirm/onCancel revokes only fire if the user finishes
  // the crop). revokeObjectURL on an already-revoked URL is a harmless no-op, so
  // this is safe alongside those inline revokes.
  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  // A picked/dropped file is TYPE-checked here, then opens the cropper; the
  // cropper returns a processed WebP Blob to uploadBlob. (Size is validated on
  // the processed blob, not the original — a large original is shrunk first.)
  const openCropperFor = useCallback(
    (file: File) => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError(t("invalidFileType"));
        onError?.(true);
        return;
      }
      setError(null);
      setCropSrc(URL.createObjectURL(file));
    },
    [t, onError]
  );

  const uploadBlob = useCallback(
    async (blob: Blob) => {
      if (blob.size > MAX_SIZE) {
        setError(t("fileTooLarge"));
        onError?.(true);
        return;
      }

      setError(null);
      setUploading(true);
      setProgress(0);

      // Show local preview immediately
      const localPreview = URL.createObjectURL(blob);
      setPreview(localPreview);

      try {
        // Request presigned URL (always WebP — the cropper re-encodes to WebP)
        const presignedRes = await fetch("/api/upload/presigned-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "image/webp",
            fileSize: blob.size,
          }),
        });

        if (!presignedRes.ok) {
          const data = await presignedRes.json();
          throw new Error(data.error || t("failedToGetUrl"));
        }

        const { uploadUrl, publicUrl } = await presignedRes.json();

        // Upload directly to R2 via XHR so we get real upload progress
        // (fetch doesn't expose upload progress).
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", "image/webp");
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              setProgress(Math.round((ev.loaded / ev.total) * 100));
            }
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(t("failedToUpload")));
          xhr.onerror = () => reject(new Error(t("failedToUpload")));
          xhr.send(blob);
        });

        onUpload(publicUrl);
        onError?.(false); // upload succeeded — clear any prior failure flag
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("uploadFailed")
        );
        setPreview(null);
        onError?.(true); // upload failed — tell the parent so it can block "Saved"
      } finally {
        setUploading(false);
        setProgress(null);
        URL.revokeObjectURL(localPreview);
      }
    },
    [onUpload, onError, t]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        openCropperFor(file);
      }
      // Reset input so the same file can be selected again
      e.target.value = "";
    },
    [openCropperFor]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        openCropperFor(file);
      }
    },
    [openCropperFor]
  );

  // Stable handlers for the crop modal so its mount/unmount effect isn't re-run
  // by unrelated ImageUpload re-renders (e.g. dragOver toggles) while it's open.
  const handleCropConfirm = useCallback(
    (blob: Blob) => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
      uploadBlob(blob);
    },
    [cropSrc, uploadBlob]
  );

  const handleCropCancel = useCallback(() => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }, [cropSrc]);

  const handleRemove = useCallback(async () => {
    if (!(await confirm({ message: t("confirmRemoveImage") }))) return;
    setPreview(null);
    setError(null);
    onError?.(false); // removal is a clean state — clear any prior failure flag
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    onRemove?.();
  }, [onRemove, onError, t, confirm]);

  const displayImage = value || preview;

  // Image preview state
  if (displayImage) {
    return (
      <div className={`relative ${className}`}>
        <div className="relative overflow-hidden rounded-lg border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayImage}
            alt={t("uploadedImageAlt")}
            className="h-48 w-full object-cover"
          />
          {uploading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
              <svg
                className="h-8 w-8 animate-spin text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              {progress !== null && (
                <span className="mt-2 text-sm font-medium text-white">{progress}%</span>
              )}
            </div>
          )}
        </div>
        {!uploading && (
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition-colors hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            aria-label={t("removeImage")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
      </div>
    );
  }

  // Upload area state
  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
          dragOver
            ? "border-primary-500 bg-primary-50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        {uploading ? (
          <svg
            className="mb-3 h-8 w-8 animate-spin text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg
            className="mb-3 h-8 w-8 text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21zm7.5-12.75a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
            />
          </svg>
        )}
        <p className="mb-1 text-sm font-medium text-gray-600">
          {uploading ? t("uploading") : t("clickOrDrag")}
        </p>
        <p className="text-xs text-gray-400">
          {t("fileTypeHint")}
        </p>
        {/* Guidance toward a crisp, correctly-framed photo: landscape 4:3 at
            ~1200×900 stays sharp on a high-DPI phone and avoids the portrait
            center-crop that hides the dish (the card box is landscape 4:3). */}
        <p className="mt-1 text-center text-xs text-gray-400">
          {t("dimensionHint")}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
        aria-label={t("uploadImage")}
      />
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
      {cropSrc && (
        <ImageCropModal
          imageSrc={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}
