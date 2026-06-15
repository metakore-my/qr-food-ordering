export type Ramp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>;

export const PRESET_THEMES: Record<"green" | "terracotta" | "indigo" | "amber", Ramp> = {
  green: {
    50: "#E6F5ED", 100: "#B3E0C8", 200: "#80CCA3", 300: "#4DB77E", 400: "#26A762",
    500: "#005A2A", 600: "#005125", 700: "#00471F", 800: "#003D1A", 900: "#003318", 950: "#00200F",
  },
  terracotta: {
    50: "#FDF3EE", 100: "#FAD9C7", 200: "#F2B59A", 300: "#E88D67", 400: "#DC6638",
    500: "#C2410C", 600: "#A8380A", 700: "#882D08", 800: "#6B2407", 900: "#551D06", 950: "#2E0F03",
  },
  indigo: {
    50: "#EEF0FB", 100: "#D2D6F4", 200: "#A8B0E9", 300: "#7C87DC", 400: "#565FCB",
    500: "#3730A3", 600: "#302B8F", 700: "#272475", 800: "#1F1D5C", 900: "#191747", 950: "#0D0C27",
  },
  amber: {
    50: "#F8EEE6", 100: "#ECD4C2", 200: "#DDB290", 300: "#CE8F5F", 400: "#C27235",
    500: "#B45309", 600: "#A24B08", 700: "#8C4107", 800: "#773706", 900: "#612D05", 950: "#442003",
  },
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** Mix toward white (amount>0) or black (amount<0) by |amount| fraction. */
function mix(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return rgbToHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

/** Derive a full ramp from a single base color used as the 500 shade. */
function deriveRamp(base: string): Ramp {
  const mixByShade: Record<number, number> = {
    50: 0.9, 100: 0.75, 200: 0.55, 300: 0.35, 400: 0.18,
    500: 0, 600: -0.1, 700: -0.22, 800: -0.34, 900: -0.46, 950: -0.62,
  };
  const out = {} as Ramp;
  for (const s of SHADES) out[s] = s === 500 ? base.toLowerCase() : mix(base, mixByShade[s]);
  return out;
}

export function resolveThemeRamp(theme: string, customBase: string | null): Ramp {
  if (theme === "custom" && customBase && /^#[0-9a-fA-F]{6}$/.test(customBase)) {
    return deriveRamp(customBase);
  }
  return PRESET_THEMES[theme as keyof typeof PRESET_THEMES] ?? PRESET_THEMES.green;
}

/**
 * Build the `--color-primary-*` declarations for an injected <style>.
 *
 * SECURITY: this string is rendered via dangerouslySetInnerHTML, so it must be
 * safe BY CONSTRUCTION — not merely because upstream validation is trusted. Any
 * shade whose value is not a strict 6-digit hex is dropped, so no value can ever
 * close the <style> tag or inject markup, even if validation upstream regresses.
 */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
export function themeCssVars(ramp: Ramp): string {
  return SHADES.filter((s) => HEX6.test(ramp[s]))
    .map((s) => `--color-primary-${s}: ${ramp[s]};`)
    .join(" ");
}
