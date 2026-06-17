"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  clampSoundId,
  clampVolume,
  DEFAULT_ORDER_ALERT_PREFS,
  ORDER_ALERT_STORAGE_KEY,
  parseOrderAlertPrefs,
  serializeOrderAlertPrefs,
  soundUrlFor,
  type OrderAlertPrefs,
} from "@/lib/order-alert-prefs";

/**
 * localStorage-backed external store for the prefs, read via
 * `useSyncExternalStore`. This is the lint-clean, hydration-safe way to surface
 * a browser-only value: the server snapshot is the stable default, the client
 * snapshot is the stored value, and cross-tab `storage` events re-render — all
 * without a setState-in-effect. The snapshot is memoized so React's identity
 * check is stable between reads (a fresh parse each call would loop).
 */
let prefsSnapshotRaw: string | null = null;
let prefsSnapshot: OrderAlertPrefs = DEFAULT_ORDER_ALERT_PREFS;

function readPrefsSnapshot(): OrderAlertPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ORDER_ALERT_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== prefsSnapshotRaw) {
    prefsSnapshotRaw = raw;
    prefsSnapshot = parseOrderAlertPrefs(raw);
  }
  return prefsSnapshot;
}

function getServerPrefsSnapshot(): OrderAlertPrefs {
  return DEFAULT_ORDER_ALERT_PREFS;
}

const prefsListeners = new Set<() => void>();

