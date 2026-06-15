import { describe, it, expect } from "vitest";
import {
  clampSoundId,
  clampVolume,
  DEFAULT_ORDER_ALERT_PREFS,
  DEFAULT_ORDER_ALERT_SOUND,
  ORDER_ALERT_SOUNDS,
  parseOrderAlertPrefs,
  serializeOrderAlertPrefs,
  soundUrlFor,
} from "@/lib/order-alert-prefs";

describe("parseOrderAlertPrefs — tolerant per-device sound prefs reader", () => {
  it("returns defaults for null (never-configured device)", () => {
    expect(parseOrderAlertPrefs(null)).toEqual(DEFAULT_ORDER_ALERT_PREFS);
  });

  it("returns defaults for an empty string", () => {
    expect(parseOrderAlertPrefs("")).toEqual(DEFAULT_ORDER_ALERT_PREFS);
  });

  it("defaults to sound ON (kitchen device alerts out of the box; board prompts the one autoplay-unlock tap)", () => {
    expect(DEFAULT_ORDER_ALERT_PREFS.enabled).toBe(true);
  });

  it("defaults overrideMute ON (a kitchen device should ring through the hardware mute switch)", () => {
    expect(DEFAULT_ORDER_ALERT_PREFS.overrideMute).toBe(true);
  });

  it("defaults volume to 1 (MAXIMUM — noisy F&B floor)", () => {
    expect(DEFAULT_ORDER_ALERT_PREFS.volume).toBe(1);
  });

  it("defaults sound to the service bell (most 'restaurant')", () => {
    expect(DEFAULT_ORDER_ALERT_PREFS.sound).toBe("service-bell");
    expect(DEFAULT_ORDER_ALERT_SOUND).toBe("service-bell");
  });

  it("parses a fully-specified valid object", () => {
    const raw = JSON.stringify({
      enabled: true,
      overrideMute: false,
      volume: 0.5,
      sound: "marimba",
    });
    expect(parseOrderAlertPrefs(raw)).toEqual({
      enabled: true,
      overrideMute: false,
      volume: 0.5,
      sound: "marimba",
    });
  });

  it("falls back per-field when a key is missing", () => {
    const raw = JSON.stringify({ enabled: true });
    expect(parseOrderAlertPrefs(raw)).toEqual({
      enabled: true,
      overrideMute: DEFAULT_ORDER_ALERT_PREFS.overrideMute,
      volume: DEFAULT_ORDER_ALERT_PREFS.volume,
      sound: DEFAULT_ORDER_ALERT_PREFS.sound,
    });
  });

  it("legacy rows without `volume`/`sound` default to max + service bell (no migration)", () => {
    const raw = JSON.stringify({ enabled: true, overrideMute: true });
    const p = parseOrderAlertPrefs(raw);
    expect(p.volume).toBe(1);
    expect(p.sound).toBe("service-bell");
  });

  it("falls back an unknown stored sound id to the default", () => {
    expect(parseOrderAlertPrefs(JSON.stringify({ sound: "trombone" })).sound).toBe(
      "service-bell"
    );
    expect(parseOrderAlertPrefs(JSON.stringify({ sound: 42 })).sound).toBe(
      "service-bell"
    );
  });

  it("keeps a valid known sound id", () => {
    expect(parseOrderAlertPrefs(JSON.stringify({ sound: "doorbell" })).sound).toBe(
      "doorbell"
    );
  });

  it("clamps an out-of-range stored volume into 0–1", () => {
    expect(parseOrderAlertPrefs(JSON.stringify({ volume: 5 })).volume).toBe(1);
    expect(parseOrderAlertPrefs(JSON.stringify({ volume: -3 })).volume).toBe(0);
    expect(parseOrderAlertPrefs(JSON.stringify({ volume: 0.3 })).volume).toBe(0.3);
  });

  it("ignores non-numeric volume, falling back to default (max)", () => {
    expect(parseOrderAlertPrefs(JSON.stringify({ volume: "loud" })).volume).toBe(1);
    expect(parseOrderAlertPrefs(JSON.stringify({ volume: null })).volume).toBe(1);
  });

  it("ignores non-boolean field types, falling back to defaults for those fields", () => {
    const raw = JSON.stringify({ enabled: "yes", overrideMute: 1 });
    expect(parseOrderAlertPrefs(raw)).toEqual(DEFAULT_ORDER_ALERT_PREFS);
  });

  it("never throws on malformed JSON — degrades to defaults", () => {
    expect(parseOrderAlertPrefs("{not json")).toEqual(DEFAULT_ORDER_ALERT_PREFS);
    expect(parseOrderAlertPrefs("[1,2,3]")).toEqual(DEFAULT_ORDER_ALERT_PREFS);
    expect(parseOrderAlertPrefs("null")).toEqual(DEFAULT_ORDER_ALERT_PREFS);
    expect(parseOrderAlertPrefs("42")).toEqual(DEFAULT_ORDER_ALERT_PREFS);
    expect(parseOrderAlertPrefs('"a string"')).toEqual(DEFAULT_ORDER_ALERT_PREFS);
  });

  it("round-trips through serialize → parse without loss", () => {
    const prefs = {
      enabled: true,
      overrideMute: false,
      volume: 0.75,
      sound: "doorbell" as const,
    };
    expect(parseOrderAlertPrefs(serializeOrderAlertPrefs(prefs))).toEqual(prefs);
  });

  it("serialize emits only the four known keys (no extra state leaks in)", () => {
    const serialized = serializeOrderAlertPrefs({
      enabled: true,
      overrideMute: true,
      volume: 1,
      sound: "service-bell",
      // @ts-expect-error — deliberately pass an extra key to prove it's dropped
      stray: "x",
    });
    expect(JSON.parse(serialized)).toEqual({
      enabled: true,
      overrideMute: true,
      volume: 1,
      sound: "service-bell",
    });
  });
});

