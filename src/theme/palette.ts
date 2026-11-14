/**
 * Maps the desktop skin CSS variables onto the mobile palette.
 *
 * A skin from `GET /api/v1/system/skins` exposes two variants of CSS custom
 * properties. Only documented color variables are consumed here; missing or
 * unparseable values fall back to the built-in palettes so an unknown/new skin
 * never breaks the UI.
 */

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

import type { Skin } from "../api/tron";

export type { Skin };

export interface Palette {
  mode: ResolvedMode;
  isLight: boolean;
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  accentBorder: string;
  danger: string;
  dangerSoft: string;
  dangerBorder: string;
  success: string;
  successSoft: string;
  successBorder: string;
  /** Translucent backdrop used on top of the camera preview. */
  overlay: string;
  scrim: string;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_PATTERN = /^rgba?\(([^)]*)\)$/i;
const HSL_PATTERN = /^hsla?\(([^)]*)\)$/i;

function clampByte(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampAlpha(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function parseHex(value: string): Rgba | null {
  const hex = value.slice(1);
  const expand = (chunk: string) =>
    chunk.length === 1 ? `${chunk}${chunk}` : chunk;
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a] = [
      expand(hex[0]!),
      expand(hex[1]!),
      expand(hex[2]!),
      hex[3] ? expand(hex[3]) : "ff",
    ];
    return {
      r: parseInt(r!, 16),
      g: parseInt(g!, 16),
      b: parseInt(b!, 16),
      a: parseInt(a!, 16) / 255,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function parseChannel(token: string, scale: number): number {
  const trimmed = token.trim();
  if (!trimmed) return Number.NaN;
  if (trimmed.endsWith("%")) {
    return (parseFloat(trimmed) / 100) * scale;
  }
  return parseFloat(trimmed);
}

function parseAlphaToken(token: string | undefined): number {
  if (!token) return 1;
  const trimmed = token.trim();
  if (!trimmed) return 1;
  if (trimmed.endsWith("%")) return clampAlpha(parseFloat(trimmed) / 100);
  return clampAlpha(parseFloat(trimmed));
}

function parseRgb(value: string): Rgba | null {
  const match = RGB_PATTERN.exec(value);
  if (!match) return null;
  const body = match[1]!;
  const [channelsPart, alphaPart] = body.includes("/")
    ? body.split("/", 2)
    : [body, undefined];
  const channels = channelsPart!
    .split(/[\s,]+/)
    .filter((token) => token.length > 0);
  if (channels.length < 3) return null;
  const alphaSlice = alphaPart ?? channels[3];
  return {
    r: clampByte(parseChannel(channels[0]!, 255)),
    g: clampByte(parseChannel(channels[1]!, 255)),
    b: clampByte(parseChannel(channels[2]!, 255)),
    a: parseAlphaToken(alphaSlice),
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function parseHsl(value: string): Rgba | null {
  const match = HSL_PATTERN.exec(value);
  if (!match) return null;
  const body = match[1]!;
  const [channelsPart, alphaPart] = body.includes("/")
    ? body.split("/", 2)
    : [body, undefined];
  const channels = channelsPart!
    .split(/[\s,]+/)
    .filter((token) => token.length > 0);
  if (channels.length < 3) return null;
  const hue = (((parseFloat(channels[0]!) % 360) + 360) % 360) / 360;
  const saturation = Math.min(1, Math.max(0, parseFloat(channels[1]!) / 100));
  const lightness = Math.min(1, Math.max(0, parseFloat(channels[2]!) / 100));
  const alphaSlice = alphaPart ?? channels[3];
  if (saturation === 0) {
    const channel = clampByte(lightness * 255);
    return { r: channel, g: channel, b: channel, a: parseAlphaToken(alphaSlice) };
  }
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return {
    r: clampByte(hueToRgb(p, q, hue + 1 / 3) * 255),
    g: clampByte(hueToRgb(p, q, hue) * 255),
    b: clampByte(hueToRgb(p, q, hue - 1 / 3) * 255),
    a: parseAlphaToken(alphaSlice),
  };
}

/** Parses hex, rgb()/rgba() and hsl()/hsla() colors. Returns null otherwise. */
export function parseCssColor(value: string | null | undefined): Rgba | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^transparent$/i.test(trimmed)) return { r: 0, g: 0, b: 0, a: 0 };
  if (HEX_PATTERN.test(trimmed)) return parseHex(trimmed);
  if (RGB_PATTERN.test(trimmed)) return parseRgb(trimmed);
  if (HSL_PATTERN.test(trimmed)) return parseHsl(trimmed);
  return null;
}

function toRgbaString(color: Rgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(
    color.a.toFixed(3),
  )})`;
}

function withAlpha(
  base: string,
  alpha: number,
  fallback: string,
): string {
  const parsed = parseCssColor(base);
  if (!parsed) return fallback;
  return toRgbaString({ ...parsed, a: clampAlpha(alpha) });
}

function pick(
  colors: Record<string, string> | null,
  keys: string[],
  fallback: string,
): string {
  if (!colors) return fallback;
  for (const key of keys) {
    const value = colors[key];
    if (value && parseCssColor(value)) return value;
  }
  return fallback;
}

/** Built-in fallback palettes: the original dark styling plus a matching light one. */
export const fallbackPalettes: Record<ResolvedMode, Palette> = {
  dark: {
    mode: "dark",
    isLight: false,
    background: "#08090A",
    surface: "#121417",
    surfaceAlt: "#171A1F",
    surfaceContainer: "#171A1F",
    surfaceContainerHigh: "#1D2127",
    border: "#23262B",
    text: "#F5F7FA",
    muted: "#8B919A",
    accent: "#22D3EE",
    onAccent: "#041014",
    accentSoft: "rgba(34, 211, 238, 0.12)",
    accentBorder: "rgba(34, 211, 238, 0.42)",
    danger: "#F87171",
    dangerSoft: "rgba(248, 113, 113, 0.10)",
    dangerBorder: "rgba(248, 113, 113, 0.34)",
    success: "#34D399",
    successSoft: "rgba(52, 211, 153, 0.10)",
    successBorder: "rgba(52, 211, 153, 0.32)",
    overlay: "rgba(8, 9, 10, 0.72)",
    scrim: "rgba(8, 9, 10, 0.55)",
  },
  light: {
    mode: "light",
    isLight: true,
    background: "#F0F0F6",
    surface: "#F6F7F9",
    surfaceAlt: "#E7E9EF",
    surfaceContainer: "#E4E5EE",
    surfaceContainerHigh: "#E7E9EF",
    border: "#E2E5EB",
    text: "#1F2329",
    muted: "#626773",
    accent: "#5861A6",
    onAccent: "#FFFFFF",
    accentSoft: "rgba(88, 97, 166, 0.12)",
    accentBorder: "rgba(88, 97, 166, 0.38)",
    danger: "#B93838",
    dangerSoft: "rgba(185, 56, 56, 0.10)",
    dangerBorder: "rgba(185, 56, 56, 0.30)",
    success: "#34764A",
    successSoft: "rgba(52, 118, 74, 0.10)",
    successBorder: "rgba(52, 118, 74, 0.28)",
    overlay: "rgba(240, 240, 246, 0.72)",
    scrim: "rgba(15, 20, 30, 0.42)",
  },
};

export function skinColors(
  skin: Skin | null | undefined,
  mode: ResolvedMode,
): Record<string, string> | null {
  if (!skin || !skin.variants) return null;
  const variant = mode === "dark" ? skin.variants.dark : skin.variants.light;
  return variant && typeof variant === "object" ? variant : null;
}

/** Builds the runtime palette for a skin variant, falling back to built-ins. */
export function createPalette(
  mode: ResolvedMode,
  colors: Record<string, string> | null = null,
): Palette {
  const fallback = fallbackPalettes[mode];
  const background = pick(colors, ["--color-background"], fallback.background);
  const surface = pick(colors, ["--color-surface"], fallback.surface);
  const surfaceAlt = pick(
    colors,
    [
      "--color-surface-container-high",
      "--color-surface-container",
      "--color-surface-container-low",
    ],
    fallback.surfaceAlt,
  );
  const accent = pick(
    colors,
    ["--color-primary", "--color-accent", "--accent"],
    fallback.accent,
  );
  const danger = pick(colors, ["--color-error"], fallback.danger);
  const success = pick(colors, ["--color-success"], fallback.success);

  return {
    mode,
    isLight: mode === "light",
    background,
    surface,
    surfaceAlt,
    surfaceContainer: pick(
      colors,
      ["--color-surface-container"],
      fallback.surfaceContainer,
    ),
    surfaceContainerHigh: pick(
      colors,
      ["--color-surface-container-high"],
      fallback.surfaceContainerHigh,
    ),
    border: pick(
      colors,
      ["--color-outline-variant", "--color-outline"],
      fallback.border,
    ),
    text: pick(colors, ["--color-on-surface"], fallback.text),
    muted: pick(
      colors,
      ["--color-on-surface-variant", "--color-outline"],
      fallback.muted,
    ),
    accent,
    onAccent: pick(
      colors,
      ["--color-on-primary", "--color-on-accent"],
      fallback.onAccent,
    ),
    accentSoft: withAlpha(accent, mode === "light" ? 0.12 : 0.14, fallback.accentSoft),
    accentBorder: withAlpha(accent, mode === "light" ? 0.36 : 0.42, fallback.accentBorder),
    danger,
    dangerSoft: withAlpha(danger, 0.1, fallback.dangerSoft),
    dangerBorder: withAlpha(danger, 0.34, fallback.dangerBorder),
    success,
    successSoft: withAlpha(success, 0.12, fallback.successSoft),
    successBorder: withAlpha(success, 0.32, fallback.successBorder),
    overlay: withAlpha(background, 0.72, fallback.overlay),
    scrim: fallback.scrim,
  };
}