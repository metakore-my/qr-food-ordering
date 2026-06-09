import { log } from "./logger";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileVerifyResult {
  success: boolean;
  "error-codes": string[];
  challenge_ts?: string;
  hostname?: string;
}

export async function verifyTurnstileToken(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    log.error("Turnstile", "TURNSTILE_SECRET_KEY is not set");
    return false;
  }

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });

    const result: TurnstileVerifyResult = await res.json();

    if (!result.success) {
      log.warn("Turnstile", "Verification failed", { codes: result["error-codes"] });
    }

    return result.success;
  } catch (error) {
    log.error("Turnstile", "Verification error", { error: error instanceof Error ? error.message : "Unknown error" });
    return false;
  }
}
