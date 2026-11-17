import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
  type Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useCallback, useMemo, useState } from "react";
import { PanResponder, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ASSISTANT_SOURCE_TYPE, type ChatSession } from "./api/tron";
import { LanguageProvider } from "./i18n";
import { AppDrawer, DrawerProvider, useDrawer } from "./navigation/Drawer";
import type { RootStackParamList } from "./navigation/types";
import { AddNodeScreen } from "./screens/AddNodeScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { NodesScreen } from "./screens/NodesScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import {
  ConnectionsProvider,
  useConnections,
  type SavedNode,
} from "./store/connections";
import { NodeLatencyProvider } from "./store/nodeLatency";
import { NodeSessionProvider } from "./store/nodeSession";
import { ThemeProvider, useTheme } from "./theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { palette, resolvedMode } = useTheme();
  const { closeDrawer, isOpen, openDrawer } = useDrawer();
  const { products, selectNode } = useConnections();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [routeName, setRouteName] =
    useState<keyof RootStackParamList>("Dashboard");

  // The drawer has no visible trigger. A rightward drag from the left edge
  // opens it on every screen; the native-stack back gesture is disabled below
  // so the two gestures can never compete for the same edge.
  const edgeSwipe = useMemo(() => {
    const releaseSelection = () => {
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.body.style.userSelect = "";
      }
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        !isOpen &&
        gesture.x0 <= 28 &&
        gesture.dx > 12 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderGrant: () => {
        if (Platform.OS === "web" && typeof document !== "undefined") {
          window.getSelection()?.removeAllRanges();
          document.body.style.userSelect = "none";
        }
        openDrawer();
      },
      onPanResponderRelease: releaseSelection,
      onPanResponderTerminate: releaseSelection,
      onPanResponderTerminationRequest: () => false,
    });
  }, [isOpen, openDrawer]);

  const navigationTheme = useMemo<Theme>(() => {
    const base = resolvedMode === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: palette.accent,
        background: palette.background,
        card: palette.surface,
        text: palette.text,
        border: palette.border,
        notification: palette.danger,
      },
    };
  }, [palette, resolvedMode]);

  const openDashboard = useCallback(() => {
    closeDrawer();
    if (navigationRef.isReady()) navigationRef.navigate("Dashboard");
  }, [closeDrawer, navigationRef]);

  const openSettings = useCallback(() => {
    closeDrawer();
    if (navigationRef.isReady()) navigationRef.navigate("Settings");
  }, [closeDrawer, navigationRef]);

  const openScanner = useCallback(() => {
    closeDrawer();
    if (!navigationRef.isReady()) return;
    const productCode = products[0]?.code;
    if (!productCode) return;
    navigationRef.navigate("AddNode", { productCode, mode: "scan" });
  }, [closeDrawer, navigationRef, products]);

  const openSessionFromDrawer = useCallback(
    (
      node: SavedNode,
      session: ChatSession,
      workspaceCode: string,
    ) => {
      closeDrawer();
      selectNode(node);
      if (!navigationRef.isReady()) return;
      const isAssistant =
        (session.sourceType ?? "").toUpperCase() === ASSISTANT_SOURCE_TYPE;
      navigationRef.navigate("Chat", {
        session,
        workspaceCode: workspaceCode || session.workspaceCode || "",
        assistantCode: isAssistant ? (session.sourceCode ?? null) : null,
        assistantName: null,
      });
    },
    [closeDrawer, navigationRef, selectNode],
  );

  return (
    <View
      {...edgeSwipe.panHandlers}
      style={[styles.root, { backgroundColor: palette.background }]}
    >
      <StatusBar style={resolvedMode === "dark" ? "light" : "dark"} />
      <NavigationContainer
        ref={navigationRef}
        theme={navigationTheme}
        onStateChange={() => {
          const name = navigationRef.getCurrentRoute()?.name;
          if (name) setRouteName(name as keyof RootStackParamList);
        }}
      >
        <Stack.Navigator
          initialRouteName="Dashboard"
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
            // The drawer owns the left-edge gesture; swipe-back would race it.
            gestureEnabled: false,
            contentStyle: { backgroundColor: palette.background },
          }}
        >
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="Nodes" component={NodesScreen} />
          <Stack.Screen name="AddNode" component={AddNodeScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <AppDrawer
        currentRoute={routeName}
        onOpenDashboard={openDashboard}
        onOpenSettings={openSettings}
        onScan={openScanner}
        onOpenSession={openSessionFromDrawer}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <ConnectionsProvider>
          <NodeSessionProvider>
            <NodeLatencyProvider>
              <ThemeProvider>
                <DrawerProvider>
                  <AppNavigator />
                </DrawerProvider>
              </ThemeProvider>
            </NodeLatencyProvider>
          </NodeSessionProvider>
        </ConnectionsProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});