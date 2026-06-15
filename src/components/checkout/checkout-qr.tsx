"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface CheckoutQrProps {
  tableToken: string;
}

export function CheckoutQr({ tableToken }: CheckoutQrProps) {
  const t = useTranslations("checkout");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function generate() {
      try {
        const QRCode = (await import("qrcode")).default;
        // Encode as /table/TOKEN path so the checkout scanner can extract the token
        const qrValue = `/table/${tableToken}`;
        const dataUrl = await QRCode.toDataURL(qrValue, {
          width: 250,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
        });
        setQrDataUrl(dataUrl);
      } catch {
        setError(t("failedToGenerateQr"));
      }
    }
    generate();
  }, [tableToken, t]);

  return (
    <div className="flex flex-col items-center rounded-xl bg-white p-6 shadow-sm">
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-center text-sm text-red-700">
          {error}
        </div>
      )}

      {qrDataUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={t("checkoutQrAlt")}
            className="w-full max-w-[250px] rounded-lg border border-gray-200"
          />
          <p className="mt-4 text-center text-sm font-medium text-gray-600">
            {t("showQr")}
          </p>
        </>
      ) : (
        !error && (
          <div className="flex aspect-square w-full max-w-[250px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-primary-500" />
          </div>
        )
      )}
    </div>
  );
}
