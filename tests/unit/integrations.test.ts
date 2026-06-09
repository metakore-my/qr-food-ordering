import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCapabilities } from "@/lib/integrations";

// Every env var that getCapabilities() reads. Saved/restored around each test
// so the suite is deterministic regardless of the ambient environment.
const KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "OPENROUTER_API_KEY",
] as const;

describe("getCapabilities", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns all false when nothing is set", () => {
    expect(getCapabilities()).toEqual({
      hasR2: false,
      hasTurnstile: false,
      hasOpenRouter: false,
    });
  });

  it("hasR2 is false when only some R2 sub-vars are set", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    // R2_SECRET_ACCESS_KEY + R2_BUCKET_NAME missing
    expect(getCapabilities().hasR2).toBe(false);
  });

  it("hasR2 is false when a sub-var is present but blank", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET_NAME = "   "; // whitespace-only counts as empty
    expect(getCapabilities().hasR2).toBe(false);
  });

  it("hasR2 is true when all four R2 vars are set", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET_NAME = "bucket";
    expect(getCapabilities().hasR2).toBe(true);
  });

  it("hasTurnstile requires both site key and secret", () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
    expect(getCapabilities().hasTurnstile).toBe(false);
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(getCapabilities().hasTurnstile).toBe(true);
  });

  it("hasOpenRouter tracks OPENROUTER_API_KEY", () => {
    expect(getCapabilities().hasOpenRouter).toBe(false);
    process.env.OPENROUTER_API_KEY = "or-key";
    expect(getCapabilities().hasOpenRouter).toBe(true);
  });

  it("returns all true when every var is set", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET_NAME = "bucket";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
    process.env.TURNSTILE_SECRET_KEY = "ts-secret";
    process.env.OPENROUTER_API_KEY = "or-key";
    expect(getCapabilities()).toEqual({
      hasR2: true,
      hasTurnstile: true,
      hasOpenRouter: true,
    });
  });
});
