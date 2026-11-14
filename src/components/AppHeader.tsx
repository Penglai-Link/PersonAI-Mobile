import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { spacing, typography, useTheme, useThemedStyles, type Palette } from "../theme";
import { Ionicons } from "./icons";

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppHeader({
  title,
  subtitle,
  eyebrow,
  onBack,
  right,
  large = false,
  style,
}: AppHeaderProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.root, style]}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={onBack}
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
      ) : null}

      <View style={styles.titles}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text
          style={[styles.title, large && styles.largeTitle]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
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
      gap: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      minHeight: 56,
    },
    back: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    pressed: {
      opacity: 0.7,
    },
    titles: {
      flex: 1,
      gap: 2,
    },
    eyebrow: {
      color: c.accent,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1.6,
      textTransform: "uppercase",
      marginBottom: 2,
    },
    title: {
      color: c.text,
      ...typography.title,
    },
    largeTitle: {
      ...typography.display,
    },
    subtitle: {
      color: c.muted,
      ...typography.caption,
    },
    right: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
  });