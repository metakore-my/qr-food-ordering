/**
 * Capability flags for the optional integrations (R2, Turnstile, OpenRouter).
 * Each is "available" only when ALL its env vars are non-empty; the UI hides
 * controls that would otherwise fail at request time when secrets are unwired.
 */
export interface Capabilities {
  hasR2: boolean;
  hasTurnstile: boolean;
  hasOpenRouter: boolean;
}

/** Read the current integration capability flags from process.env. */
export function getCapabilities(): Capabilities {
  const nonEmpty = (v?: string) => !!(v && v.trim());
  return {
    hasR2:
      nonEmpty(process.env.R2_ACCOUNT_ID) &&
      nonEmpty(process.env.R2_ACCESS_KEY_ID) &&
      nonEmpty(process.env.R2_SECRET_ACCESS_KEY) &&
      nonEmpty(process.env.R2_BUCKET_NAME),
    hasTurnstile:
      nonEmpty(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) &&
      nonEmpty(process.env.TURNSTILE_SECRET_KEY),
    hasOpenRouter: nonEmpty(process.env.OPENROUTER_API_KEY),
  };
}
