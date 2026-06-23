"use client";

import { useTranslations } from "next-intl";
import { useOrderAlertSound } from "@/hooks/use-order-alert-sound";
import { ORDER_ALERT_SOUNDS } from "@/lib/order-alert-prefs";

/**
 * Per-device order-alert sound controls — the SINGLE source of truth for this
 * UI. Rendered both on the SUPERADMIN Settings page (Notifications tab) and in
 * the sidebar-opened Notification-settings modal (reachable by ALL admins),
 * because the underlying pref is per-device (`localStorage` via
 * `useOrderAlertSound`), not a SUPERADMIN-only deployment setting.
 *
 * State lives in localStorage, applies instantly, and has NO Save button.
 * Toggling "enable" / selecting a sound / moving the slider doubles as the
 * browser autoplay-unlock gesture and previews the chime.
 */
export function NotificationSettings() {
  const t = useTranslations("admin.settings");
  const {
    enabled,
    overrideMute,
    volume,
    sound,
    unlocked,
    unlock,
    play,
    setEnabled,
    setOverrideMute,
    setVolume,
    setSound,
  } = useOrderAlertSound();

  async function handleToggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    if (next) {
      // This click is the user gesture — arm audio, then play a test chime.
      const ok = await unlock();
      if (ok) play();
    }
  }

  // Switch the selected sound and immediately preview it (the click is the
  // autoplay gesture; arm first if this is the first interaction on the page).
  async function handleSelectSound(id: string) {
    setSound(id);
    if (!unlocked) await unlock();
    // setSound writes to the store synchronously; play() reads it back and
    // reloads the new asset before playing, so the preview matches the choice.
    play();
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <SectionHeading title={t("soundSection")} />
        <p className="mb-5 text-sm text-gray-600">{t("soundSectionHint")}</p>

        {/* Master enable */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t("soundEnable")}</p>
            <p className="mt-0.5 text-sm text-gray-600">{t("soundEnableHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={handleToggleEnabled}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors before:absolute before:inset-x-0 before:-inset-y-[8px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
              enabled ? "bg-primary-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {enabled && (
          <>
            {/* Sound picker — choose which chime this device plays. Selecting
                one previews it. Stored per-device in localStorage. */}
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-semibold text-gray-900">
                {t("soundChoose")}
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ORDER_ALERT_SOUNDS.map((s) => {
                  const selected = sound === s.id;
                  return (
                    <label
                      key={s.id}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-all ${
                        selected
                          ? "border-primary-500 bg-primary-50 text-primary-800 shadow-sm"
                          : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="order-alert-sound"
                        value={s.id}
                        checked={selected}
                        onChange={() => handleSelectSound(s.id)}
                        className="sr-only"
                      />
                      <span aria-hidden="true">🔔</span>
                      <span>{t(s.labelKey)}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-sm text-gray-600">{t("soundChooseHint")}</p>
            </fieldset>

            {/* Override mute */}
            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {t("soundOverrideMute")}
                </p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {t("soundOverrideMuteHint")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={overrideMute}
                onClick={() => setOverrideMute(!overrideMute)}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors before:absolute before:inset-x-0 before:-inset-y-[8px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                  overrideMute ? "bg-primary-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    overrideMute ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Volume slider — per-device, defaults to MAX for the noisy F&B
                floor. Plays a test chime on release so staff hear the level.
                The range input itself is the user gesture, so we arm on change. */}
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="sound-volume" className="text-sm font-semibold text-gray-900">
                  {t("soundVolume")}
                </label>
                <span className="text-sm font-medium text-gray-600">
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <input
                id="sound-volume"
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                onPointerUp={async () => {
                  // Preview the chosen level on release (arm first if needed).
                  if (!unlocked) await unlock();
                  play();
                }}
                onKeyUp={async (e) => {
                  if (e.key.startsWith("Arrow")) {
                    if (!unlocked) await unlock();
                    play();
                  }
                }}
                aria-describedby="sound-volume-hint"
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-300 accent-primary-600"
              />
              <p id="sound-volume-hint" className="mt-1.5 text-sm text-gray-600">
                {t("soundVolumeHint")}
              </p>
            </div>

            {/* Test row — the button self-arms audio on click (autoplay
                gesture), so no separate "tap to allow" instruction is needed. */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  if (!unlocked) await unlock();
                  play();
                }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span aria-hidden="true">🔔</span>
                {t("soundTest")}
              </button>
            </div>

            <p className="mt-5 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {t("soundDeviceNote")}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/** Local copy of the settings section heading (mirrors settings-form.tsx). */
function SectionHeading({ title }: { title: string }) {
  return (
    <div className="mb-5 flex items-center gap-2.5">
      <span className="h-5 w-1 rounded-full bg-primary-500" aria-hidden="true" />
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
    </div>
  );
}
