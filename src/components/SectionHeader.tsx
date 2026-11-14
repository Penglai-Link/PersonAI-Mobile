import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { spacing, typography, useThemedStyles, type Palette } from "../theme";

interface SectionHeaderProps {
  title: string;
  count?: number;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, count, right, style }: SectionHeaderProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.root, style]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {typeof count === "number" ? (
          <View style={styles.count}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    title: {
      color: c.text,
      ...typography.section,
    },
    count: {
      minWidth: 22,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 999,
      alignItems: "center",
      backgroundColor: c.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    countText: {
      color: c.muted,
      fontSize: 11,
      fontWeight: "600",
    },
    right: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
  });