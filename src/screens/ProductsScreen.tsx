import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { InlineBanner } from "../components/InlineBanner";
import { LoadingView } from "../components/LoadingView";
import { Screen } from "../components/Screen";
import { TextField } from "../components/TextField";
import { Ionicons } from "../components/icons";
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
import { describeError } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Products">;

function confirmDestructive(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "取消", style: "cancel" },
    { text: "删除", style: "destructive", onPress: onConfirm },
  ]);
}

export function ProductsScreen({ navigation }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const {
    products,
    nodes,
    ready,
    addProduct,
    removeProduct,
    selectProduct,
  } = useConnections();

  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const openProduct = useCallback(
    (product: Product) => {
      selectProduct(product.code);
      navigation.navigate("Nodes", { productCode: product.code });
    },
    [navigation, selectProduct],
  );

  const remove = useCallback(
    (product: Product) => {
      if (product.builtIn) return;
      confirmDestructive(
        "删除产品",
        `确定删除「${product.name}」？该产品下保存的节点和配对令牌也会一并删除。`,
        () => {
          void removeProduct(product.code).catch((error) => {
            Alert.alert("删除失败", describeError(error));
          });
        },
      );
    },
    [removeProduct],
  );

  const submitProduct = useCallback(() => {
    setFormError(null);
    try {
      addProduct({ code, name });
      setCode("");
      setName("");
      setShowAdd(false);
    } catch (error) {
      setFormError(describeError(error));
    }
  }, [addProduct, code, name]);

  const nodeCountFor = useCallback(
    (productCode: string) =>
      nodes.filter((node) => node.productCode === productCode).length,
    [nodes],
  );

  return (
    <Screen>
      <AppHeader
        eyebrow="PERSONAI MOBILE"
        title="产品"
        subtitle="先选产品，再选该产品的节点"
        right={
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="外观与皮肤"
              onPress={() => navigation.navigate("Appearance")}
              style={({ pressed }) => [
                styles.headerIconButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="color-palette-outline" size={18} color={palette.text} />
            </Pressable>
            <Button
              label="添加产品"
              icon="add"
              small
              onPress={() => setShowAdd((value) => !value)}
            />
          </View>
        }
      />

      {!ready ? (
        <LoadingView label="正在读取本机产品…" />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {showAdd ? (
            <Card style={styles.addCard}>
              <Text style={styles.addTitle}>添加产品</Text>
              <Text style={styles.addHint}>
                产品编码用于区分不同的产品线，例如 `tron`、`studio`。编码只能包含小写字母、数字、点和连字符。
              </Text>
              <TextField
                label="产品编码"
                value={code}
                onChangeText={setCode}
                placeholder="例如 studio"
                autoCapitalize="none"
                autoCorrect={false}
                hint="小写字母、数字、点和连字符"
              />
              <TextField
                label="显示名"
                value={name}
                onChangeText={setName}
                placeholder="例如 Tron Studio"
                autoCapitalize="none"
                hint="显示在列表中的产品名称"
              />
              {formError ? <InlineBanner message={formError} /> : null}
              <View style={styles.formActions}>
                <Button
                  label="保存"
                  icon="checkmark"
                  onPress={submitProduct}
                  style={styles.formButton}
                />
                <Button
                  label="取消"
                  variant="secondary"
                  onPress={() => {
                    setShowAdd(false);
                    setFormError(null);
                  }}
                  style={styles.formButton}
                />
              </View>
            </Card>
          ) : null}

          {products.length === 0 ? (
            <EmptyState
              icon="cube-outline"
              title="还没有产品"
              message="内置 Tron 产品不可删除。你仍然可以添加其他产品。"
            />
          ) : (
            <View style={styles.list}>
              {products.map((product) => {
                const nodeCount = nodeCountFor(product.code);
                return (
                  <View key={product.code} style={styles.card}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`打开产品 ${product.name}`}
                      accessibilityHint="查看该产品的节点（电脑）列表"
                      onPress={() => openProduct(product)}
                      onLongPress={() => remove(product)}
                      delayLongPress={450}
                      style={({ pressed }) => [
                        styles.cardBody,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.avatar}>
                        <Ionicons name="cube-outline" size={20} color={palette.accent} />
                      </View>
                      <View style={styles.cardText}>
                        <View style={styles.nameRow}>
                          <Text style={styles.name} numberOfLines={1}>
                            {product.name}
                          </Text>
                          {product.builtIn ? (
                            <Badge label="内置" tone="accent" />
                          ) : null}
                        </View>
                        <Text style={styles.code} numberOfLines={1}>
                          {product.code}
                        </Text>
                      </View>
                      <View style={styles.metaBlock}>
                        <Text style={styles.nodeCount}>{nodeCount}</Text>
                        <Text style={styles.nodeLabel}>节点</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={palette.muted} />
                    </Pressable>

                    {!product.builtIn ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`删除产品 ${product.name}`}
                        onPress={() => remove(product)}
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.trashButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={palette.muted}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          <InlineBanner
            tone="info"
            message="配对令牌保存在系统安全存储；JWT、会话列表和聊天消息只保存在内存，退出应用或切换节点后即清空。"
          />

          <Text style={styles.securityNote}>
            远程节点默认只允许 HTTPS。标记为“不安全调试”的 http 节点需要你显式确认才会连接。
          </Text>
        </ScrollView>
      )}
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    headerIconButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    content: {
      paddingBottom: spacing.xxxl,
      gap: spacing.lg,
    },
    list: {
      gap: spacing.md,
    },
    card: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.card,
      overflow: "hidden",
    },
    cardBody: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.lg,
      paddingRight: 44,
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
    trashButton: {
      position: "absolute",
      top: spacing.md,
      right: spacing.md,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
    },
    addCard: {
      gap: spacing.md,
    },
    addTitle: {
      color: c.text,
      ...typography.section,
    },
    addHint: {
      color: c.muted,
      ...typography.caption,
      lineHeight: 18,
    },
    formActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    formButton: {
      flex: 1,
    },
    securityNote: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
      textAlign: "center",
      lineHeight: 17,
      paddingHorizontal: spacing.xl,
    },
  });