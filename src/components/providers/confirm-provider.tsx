"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

/**
 * Bespoke replacement for the native blocking `window.confirm()`.
 *
 * Native confirm is synchronous; this is promise-based so call sites read
 * `if (await confirm({ message }))` — the surrounding logic stays identical to
 * the `if (confirm(msg))` they replaced. A single <ConfirmDialog> is mounted at
 * the app root (see [locale]/layout.tsx) and driven by this context, so no
 * component needs to render its own modal markup.
 *
 * Styling mirrors the existing admin modals (change-password-modal.tsx): a
 * fixed full-screen scrim, a centered card, 44px touch targets, primary-themed
 * buttons, Escape-to-cancel. `tone: "danger"` (the default for the destructive
 * delete/decline/remove/deactivate call sites) paints the confirm button red;
 * `tone: "default"` uses the brand primary for non-destructive confirmations.
 */

export interface ConfirmOptions {
  /** Body text of the dialog (required). */
  message: string;
  /** Optional heading shown above the message. */
  title?: string;
  /** Label for the confirm button. Defaults to common.confirm. */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to common.cancel. */
  cancelLabel?: string;
  /** "danger" (default) → red confirm button; "default" → primary. */
  tone?: "danger" | "default";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface DialogState extends ConfirmOptions {
  resolve: (result: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const tCommon = useTranslations("common");
  const [state, setState] = useState<DialogState | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  // The element focused before the dialog opened, so focus can be restored to
  // the trigger when it closes (a keyboard/SR user shouldn't be dumped on <body>).
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (result: boolean) => {
      setState((prev) => {
        prev?.resolve(result);
        return null;
      });
    },
    []
  );

  // Lock body scroll + focus the confirm button + Escape-to-cancel while open
  // (mirrors locale-switcher.tsx). Focus lands on confirm so keyboard users can
  // accept with Enter, matching the native dialog's default-action behaviour.
  // Tab is trapped between the two buttons (aria-modal asserts the background is
  // inert — without a trap, Tab would wander into it), and focus is restored to
  // the triggering element on close.
  useEffect(() => {
    if (!state) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    confirmButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close(false);
        return;
      }
      if (e.key === "Tab") {
        // Only two focusable controls; cycle between them so focus can't escape
        // the dialog into the (inert) background.
        const cancel = cancelButtonRef.current;
        const confirmBtn = confirmButtonRef.current;
        if (!cancel || !confirmBtn) return;
        e.preventDefault();
        const active = document.activeElement;
        if (e.shiftKey) {
          (active === confirmBtn ? cancel : confirmBtn).focus();
        } else {
          (active === cancel ? confirmBtn : cancel).focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    };
  }, [state, close]);

  const tone = state?.tone ?? "danger";
  const confirmClasses =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-700"
      : "bg-primary-500 hover:bg-primary-600 focus-visible:ring-primary-700";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          style={{ animation: "fadeIn 150ms ease-out" }}
        >
          {/* Backdrop — click to cancel */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => close(false)}
            className="absolute inset-0 cursor-default"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={state.title ? "confirm-title" : undefined}
            aria-describedby="confirm-message"
            className="relative mx-4 w-full max-w-sm rounded-lg bg-white p-5 shadow-xl sm:p-6"
            style={{ animation: "scaleIn 150ms cubic-bezier(0.16, 1, 0.3, 1)" }}
          >
            {state.title && (
              <h3
                id="confirm-title"
                className="mb-2 text-lg font-semibold text-gray-900"
              >
                {state.title}
              </h3>
            )}
            <p
              id="confirm-message"
              className="text-sm text-gray-600 whitespace-pre-line"
            >
              {state.message}
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => close(false)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              >
                {state.cancelLabel ?? tCommon("cancel")}
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                onClick={() => close(true)}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${confirmClasses}`}
              >
                {state.confirmLabel ?? tCommon("confirm")}
              </button>
            </div>
          </div>

          {/* Keyframes (scoped) — same easing as locale-switcher.tsx */}
          <style jsx>{`
            @keyframes fadeIn {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
            @keyframes scaleIn {
              from {
                opacity: 0;
                transform: scale(0.95);
              }
              to {
                opacity: 1;
                transform: scale(1);
              }
            }
          `}</style>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async `confirm(opts) => Promise<boolean>`. Replaces native
 * `window.confirm()`. Must be used within a <ConfirmProvider>.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
