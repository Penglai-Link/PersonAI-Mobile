import { useEffect, useRef } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { Ionicons, type IconName } from "./icons";

export interface ActionMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

interface ActionMenuProps {
  visible: boolean;
  anchor: ActionMenuAnchor | null;
  items: ReadonlyArray<ActionMenuItem>;
  onClose: () => void;
  dismissLabel?: string;
}

const MENU_WIDTH = 208;
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
const ITEM_HEIGHT = 46;
const MENU_BORDER = 2;

/** Android has no modal `onDismiss`, so give the window a beat to settle. */
const ANDROID_DISMISS_DELAY = 120;

/**
 * A small floating menu anchored to the control that opened it. Actions run
 * only after the menu is fully dismissed, so a follow-up `Alert` (for example a
 * destructive confirmation) is presented on a settled screen.
 */
export function ActionMenu({
  visible,
  anchor,
  items,
  onClose,
  dismissLabel,
}: ActionMenuProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const pendingRef = useRef<(() => void) | null>(null);

  const runPending = () => {
    const action = pendingRef.current;
    pendingRef.current = null;
    action?.();
  };

  useEffect(() => {
    // Anchors measured before a rotation/resize no longer line up.
    if (visible) onClose();
  }, [windowHeight, windowWidth]);

  useEffect(() => {
    if (visible || !pendingRef.current) return;
    if (Platform.OS === "ios" || Platform.OS === "web") return;
    const timer = setTimeout(runPending, ANDROID_DISMISS_DELAY);
    return () => clearTimeout(timer);
  }, [visible]);

  const select = (item: ActionMenuItem) => {
    pendingRef.current = item.onPress;
    onClose();
  };

  const menuHeight = items.length * ITEM_HEIGHT + MENU_BORDER;
  let menuStyle = null;
  if (visible && anchor) {
    const spaceBelow =
      windowHeight - (anchor.y + anchor.height) - VIEWPORT_MARGIN;
    const spaceAbove = anchor.y - VIEWPORT_MARGIN;
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(
        anchor.x + anchor.width - MENU_WIDTH,
        windowWidth - MENU_WIDTH - VIEWPORT_MARGIN,
      ),
    );
    menuStyle = {
      left,
      maxHeight: Math.max(
        ITEM_HEIGHT + MENU_BORDER,
        Math.min(menuHeight, openUp ? spaceAbove : spaceBelow),
      ),
      ...(openUp
        ? { bottom: windowHeight - anchor.y + MENU_GAP }
        : { top: anchor.y + anchor.height + MENU_GAP }),
    };
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onDismiss={runPending}
      statusBarTranslucent
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        {menuStyle ? (
          <View style={[styles.menu, menuStyle]}>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              {items.map((item, index) => (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => select(item)}
                  style={({ pressed }) => [
                    styles.item,
                    index > 0 && styles.itemDivider,
                    pressed && styles.itemPressed,
                  ]}
                >
                  {item.icon ? (
                    <Ionicons
                      name={item.icon}
                      size={17}
                      color={item.destructive ? palette.danger : palette.muted}
                    />
                  ) : null}
                  <Text
                    style={[
                      styles.itemLabel,
                      item.destructive && styles.itemLabelDestructive,
                    ]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    modalRoot: {
      flex: 1,
      backgroundColor: "transparent",
    },
    menu: {
      position: "absolute",
      width: MENU_WIDTH,
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
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: ITEM_HEIGHT,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
    },
    itemDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    itemPressed: {
      backgroundColor: c.surfaceAlt,
    },
    itemLabel: {
      flex: 1,
      color: c.text,
      ...typography.body,
    },
    itemLabelDestructive: {
      color: c.danger,
    },
  });