import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { radius, spacing, typography, useTheme, useThemedStyles, type Palette } from "../theme";

interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  rightAccessory?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export function TextField({
  label,
  hint,
  error,
  rightAccessory,
  containerStyle,
  inputStyle,
  style,
  multiline,
  ...inputProps
}: TextFieldProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputRow, multiline && styles.inputRowMultiline]}>
        <TextInput
          {...inputProps}
          multiline={multiline}
          placeholderTextColor={palette.muted}
          selectionColor={palette.accent}
          style={[
            styles.input,
            multiline && styles.multiline,
            inputStyle,
            style,
          ]}
        />
        {rightAccessory ? <View style={styles.accessory}>{rightAccessory}</View> : null}
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      gap: spacing.sm,
    },
    label: {
      ...typography.label,
      color: c.muted,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: spacing.md,
    },
    inputRowMultiline: {
      alignItems: "flex-start",
    },
    input: {
      flex: 1,
      minHeight: 46,
      paddingVertical: spacing.md,
      color: c.text,
      ...typography.body,
    },
    multiline: {
      minHeight: 84,
      textAlignVertical: "top",
    },
    accessory: {
      marginLeft: spacing.sm,
      paddingVertical: spacing.sm,
    },
    hint: {
      ...typography.caption,
      color: c.muted,
    },
    error: {
      ...typography.caption,
      color: c.danger,
    },
  });