"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

interface QrDisplayProps {
  tableId: number;
  tableNumber: number;
  onClose: () => void;
}

export function QrDisplay({
  tableId,
  tableNumber,
  onClose,
}: QrDisplayProps) {
  const t = useTranslations("admin.tables");
  const tCommon = useTranslations("common");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    async function generate() {
      try {
        const res = await fetch(`/api/tables/${tableId}/qr-token`);
        if (!res.ok) throw new Error("Failed to get signed token");
        const { signedToken } = await res.json();
        const baseUrl = window.location.origin;
        const url = `${baseUrl}/table/${signedToken}`;
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
        setQrDataUrl(dataUrl);
      } catch {
        setError(t("failedToGenerateQr"));
      }
    }
    generate();
  }, [tableId, t]);

  const handleDownload = useCallback(() => {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.download = `qr-table-${tableNumber}.png`;
    link.href = qrDataUrl;
    link.click();
  }, [qrDataUrl, tableNumber]);

  const handlePrint = useCallback(() => {
    if (!qrDataUrl) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const label = t("tableLabel", { number: tableNumber });
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${label}</title>
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              font-family: sans-serif;
            }
            h1 { font-size: 24px; margin-bottom: 16px; }
            img { max-width: 300px; }
          </style>
        </head>
        <body>
          <h1>${label}</h1>
          <img src="${qrDataUrl}" alt="${label}" />
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }, [qrDataUrl, tableNumber, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="qr-display-title" className="relative mx-4 w-full max-w-sm overflow-y-auto rounded-lg bg-white p-6 shadow-xl" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          aria-label={tCommon("close")}
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

        <h2 id="qr-display-title" className="mb-4 text-center text-lg font-semibold text-gray-900">
          {t("tableLabel", { number: tableNumber })}
        </h2>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-center text-sm text-red-700">
            {error}
          </div>
        )}

        {qrDataUrl ? (
          <div className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={t("tableLabel", { number: tableNumber })}
              className="mb-4 w-full max-w-[300px] rounded-md border border-gray-200"
            />
            <div className="flex w-full gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                {t("download")}
              </button>
              <button
                onClick={handlePrint}
                className="flex-1 inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                {t("print")}
              </button>
            </div>
          </div>
        ) : (
          !error && (
            <div className="flex aspect-square w-full max-w-[300px] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-primary-500" />
            </div>
          )
        )}
      </div>
    </div>
  );
}
