import { Ionicons } from "@expo/vector-icons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChatSession } from "../api/tron";
import { useI18n } from "../i18n";
import type { SavedNode } from "../store/connections";
import {
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { DrawerTree } from "./DrawerTree";
import type { RootStackParamList } from "./types";

interface DrawerContextValue {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);
  const toggleDrawer = useCallback(() => setIsOpen((value) => !value), []);

  useEffect(() => {
    if (!isOpen || Platform.OS === "web") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setIsOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const value = useMemo<DrawerContextValue>(
    () => ({ isOpen, openDrawer, closeDrawer, toggleDrawer }),
    [closeDrawer, isOpen, openDrawer, toggleDrawer],
  );

  return (
    <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
  );
}

export function useDrawer(): DrawerContextValue {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error("useDrawer must be used inside DrawerProvider");
  }
  return context;
}

interface AppDrawerProps {
  currentRoute?: keyof RootStackParamList;
  onOpenSettings: () => void;
  onScan: () => void;
  onOpenSession: (
    node: SavedNode,
    session: ChatSession,
    workspaceCode: string,
  ) => void;
}

export function AppDrawer({
  currentRoute,
  onOpenSettings,
  onScan,
  onOpenSession,
}: AppDrawerProps) {
  const { isOpen, closeDrawer } = useDrawer();
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const panelWidth = Math.min(352, Math.max(280, windowWidth * 0.86));
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: isOpen ? 1 : 0,
      duration: isOpen ? 260 : 200,
      easing: isOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [isOpen, progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth, 0],
  });

  const settingsActive = currentRoute === "Settings";

  return (
    <View
      style={styles.overlay}
      pointerEvents={isOpen ? "box-none" : "none"}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.backdrop,
          { opacity: progress },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("关闭菜单")}
        style={StyleSheet.absoluteFill}
        onPress={closeDrawer}
      />

      <Animated.View
        accessibilityElementsHidden={!isOpen}
        importantForAccessibility={isOpen ? "auto" : "no-hide-descendants"}
        style={[
          styles.panel,
          {
            width: panelWidth,
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.sm,
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={styles.brandRow}>
          <Text style={styles.brandName}>PersonAI Mobile</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("扫码添加节点")}
            onPress={onScan}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="qr-code-outline" size={19} color={palette.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("设置")}
            accessibilityState={{ selected: settingsActive }}
            onPress={onOpenSettings}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerButton,
              settingsActive && styles.headerButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="settings-outline"
              size={19}
              color={settingsActive ? palette.accent : palette.text}
            />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <DrawerTree active={isOpen} onOpenSession={onOpenSession} />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    overlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 100,
      elevation: 100,
    },
    backdrop: {
      backgroundColor: c.scrim,
    },
    panel: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: c.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: c.border,
      shadowColor: "#000000",
      shadowOpacity: 0.28,
      shadowRadius: 24,
      shadowOffset: { width: 6, height: 0 },
      elevation: 24,
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    brandName: {
      flex: 1,
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 16,
      letterSpacing: 0.2,
    },
    headerButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    headerButtonActive: {
      backgroundColor: c.accentSoft,
      borderColor: c.accentBorder,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
    },
    pressed: {
      opacity: 0.72,
    },
  });