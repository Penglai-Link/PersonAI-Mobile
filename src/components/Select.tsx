import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type PressableInstance,
} from "react-native";

import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { Ionicons } from "./icons";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  dismissLabel?: string;
}

interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  openUp: boolean;
  maxHeight: number;
}

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
const OPTION_HEIGHT = 44;
const MENU_MAX_HEIGHT = 280;

/**
 * Floating dropdown. The menu renders in a modal layer and is positioned from
 * the field's measured coordinates, so opening it never changes the page
 * layout or pushes surrounding content down.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  dismissLabel,
}: SelectProps<T>) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const fieldRef = useRef<PressableInstance>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    // A stale anchor would misplace the floating menu after rotation/resize.
    setAnchor(null);
  }, [windowHeight, windowWidth]);

  const openMenu = () => {
    fieldRef.current?.measureInWindow((x, y, width, height) => {
      const menuHeight = Math.min(
        options.length * OPTION_HEIGHT + 2,
        MENU_MAX_HEIGHT,
      );
      const spaceBelow = windowHeight - (y + height) - VIEWPORT_MARGIN;
      const spaceAbove = y - VIEWPORT_MARGIN;
      const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      const available = openUp ? spaceAbove : spaceBelow;
      setAnchor({
        x,
        y,
        width,
        height,
        openUp,
        maxHeight: Math.max(OPTION_HEIGHT + 2, Math.min(menuHeight, available)),
      });
    });
  };

  const closeMenu = () => setAnchor(null);

  return (
    <View style={styles.root}>
      <Pressable
        ref={fieldRef}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? selected?.label}
        accessibilityState={{ expanded: anchor !== null }}
        onPress={() => {
          if (anchor) closeMenu();
          else openMenu();
        }}
        style={({ pressed }) => [
          styles.field,
          anchor && styles.fieldOpen,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.value} numberOfLines={1}>
          {selected?.label ?? ""}
        </Text>
        <Ionicons
          name={anchor ? "chevron-up" : "chevron-down"}
          size={16}
          color={anchor ? palette.accent : palette.muted}
        />
      </Pressable>

      <Modal
        visible={anchor !== null}
        transparent
        animationType="none"
        onRequestClose={closeMenu}
        statusBarTranslucent
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dismissLabel}
            style={StyleSheet.absoluteFill}
            onPress={closeMenu}
          />
          {anchor ? (
            <View
              style={[
                styles.menu,
                {
                  left: Math.max(
                    VIEWPORT_MARGIN,
                    Math.min(
                      anchor.x,
                      windowWidth - anchor.width - VIEWPORT_MARGIN,
                    ),
                  ),
                  width: anchor.width,
                  maxHeight: anchor.maxHeight,
                  ...(anchor.openUp
                    ? {
                        bottom:
                          windowHeight - anchor.y + MENU_GAP,
                      }
                    : {
                        top: anchor.y + anchor.height + MENU_GAP,
                      }),
                },
              ]}
            >
              <ScrollView
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
                {options.map((option, index) => {
                  const active = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={option.label}
                      onPress={() => {
                        closeMenu();
                        if (!active) onChange(option.value);
                      }}
                      style={({ pressed }) => [
                        styles.option,
                        index > 0 && styles.optionDivider,
                        active && styles.optionActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionLabel,
                          active && styles.optionLabelActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                      {active ? (
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={palette.accent}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      width: "100%",
    },
    field: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 46,
      paddingHorizontal: spacing.md,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    fieldOpen: {
      borderColor: c.accentBorder,
    },
    value: {
      flex: 1,
      color: c.text,
      ...typography.body,
    },
    modalRoot: {
      flex: 1,
      backgroundColor: "transparent",
    },
    menu: {
      position: "absolute",
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
      overflow: "hidden",
      shadowColor: "#000000",
      shadowOpacity: 0.24,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 16,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: OPTION_HEIGHT,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
    },
    optionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    optionActive: {
      backgroundColor: c.accentSoft,
    },
    optionLabel: {
      flex: 1,
      color: c.text,
      ...typography.body,
    },
    optionLabelActive: {
      color: c.accent,
      fontWeight: "600",
    },
    pressed: {
      opacity: 0.75,
    },
  });