function subscribePrefs(cb: () => void): () => void {
  prefsListeners.add(cb);
  // Cross-tab sync: another tab writing the key fires a `storage` event.
  const onStorage = (e: StorageEvent) => {
    if (e.key === ORDER_ALERT_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    prefsListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Write prefs to localStorage and notify same-tab subscribers. */
function writePrefs(next: OrderAlertPrefs): void {
  try {
    localStorage.setItem(ORDER_ALERT_STORAGE_KEY, serializeOrderAlertPrefs(next));
  } catch {
    /* storage unavailable (private mode / quota) — listeners still fire */
  }
  // Invalidate the memoized snapshot so the next read reflects the write, then
  // notify (the `storage` event only fires in OTHER tabs, not this one).
  prefsSnapshotRaw = null;
  for (const cb of prefsListeners) cb();
}

/**
 * TAB-LIFETIME audio singletons (NOT per-component).
 *
 * The AudioContext, the <audio> element, the decoded buffer, and the `unlocked`
 * flag all live at module scope so they SURVIVE the component unmounting. The
 * dashboard (`order-board.tsx`) is the only consumer, but it unmounts every time
 * the admin navigates away (SPA `<Link>` nav) and remounts on return — if these
 * lived in `useState`/`useRef` the unlock would reset on every visit and the
 * "tap to enable sound" prompt would reappear even though the AudioContext (a
 * plain JS object) is still alive and armed. Module scope keeps one armed
 * context for the whole tab session. A genuine FULL page reload makes a fresh
 * module instance → `unlocked` is false again → one fresh tap is needed, which
 * is unavoidable per the browser autoplay policy.
 *
 * `globalThis`-guarded so a dev HMR reload reuses the same singletons instead of
 * orphaning the previous module's armed context (matches the rate-limit / menu
 * cache / JWT-cache stores — see CLAUDE.md "single-instance in-memory stores").
 */
interface AudioSingletons {
  ctx: AudioContext | null;
  audioEl: HTMLAudioElement | null;
  buffer: AudioBuffer | null;
  loadedUrl: string | null;
  unlocked: boolean;
}
const audioGlobal = globalThis as unknown as {
  __orderAlertAudio?: AudioSingletons;
};
const audio: AudioSingletons =
  audioGlobal.__orderAlertAudio ??
  (audioGlobal.__orderAlertAudio = {
    ctx: null,
    audioEl: null,
    buffer: null,
    loadedUrl: null,
    unlocked: false,
  });

// External store for the `unlocked` flag so every mounted hook re-renders when
// it flips (and a remount reads the persisted value). Server snapshot = false
// (the prompt is hidden during SSR; the client store takes over on hydration).
const unlockedListeners = new Set<() => void>();
function readUnlockedSnapshot(): boolean {
  return audio.unlocked;
}
function getServerUnlockedSnapshot(): boolean {
  return false;
}
function subscribeUnlocked(cb: () => void): () => void {
  unlockedListeners.add(cb);
  return () => unlockedListeners.delete(cb);
}
function setUnlockedGlobal(value: boolean): void {
  if (audio.unlocked === value) return;
  audio.unlocked = value;
  for (const cb of unlockedListeners) cb();
}

/**
 * Per-device new-order alert sound engine.
 *
 * Why two playback paths (and the runtime switch between them):
 * iOS Safari silences the Web Audio API when the hardware mute switch is on,
 * but HTML5 <audio> elements still play. So:
 *   overrideMute=true  → play via HTML5 <audio>  (chimes through iOS mute — buzzer)
 *   overrideMute=false → play via Web Audio       (respects iOS mute — silent when muted)
 * Both decode the SAME bundled MP3, so there is one sound identity, one asset.
 *
 * Autoplay policy: no audio can play until the user has interacted with the
 * page once. `unlock()` MUST be called from inside a user-gesture handler (a
 * click/tap). It arms BOTH paths in one gesture:
 *   - HTML5: play()+pause()+reset the <audio> element.
 *   - Web Audio: create the context, resume() it, and play one SILENT buffer
 *     (the documented iOS "unmute kick") so the context is fully live.
 * After a page reload the context is gone, so `unlocked` resets and the UI must
 * prompt for one fresh tap — unavoidable per policy.
 *
 * The hook never throws into the caller: every browser-API call is guarded so a
 * missing API or a rejected play() degrades to silence, not a crashed board.
 */
export function useOrderAlertSound() {
  // Prefs come from a localStorage-backed external store: server snapshot =
  // defaults, client snapshot = stored value, cross-tab `storage` events
  // re-render. No setState-in-effect, no hydration mismatch.
  const prefs = useSyncExternalStore(
    subscribePrefs,
    readPrefsSnapshot,
    getServerPrefsSnapshot
  );
  // `unlocked` is read from the TAB-LIFETIME store (see audio singletons above),
  // so it survives this component unmounting/remounting on SPA navigation. The
  // audio primitives (ctx / element / buffer / loadedUrl) live on the same
  // `audio` singleton — they used to be per-component refs, which is exactly why
  // the unlock reset on every dashboard revisit.
  const unlocked = useSyncExternalStore(
    subscribeUnlocked,
    readUnlockedSnapshot,
    getServerUnlockedSnapshot
  );

  /**
   * Ensure the <audio> element and decoded buffer match `url`, rebuilding them
   * if the selected sound changed. Returns the live element + buffer (buffer
   * may be null if Web Audio is unavailable). Safe to call repeatedly.
   */
  const ensureLoaded = useCallback(async (url: string) => {
    const changed = audio.loadedUrl !== url;

    // HTML5 element — (re)create for the current URL.
    if (changed || !audio.audioEl) {
      const el = new Audio(url);
      el.preload = "auto";
      audio.audioEl = el;
    }

    // Web Audio buffer — (re)decode for the current URL.
    if (changed || !audio.buffer) {
      const ctx = audio.ctx;
      if (ctx) {
        try {
          const res = await fetch(url);
          const arr = await res.arrayBuffer();
          audio.buffer = await ctx.decodeAudioData(arr);
        } catch {
          audio.buffer = null; // element path can still cover playback
        }
      }
    }

    audio.loadedUrl = url;
    return { el: audio.audioEl, buf: audio.buffer };
  }, []);

  /**
   * Arm audio inside a user gesture. Idempotent-ish: safe to call again to
   * re-arm after a reload or after the selected sound changed. Returns true if
   * at least one path armed.
   */
  const unlock = useCallback(async (): Promise<boolean> => {
    let ok = false;
    const url = soundUrlFor(readPrefsSnapshot().sound);

    // Web Audio context must exist before ensureLoaded can decode into it.
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    try {
      if (Ctor) {
        if (!audio.ctx) audio.ctx = new Ctor();
        if (audio.ctx.state === "suspended") await audio.ctx.resume();
      }
    } catch {
      /* context resume failed — element path may still work */
    }

    // Load (or reload) the selected sound into both paths.
    const { el, buf } = await ensureLoaded(url);

    // --- HTML5 <audio> path: silent prime to satisfy the gesture ---
    if (el) {
      try {
        el.muted = true;
        await el.play().catch(() => {});
        el.pause();
        el.currentTime = 0;
        el.muted = false;
        ok = true;
      } catch {
        /* element path unavailable — Web Audio may still work */
      }
    }

    // --- Web Audio path: ONE silent buffer fully unlocks the context on iOS ---
    const ctx = audio.ctx;
    if (ctx && buf) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = 0; // silent kick
        src.connect(gain).connect(ctx.destination);
        src.start(0);
        ok = true;
      } catch {
        /* Web Audio path unavailable — HTML5 path may still work */
      }
    }

    if (ok) setUnlockedGlobal(true);
    return ok;
  }, [ensureLoaded]);

  /** Play the selected chime via the path the `overrideMute` pref selects. */
  const play = useCallback(() => {
    // Read the live persisted prefs straight from the store so this stable
    // callback never goes stale (no ref needed).
    const p = readPrefsSnapshot();
    if (!p.enabled) return;
    const vol = clampVolume(p.volume); // per-device volume, 0–1 (default 1=max)
    if (vol <= 0) return; // muted via the slider — nothing to play

    const url = soundUrlFor(p.sound);
    // If the selection changed since last load, reload then play (fire-and-
    // forget — the reload resolves before play in practice; if mid-switch, the
    // next chime is correct). ensureLoaded is a no-op when already current.
    void ensureLoaded(url).then(({ el, buf }) => {
      if (p.overrideMute && el) {
        try {
          el.volume = vol; // element volume caps at 1.0 (the asset is the ceiling)
          el.currentTime = 0;
          void el.play().catch(() => {});
          return;
        } catch {
          /* fall through to Web Audio as a backup */
        }
      }

      // Web Audio path (respects iOS mute). Also the fallback if the element
      // path is unavailable. A GainNode applies the per-device volume.
      const ctx = audio.ctx;
      if (ctx && buf) {
        try {
          if (ctx.state === "suspended") void ctx.resume();
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const gain = ctx.createGain();
          gain.gain.value = vol;
          src.connect(gain).connect(ctx.destination);
          src.start(0);
        } catch {
          /* give up silently — never crash the board over a missed chime */
        }
      }
    });
  }, [ensureLoaded]);

  // Mobile suspends the AudioContext when the tab backgrounds; re-resume it
  // when the kitchen device comes back to the foreground so it's armed again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const ctx = audio.ctx;
        if (ctx && ctx.state === "suspended") void ctx.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => writePrefs({ ...readPrefsSnapshot(), enabled }),
    []
  );
  const setOverrideMute = useCallback(
    (overrideMute: boolean) =>
      writePrefs({ ...readPrefsSnapshot(), overrideMute }),
    []
  );
  const setVolume = useCallback(
    (volume: number) =>
      writePrefs({ ...readPrefsSnapshot(), volume: clampVolume(volume) }),
    []
  );
  const setSound = useCallback(
    (sound: string) =>
      writePrefs({ ...readPrefsSnapshot(), sound: clampSoundId(sound) }),
    []
  );

  return {
    enabled: prefs.enabled,
    overrideMute: prefs.overrideMute,
    volume: prefs.volume,
    sound: prefs.sound,
    /** True once a user gesture armed audio this page load. */
    unlocked,
    unlock,
    play,
    setEnabled,
    setOverrideMute,
    setVolume,
    setSound,
  };
}
