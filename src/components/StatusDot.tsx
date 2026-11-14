import { StyleSheet, View } from "react-native";

import { useTheme, useThemedStyles, type Palette } from "../theme";

interface StatusDotProps {
  online: boolean | null;
  size?: number;
}

export function StatusDot({ online, size = 8 }: StatusDotProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const color =
    online === true
      ? palette.accent
      : online === false
        ? palette.danger
        : palette.muted;
  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        online === true && {
          shadowColor: palette.accent,
          shadowOpacity: 0.9,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
          elevation: 3,
        },
      ]}
    />
  );
}

const createStyles = (_c: Palette) =>
  StyleSheet.create({
    dot: {
      flexShrink: 0,
    },
  });