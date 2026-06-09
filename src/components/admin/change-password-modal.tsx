"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { passwordSchema } from "@/lib/validations";

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
  username?: string;
}

export function ChangePasswordModal({ open, onClose, username }: ChangePasswordModalProps) {
  const locale = useLocale();
  const t = useTranslations("admin.changePassword");
  const tCommon = useTranslations("common");
  const tSidebar = useTranslations("admin.sidebar");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          signOut({ callbackUrl: `/${locale}/admin/login` });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdown > 0, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setErrors({});
    setSaving(false);
    setSuccess(false);
  }

  function handleClose() {
    if (success) return;
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    // Client-side validation
    if (newPassword === currentPassword) {
      setErrors({ newPassword: [t("samePassword")] });
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrors({ confirmPassword: [t("passwordMismatch")] });
      return;
    }

    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      setErrors({ newPassword: parsed.error.issues.map((i) => i.message) });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.details) {
          if (data.details.currentPassword) {
            setErrors({ currentPassword: [t("incorrectPassword")] });
          } else if (data.details.newPassword) {
            setErrors({ newPassword: [t("samePassword")] });
          } else {
            setErrors(data.details);
          }
        } else {
          setErrors({ form: [data.error || tCommon("errorGeneric")] });
        }
        return;
      }

      setSuccess(true);
      setCountdown(3);
    } catch {
      setErrors({ form: [tCommon("errorGeneric")] });
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const EyeOpen = (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );

  const EyeClosed = (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="change-password-title" className="mx-4 w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 shadow-xl sm:p-6" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 id="change-password-title" className="text-lg font-semibold text-gray-900">{t("title")}</h3>
            {username && (
              <p className="text-xs text-gray-500">{tSidebar("loggedInAs", { username })}</p>
            )}
          </div>
          {!success && (
            <button onClick={handleClose} className="flex h-10 w-10 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" aria-label={tCommon("close")}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {success ? (
          <div className="rounded-md bg-green-50 p-4 text-center text-sm font-medium text-green-700">
            <p>{t("success")}</p>
            <p className="mt-2 text-xs text-green-600">
              {t("redirecting", { seconds: countdown })}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errors.form && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{errors.form[0]}</div>
            )}

            {/* Current Password */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t("currentPassword")}
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-base focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  required
                  placeholder={t("currentPasswordPlaceholder")}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((p) => !p)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:text-gray-900"
                  aria-label={showCurrent ? tCommon("hidePassword") : tCommon("showPassword")}
                >
                  {showCurrent ? EyeClosed : EyeOpen}
                </button>
              </div>
              {errors.currentPassword && (
                <p className="mt-1 text-xs text-red-600">{errors.currentPassword[0]}</p>
              )}
            </div>

            {/* New Password */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t("newPassword")}
              </label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-base focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  required
                  placeholder={t("newPasswordPlaceholder")}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((p) => !p)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:text-gray-900"
                  aria-label={showNew ? tCommon("hidePassword") : tCommon("showPassword")}
                >
                  {showNew ? EyeClosed : EyeOpen}
                </button>
              </div>
              {errors.newPassword && (
                <div className="mt-1 space-y-0.5">
                  {errors.newPassword.map((err, i) => (
                    <p key={i} className="text-xs text-red-600">{err}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Confirm New Password */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t("confirmPassword")}
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-base focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  required
                  placeholder={t("confirmPasswordPlaceholder")}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((p) => !p)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:text-gray-900"
                  aria-label={showConfirm ? tCommon("hidePassword") : tCommon("showPassword")}
                >
                  {showConfirm ? EyeClosed : EyeOpen}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600">{errors.confirmPassword[0]}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {saving ? t("saving") : t("submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
