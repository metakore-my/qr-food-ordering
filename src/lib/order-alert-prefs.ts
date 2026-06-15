/**
 * Per-device order-alert sound preferences (client-safe, no server/DB).
 *
 * The new-order chime is a PER-DEVICE setting stored in `localStorage`, not a
 * deployment-wide `SystemSetting` — a kitchen tablet should chime while a
 * manager's laptop stays silent, and each browser keeps its own choice. There
 * is intentionally no API/DB path here.
 *
 * The read/parse logic is factored out of the React hook so it is pure and
 * unit-testable (the hook itself is browser-API-bound). Tests import these
 * helpers rather than re-declaring the shape, so they can't drift.
 *
 * `overrideMute` selects the iOS playback path at runtime (see
 * `use-order-alert-sound.ts`):
 *   true  → HTML5 <audio>   (plays through the iOS hardware mute switch)
 *   false → Web Audio API   (respects the iOS mute switch — silent when muted)
 */

/**
 * The selectable new-order sounds. All are CC0 / own-work (ffmpeg-synthesized),
 * so they ship cleanly into the public template with no license obligations.
 * `id` is the persisted value; `file` is the asset under `public/sounds/`;
 * `labelKey` resolves to `admin.settings.<labelKey>` for the UI. To add a
 * sound: drop the asset in `public/sounds/`, add an entry here, add the i18n
 * label key in all 6 locales. The picker renders this list automatically.
 */
export const ORDER_ALERT_SOUNDS = [
  { id: "service-bell", file: "/sounds/service-bell.mp3", labelKey: "soundOptionServiceBell" },
  { id: "marimba", file: "/sounds/marimba.mp3", labelKey: "soundOptionMarimba" },
  { id: "doorbell", file: "/sounds/doorbell.mp3", labelKey: "soundOptionDoorbell" },
] as const;

export type OrderAlertSoundId = (typeof ORDER_ALERT_SOUNDS)[number]["id"];

/** Default sound for a fresh device — the service bell (most "restaurant"). */
export const DEFAULT_ORDER_ALERT_SOUND: OrderAlertSoundId = "service-bell";

/** Resolve a sound id to its asset URL, falling back to the default sound. */
export function soundUrlFor(id: string): string {
  const found = ORDER_ALERT_SOUNDS.find((s) => s.id === id);
  return (found ?? ORDER_ALERT_SOUNDS.find((s) => s.id === DEFAULT_ORDER_ALERT_SOUND)!).file;
}

/** Validate a stored sound id, falling back to the default if unknown. */
export function clampSoundId(v: unknown): OrderAlertSoundId {
  return ORDER_ALERT_SOUNDS.some((s) => s.id === v)
    ? (v as OrderAlertSoundId)
    : DEFAULT_ORDER_ALERT_SOUND;
}

export interface OrderAlertPrefs {
  /** Master on/off for the new-order chime on this device. */
  enabled: boolean;
  /** When true, alert even if the device's hardware mute switch is on. */
  overrideMute: boolean;
  /**
   * Per-device playback volume, 0–1. Defaults to 1 (MAXIMUM) — a noisy F&B
   * floor needs the chime as loud as possible out of the box; staff can lower
   * it per device. Applied as gain at play time (see `use-order-alert-sound`):
   * the HTML5 path sets `audio.volume`, the Web Audio path sets a GainNode.
   */
  volume: number;
  /** Which sound plays on this device (an `ORDER_ALERT_SOUNDS` id). */
  sound: OrderAlertSoundId;
}

/** Clamp an arbitrary value to a valid 0–1 volume, falling back to max. */
export function clampVolume(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export const ORDER_ALERT_STORAGE_KEY = "orderAlert.prefs.v1";

/**
 * Defaults for a device that has never configured sound. Sound is ON by
 * default so a kitchen device alerts out of the box. NOTE: the browser autoplay
 * policy still requires ONE user gesture per page load before audio can play —
 * so "enabled by default" means *configured on*, and the Order Dashboard shows
 * a one-tap "enable sound" prompt to satisfy that gesture (it cannot be removed
 * in code). `overrideMute` defaults ON so the chime behaves like a buzzer and
 * isn't silenced by the hardware mute switch. `volume` defaults to 1 (MAXIMUM)
 * for the noisy F&B floor — staff lower it per device if needed. `sound`
 * defaults to the service bell (most "restaurant" of the set).
 */
export const DEFAULT_ORDER_ALERT_PREFS: OrderAlertPrefs = {
  enabled: true,
  overrideMute: true,
  volume: 1,
  sound: DEFAULT_ORDER_ALERT_SOUND,
};

/**
 * Parse a raw localStorage string into a validated prefs object, falling back
 * to defaults on any malformed/missing/legacy value. Never throws — a corrupt
 * value must degrade to "sound off", never crash the dashboard.
 */
export function parseOrderAlertPrefs(raw: string | null): OrderAlertPrefs {
  if (!raw) return { ...DEFAULT_ORDER_ALERT_PREFS };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_ORDER_ALERT_PREFS };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      enabled:
        typeof obj.enabled === "boolean"
          ? obj.enabled
          : DEFAULT_ORDER_ALERT_PREFS.enabled,
      overrideMute:
        typeof obj.overrideMute === "boolean"
          ? obj.overrideMute
          : DEFAULT_ORDER_ALERT_PREFS.overrideMute,
      // Legacy rows (pre-slider) have no `volume` → clamp falls back to 1 (max).
      volume: "volume" in obj ? clampVolume(obj.volume) : DEFAULT_ORDER_ALERT_PREFS.volume,
      // Legacy/unknown sound id → falls back to the default sound.
      sound: clampSoundId(obj.sound),
    };
  } catch {
    return { ...DEFAULT_ORDER_ALERT_PREFS };
  }
}

/** Serialize prefs for persistence (single source of the stored shape). */
export function serializeOrderAlertPrefs(prefs: OrderAlertPrefs): string {
  return JSON.stringify({
    enabled: prefs.enabled,
    overrideMute: prefs.overrideMute,
    volume: clampVolume(prefs.volume),
    sound: clampSoundId(prefs.sound),
  });
}
