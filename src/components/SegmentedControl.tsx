import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from "../theme";

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.root} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.item,
              selected && { backgroundColor: palette.accent },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.label,
                selected && { color: palette.onAccent, fontWeight: "700" },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flexDirection: "row",
      padding: 3,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    item: {
      flex: 1,
      minHeight: 36,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.75,
    },
    label: {
      ...typography.bodyStrong,
      fontSize: 13,
      color: c.muted,
    },
  });