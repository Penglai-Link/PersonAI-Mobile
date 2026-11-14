import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { radius, spacing, typography, useTheme } from "../theme";
import { Ionicons, type IconName } from "./icons";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading = false,
  disabled = false,
  small = false,
  fullWidth = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const { palette } = useTheme();
  const isDisabled = disabled || loading;
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";

  const variantStyle: ViewStyle = isPrimary
    ? { backgroundColor: palette.accent, borderColor: palette.accent }
    : variant === "secondary"
      ? { backgroundColor: palette.surface, borderColor: palette.border }
      : isDanger
        ? {
            backgroundColor: palette.dangerSoft,
            borderColor: palette.dangerBorder,
          }
        : { backgroundColor: "transparent", borderColor: "transparent" };

  const contentColor = isPrimary
    ? palette.onAccent
    : isDanger
      ? palette.danger
      : palette.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        small ? styles.small : styles.regular,
        variantStyle,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={isPrimary ? palette.onAccent : isDanger ? palette.danger : palette.accent}
        />
      ) : icon ? (
        <Ionicons name={icon} size={small ? 16 : 18} color={contentColor} />
      ) : null}
      <Text
        style={[
          styles.label,
          small && styles.smallLabel,
          { color: isPrimary ? palette.onAccent : contentColor },
          isPrimary && styles.primaryLabel,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.control,
    borderWidth: 1,
  },
  regular: {
    minHeight: 48,
    paddingHorizontal: spacing.xl,
  },
  small: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
  },
  fullWidth: {
    width: "100%",
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.78,
  },
  label: {
    ...typography.bodyStrong,
  },
  smallLabel: {
    fontSize: 13,
  },
  primaryLabel: {
    fontWeight: "700",
  },
});