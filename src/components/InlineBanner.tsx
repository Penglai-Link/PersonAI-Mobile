import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from "../theme";
import { Ionicons } from "./icons";

interface InlineBannerProps {
  message: string;
  tone?: "danger" | "info";
  actionLabel?: string;
  onAction?: () => void;
}

export function InlineBanner({
  message,
  tone = "danger",
  actionLabel,
  onAction,
}: InlineBannerProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isDanger = tone === "danger";
  const color = isDanger ? palette.danger : palette.accent;

  return (
    <View
      style={[styles.root, isDanger ? styles.danger : styles.info]}
      accessibilityRole="alert"
    >
      <Ionicons
        name={isDanger ? "alert-circle-outline" : "information-circle-outline"}
        size={18}
        color={color}
      />
      <Text style={[styles.message, { color }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
    },
    danger: {
      backgroundColor: c.dangerSoft,
      borderColor: c.dangerBorder,
    },
    info: {
      backgroundColor: c.accentSoft,
      borderColor: c.accentBorder,
    },
    message: {
      flex: 1,
      ...typography.caption,
      lineHeight: 18,
    },
    action: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    pressed: {
      opacity: 0.7,
    },
    actionLabel: {
      color: c.text,
      ...typography.caption,
      fontWeight: "600",
    },
  });