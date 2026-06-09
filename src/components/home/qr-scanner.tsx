"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";

export function HomeQrScanner() {
  const locale = useLocale();
  const t = useTranslations("customer");

  const [scannerActive, setScannerActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);

  const toggleScanner = useCallback(async () => {
    if (scannerActive) {
      try {
        await scannerRef.current?.stop();
      } catch {
        // Ignore stop errors
      }
      scannerRef.current = null;
      setScannerActive(false);
      return;
    }

    setScannerActive(true);
    setError(null);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("home-qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          scanner.stop().catch(() => {});
          scannerRef.current = null;
          setScannerActive(false);

          // QR codes contain full URLs like https://host/th/table/TOKEN
          const trimmed = decodedText.trim();
          const tableMatch = /\/table\/([A-Za-z0-9_-]+)/.exec(trimmed);
          if (tableMatch) {
            const token = tableMatch[1];
            window.location.href = `/${locale}/table/${token}`;
          } else {
            setError(t("invalidTableMessage"));
          }
        },
        () => {
          // Scan failure per frame — ignore
        }
      );
    } catch {
      setScannerActive(false);
      setError(t("cameraError"));
    }
  }, [scannerActive, locale, t]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
  }, []);

  return (
    <div>
      <button
        type="button"
        onClick={toggleScanner}
        className={`flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          scannerActive
            ? "bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-500"
            : "bg-primary-500 text-white hover:bg-primary-600 focus:ring-primary-500"
        }`}
      >
        {scannerActive ? (
          <>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {t("closeCamera")}
          </>
        ) : (
          <>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            {t("openCamera")}
          </>
        )}
      </button>

      {/* QR reader container */}
      <div
        id="home-qr-reader"
        className={`mt-3 overflow-hidden rounded-xl ${scannerActive ? "" : "hidden"}`}
      />

      {/* Scan hint */}
      {scannerActive && (
        <p className="mt-2 text-center text-xs text-gray-400">
          {t("scanHint")}
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="mt-2 text-center text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
