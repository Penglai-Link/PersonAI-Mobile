import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { spacing, typography, useTheme, useThemedStyles, type Palette } from "../theme";

interface LoadingViewProps {
  label?: string;
  compact?: boolean;
}

export function LoadingView({ label, compact = false }: LoadingViewProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.root, compact && styles.compact]}>
      <ActivityIndicator color={palette.accent} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      paddingVertical: spacing.xxxl,
    },
    compact: {
      flex: 0,
      paddingVertical: spacing.xl,
    },
    label: {
      color: c.muted,
      ...typography.caption,
    },
  });