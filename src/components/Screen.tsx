import type { ReactNode } from "react";
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { layout, useThemedStyles, type Palette } from "../theme";

interface ScreenProps {
  children: ReactNode;
  /** Applies responsive horizontal gutters. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  maxWidth?: number;
}

export function Screen({
  children,
  padded = true,
  style,
  maxWidth = layout.maxContentWidth,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const styles = useThemedStyles(createStyles);
  const wide = width >= layout.wideBreakpoint;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View
        style={[
          styles.inner,
          { maxWidth },
          padded && {
            paddingHorizontal: wide ? 32 : 20,
          },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    inner: {
      flex: 1,
      width: "100%",
      alignSelf: "center",
    },
  });