describe("clampVolume — 0–1 with max fallback", () => {
  it("passes through valid in-range values", () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(1)).toBe(1);
  });

  it("clamps below 0 to 0 and above 1 to 1", () => {
    expect(clampVolume(-0.5)).toBe(0);
    expect(clampVolume(2)).toBe(1);
  });

  it("falls back to 1 (max) for non-finite or non-number input", () => {
    expect(clampVolume(NaN)).toBe(1);
    expect(clampVolume(Infinity)).toBe(1);
    expect(clampVolume("0.5")).toBe(1);
    expect(clampVolume(undefined)).toBe(1);
    expect(clampVolume(null)).toBe(1);
  });
});

describe("sound catalog helpers", () => {
  it("clampSoundId keeps known ids and falls back unknowns to the default", () => {
    for (const s of ORDER_ALERT_SOUNDS) {
      expect(clampSoundId(s.id)).toBe(s.id);
    }
    expect(clampSoundId("nope")).toBe(DEFAULT_ORDER_ALERT_SOUND);
    expect(clampSoundId(null)).toBe(DEFAULT_ORDER_ALERT_SOUND);
    expect(clampSoundId(123)).toBe(DEFAULT_ORDER_ALERT_SOUND);
  });

  it("soundUrlFor resolves each known id to its asset, unknowns to the default's asset", () => {
    for (const s of ORDER_ALERT_SOUNDS) {
      expect(soundUrlFor(s.id)).toBe(s.file);
    }
    const defaultFile = ORDER_ALERT_SOUNDS.find(
      (s) => s.id === DEFAULT_ORDER_ALERT_SOUND
    )!.file;
    expect(soundUrlFor("unknown")).toBe(defaultFile);
  });

  it("every catalog entry has a distinct id, a /sounds/ asset path, and a labelKey", () => {
    const ids = ORDER_ALERT_SOUNDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ORDER_ALERT_SOUNDS) {
      expect(s.file).toMatch(/^\/sounds\/.+\.mp3$/);
      expect(s.labelKey).toMatch(/^soundOption/);
    }
  });
});
