import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from "../theme";
import { Ionicons, type IconName } from "./icons";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
  bare?: boolean;
}

export function EmptyState({ icon, title, message, action, bare = false }: EmptyStateProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.root, !bare && styles.card]}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={22} color={palette.accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.xxl,
      paddingHorizontal: spacing.xl,
      gap: spacing.sm,
    },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.card,
    },
    iconWrap: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
      marginBottom: spacing.xs,
    },
    title: {
      color: c.text,
      ...typography.bodyStrong,
      textAlign: "center",
    },
    message: {
      color: c.muted,
      ...typography.caption,
      lineHeight: 18,
      textAlign: "center",
      maxWidth: 340,
    },
    action: {
      marginTop: spacing.sm,
      width: "100%",
      alignSelf: "stretch",
      flexDirection: "row",
      justifyContent: "center",
      gap: spacing.sm,
    },
  });