import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, spacing, typography, useTheme } from "../theme";

type BadgeTone = "accent" | "muted" | "danger" | "success";

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
  withDot?: boolean;
}

export function Badge({ label, tone = "muted", style, withDot = false }: BadgeProps) {
  const { palette } = useTheme();
  const paletteForTone = {
    accent: {
      background: palette.accentSoft,
      border: palette.accentBorder,
      text: palette.accent,
    },
    muted: {
      background: palette.surfaceAlt,
      border: palette.border,
      text: palette.muted,
    },
    danger: {
      background: palette.dangerSoft,
      border: palette.dangerBorder,
      text: palette.danger,
    },
    success: {
      background: palette.successSoft,
      border: palette.successBorder,
      text: palette.success,
    },
  } satisfies Record<BadgeTone, { background: string; border: string; text: string }>;
  const selected = paletteForTone[tone];

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: selected.background, borderColor: selected.border },
        style,
      ]}
    >
      {withDot ? (
        <View style={[styles.dot, { backgroundColor: selected.text }]} />
      ) : null}
      <Text style={[styles.label, { color: selected.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  label: {
    ...typography.caption,
    fontWeight: "600",
    fontSize: 11,
  },
});