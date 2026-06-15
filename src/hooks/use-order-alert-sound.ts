"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  const [unlocked, setUnlocked] = useState(false);

  // HTML5 <audio> path (ignores iOS mute switch).
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // Web Audio path (respects iOS mute switch).
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  // Which sound URL the element + decoded buffer currently hold. When the
  // admin switches sounds, these go stale and are rebuilt on the next
  // unlock()/play() so the new selection takes effect without a reload.
  const loadedUrlRef = useRef<string | null>(null);

  /**
   * Ensure the <audio> element and decoded buffer match `url`, rebuilding them
   * if the selected sound changed. Returns the live element + buffer (buffer
   * may be null if Web Audio is unavailable). Safe to call repeatedly.
   */
  const ensureLoaded = useCallback(async (url: string) => {
    const changed = loadedUrlRef.current !== url;

    // HTML5 element — (re)create for the current URL.
    if (changed || !audioElRef.current) {
      const el = new Audio(url);
      el.preload = "auto";
      audioElRef.current = el;
    }

    // Web Audio buffer — (re)decode for the current URL.
    if (changed || !bufferRef.current) {
      const ctx = ctxRef.current;
      if (ctx) {
        try {
          const res = await fetch(url);
          const arr = await res.arrayBuffer();
          bufferRef.current = await ctx.decodeAudioData(arr);
        } catch {
          bufferRef.current = null; // element path can still cover playback
        }
      }
    }

    loadedUrlRef.current = url;
    return { el: audioElRef.current, buf: bufferRef.current };
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
        if (!ctxRef.current) ctxRef.current = new Ctor();
        if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
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
    const ctx = ctxRef.current;
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

    if (ok) setUnlocked(true);
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
      const ctx = ctxRef.current;
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
        const ctx = ctxRef.current;
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
