import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { LoadingView } from "../components/LoadingView";
import { Screen } from "../components/Screen";
import { Ionicons } from "../components/icons";
import { useI18n } from "../i18n";
import type { RootStackParamList } from "../navigation/types";
import { useConnections, type Product } from "../store/connections";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Products">;

export function ProductsScreen({ navigation }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const { products, nodes, ready } = useConnections();

  const openProduct = useCallback(
    (product: Product) => {
      // NodesScreen derives the active product from its route params. Selecting
      // it here as well can race with the navigation update on slower renders.
      navigation.navigate("Nodes", { productCode: product.code });
    },
    [navigation],
  );

  const nodeCountFor = useCallback(
    (productCode: string) =>
      nodes.filter((node) => node.productCode === productCode).length,
    [nodes],
  );

  return (
    <Screen>
      <AppHeader
        title={t("产品")}
      />

      {!ready ? (
        <LoadingView label={t("正在读取本机产品…")} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {products.length === 0 ? (
            <EmptyState
              icon="cube-outline"
              title={t("还没有产品")}
              message={t("还没有产品，去设置里添加一个。")}
            />
          ) : (
            <View style={styles.list}>
              {products.map((product) => {
                const nodeCount = nodeCountFor(product.code);
                return (
                  <Pressable
                    key={product.code}
                    accessibilityRole="button"
                    accessibilityLabel={format("打开产品：{name}", {
                      name: product.name,
                    })}
                    accessibilityHint={t("查看该产品的节点（电脑）列表")}
                    onPress={() => openProduct(product)}
                    style={({ pressed }) => [
                      styles.card,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.avatar}>
                      <Ionicons
                        name="cube-outline"
                        size={20}
                        color={palette.accent}
                      />
                    </View>
                    <View style={styles.cardText}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={1}>
                          {product.name}
                        </Text>
                        {product.builtIn ? (
                          <Badge label={t("内置")} tone="accent" />
                        ) : null}
                      </View>
                      <Text style={styles.code} numberOfLines={1}>
                        {product.code}
                      </Text>
                    </View>
                    <View style={styles.metaBlock}>
                      <Text style={styles.nodeCount}>{nodeCount}</Text>
                      <Text style={styles.nodeLabel}>
                        {nodeCount === 1
                          ? t("节点", "singular")
                          : t("节点", "count")}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={palette.muted}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    content: {
      paddingBottom: spacing.xxxl,
      gap: spacing.lg,
    },
    list: {
      gap: spacing.md,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.lg,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.card,
    },
    pressed: {
      opacity: 0.75,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    cardText: {
      flex: 1,
      gap: 4,
      minWidth: 0,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    name: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 16,
      flexShrink: 1,
    },
    code: {
      color: c.muted,
      ...typography.mono,
    },
    metaBlock: {
      alignItems: "flex-end",
    },
    nodeCount: {
      color: c.accent,
      ...typography.bodyStrong,
      fontSize: 16,
    },
    nodeLabel: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
  });