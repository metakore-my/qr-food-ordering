"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/providers/confirm-provider";
import { useConfig } from "@/components/providers/config-provider";

type Banner = { kind: "success" | "error"; text: string } | null;

// Mirror the server's MAX_RESTORE_BODY_BYTES — reject an oversized file in the
// browser before reading it, so neither side OOMs on a huge/corrupt upload.
const MAX_RESTORE_FILE_BYTES = 10 * 1024 * 1024;

export function MenuBackupCard() {
  const t = useTranslations("admin.settings.backup");
  const router = useRouter();
  const confirm = useConfirm();
  const { appName } = useConfig();

  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  async function handleDownload() {
    setBanner(null);
    setDownloading(true);
    try {
      const res = await fetch("/api/admin/menu/backup");
      if (!res.ok) {
        setBanner({ kind: "error", text: t("downloadError") });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const slug =
        appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) ||
        "menu";
      const datePart = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = `menu-backup-${slug}-${datePart}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setBanner({ kind: "error", text: t("downloadError") });
    } finally {
      setDownloading(false);
    }
  }

  function restoreErrorText(code: string): string {
    switch (code) {
      case "INVALID_BACKUP":
      case "INVALID_JSON":
        return t("restoreInvalidFile");
      case "INVALID_PRICE":
        return t("restoreInvalidPrice");
      case "INVALID_OPTIONS":
        return t("restoreInvalidOptions");
      case "MISSING_CANONICAL":
        return t("restoreMissingCanonical");
      case "EMPTY_ITEM_NAME":
        return t("restoreEmptyName");
      case "BACKUP_TOO_LARGE":
        return t("restoreTooLarge");
      default:
        return t("restoreError");
    }
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again re-triggers onChange.
    e.target.value = "";
    if (!file) return;

    setBanner(null);

    // Reject an oversized file before reading it into memory — mirrors the
    // server's MAX_RESTORE_BODY_BYTES (10 MB) cap so the browser tab can't OOM
    // on a huge/corrupt file either. Any real menu backup is well under 1 MB.
    if (file.size > MAX_RESTORE_FILE_BYTES) {
      setBanner({ kind: "error", text: t("restoreTooLarge") });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setBanner({ kind: "error", text: t("restoreInvalidFile") });
      return;
    }

    const ok = await confirm({
      title: t("confirmTitle"),
      message: t("confirmBody"),
      tone: "danger",
      confirmLabel: t("confirmAccept"),
    });
    if (!ok) return;

    setRestoring(true);
    try {
      const res = await fetch("/api/admin/menu/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ kind: "error", text: restoreErrorText(data?.error ?? "") });
        return;
      }
      const dropped = data.droppedTranslations ?? 0;
      const successText = t("restoreSuccess", {
        categories: data.restored?.categories ?? 0,
        items: data.restored?.items ?? 0,
      });
      setBanner({
        kind: "success",
        // Surface dropped orphan-locale rows so the drop is never silent.
        text: dropped > 0 ? `${successText} ${t("restoreDropped", { count: dropped })}` : successText,
      });
      router.refresh();
    } catch {
      setBanner({ kind: "error", text: t("restoreError") });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-gray-900">{t("title")}</h2>
      <p className="mt-1.5 text-sm text-gray-600">{t("description")}</p>

      {banner && (
        <div
          role="status"
          className={`mt-4 rounded-xl border p-3 text-sm font-medium ${
            banner.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {banner.text}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading || restoring}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {downloading ? t("downloading") : t("download")}
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={downloading || restoring}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {restoring ? t("restoring") : t("restore")}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFilePicked}
          className="hidden"
        />
      </div>
      <p className="mt-2 text-xs text-gray-500">{t("restoreHint")}</p>
    </section>
  );
}
