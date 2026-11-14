/**
 * PersonAI Mobile's runtime visual language.
 *
 * Colors come from the active node skin (mapped CSS variables) or from the
 * built-in fallback palettes; spacing/typography stay constant so layouts never
 * jump when a skin changes.
 */

export { ThemeProvider, useTheme, useThemedStyles, type Palette, type ResolvedMode, type Skin, type ThemeMode } from "./ThemeProvider";
export { fallbackPalettes, parseCssColor } from "./palette";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radius = {
  card: 16,
  control: 12,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, fontWeight: "700" as const, letterSpacing: -0.8 },
  title: { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.3 },
  section: { fontSize: 15, fontWeight: "600" as const, letterSpacing: 0.1 },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyStrong: { fontSize: 15, fontWeight: "600" as const },
  label: { fontSize: 13, fontWeight: "600" as const },
  caption: { fontSize: 12, fontWeight: "400" as const },
  mono: { fontSize: 12, fontWeight: "400" as const, letterSpacing: 0.2 },
} as const;

export const layout = {
  /** Content is centered and capped on iPad / large screens. */
  maxContentWidth: 1000,
  /** Wider cap for list pages that may show two columns. */
  maxWideContentWidth: 1200,
  wideBreakpoint: 820,
  chatSidebarWidth: 288,
} as const;