import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { RootStackParamList } from "./navigation/types";
import { AddNodeScreen } from "./screens/AddNodeScreen";
import { AppearanceScreen } from "./screens/AppearanceScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { NodesScreen } from "./screens/NodesScreen";
import { ProductsScreen } from "./screens/ProductsScreen";
import { ConnectionsProvider } from "./store/connections";
import { NodeSessionProvider } from "./store/nodeSession";
import { ThemeProvider, useTheme } from "./theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { palette, resolvedMode } = useTheme();

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

  return (
    <>
      <StatusBar style={resolvedMode === "dark" ? "light" : "dark"} />
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator
          initialRouteName="Products"
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: palette.background },
          }}
        >
          <Stack.Screen name="Products" component={ProductsScreen} />
          <Stack.Screen name="Nodes" component={NodesScreen} />
          <Stack.Screen name="AddNode" component={AddNodeScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Appearance" component={AppearanceScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ConnectionsProvider>
        <NodeSessionProvider>
          <ThemeProvider>
            <AppNavigator />
          </ThemeProvider>
        </NodeSessionProvider>
      </ConnectionsProvider>
    </SafeAreaProvider>
  );
}