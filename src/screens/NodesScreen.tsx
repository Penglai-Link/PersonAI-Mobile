import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { isSecureBaseUrl } from "../api/client";
import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { LoadingView } from "../components/LoadingView";
import { Screen } from "../components/Screen";
import { StatusDot } from "../components/StatusDot";
import { Ionicons } from "../components/icons";
import type { RootStackParamList } from "../navigation/types";
import { useConnections, type SavedNode } from "../store/connections";
import { useNodeSession } from "../store/nodeSession";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { describeError, formatDateTime } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Nodes">;

export function NodesScreen({ navigation, route }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const productCode = route.params.productCode;
  const {
    products,
    nodes,
    ready,
    probing,
    currentProductCode,
    currentNode,
    selectProduct,
    selectNode,
    removeNode,
    refreshNodeStatuses,
    getPairingToken,
  } = useConnections();
  const { status: sessionStatus } = useNodeSession();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const product = products.find((item) => item.code === productCode) ?? null;
  const productNodes = useMemo(
    () => nodes.filter((node) => node.productCode === productCode),
    [nodes, productCode],
  );

  useEffect(() => {
    if (currentProductCode !== productCode) {
      selectProduct(productCode);
    }
  }, [currentProductCode, productCode, selectProduct]);

  useFocusEffect(
    useCallback(() => {
      void refreshNodeStatuses();
    }, [refreshNodeStatuses]),
  );

  const openNode = useCallback(
    async (node: SavedNode) => {
      if (openingId) return;
      setOpeningId(node.id);
      try {
        const pairingToken = await getPairingToken(node.id);
        if (!pairingToken) {
          Alert.alert(
            "配对令牌丢失",
            "这台节点的配对令牌已不存在，请删除后重新扫码或手动配对。",
          );
          return;
        }
        selectNode(node);
        navigation.navigate("Home");
      } finally {
        setOpeningId(null);
      }
    },
    [getPairingToken, navigation, openingId, selectNode],
  );

  const remove = useCallback(
    (node: SavedNode) => {
      const run = () => {
        void removeNode(node.id).catch((error) => {
          Alert.alert("删除失败", describeError(error));
        });
      };
      if (Platform.OS === "web") {
        if (
          typeof window !== "undefined" &&
          window.confirm(`确定删除「${node.name}」？系统安全存储中的配对令牌也会被删除。`)
        ) {
          run();
        }
        return;
      }
      Alert.alert(
        "删除节点",
        `确定删除「${node.name}」？系统安全存储中的配对令牌也会被删除。`,
        [
          { text: "取消", style: "cancel" },
          { text: "删除", style: "destructive", onPress: run },
        ],
      );
    },
    [removeNode],
  );

  const goBack = useCallback(() => {
    selectProduct(productCode);
    navigation.goBack();
  }, [navigation, productCode, selectProduct]);

  const showBlocked = useCallback(
    (node: SavedNode) => !isSecureBaseUrl(node.baseUrl) && !node.allowInsecure,
    [],
  );

  return (
    <Screen>
      <AppHeader
        eyebrow={product?.code ?? productCode}
        title={product?.name ?? "产品"}
        subtitle="选择节点（电脑）"
        onBack={goBack}
        right={
          <Button
            label="添加节点"
            icon="add"
            small
            onPress={() =>
              navigation.navigate("AddNode", { productCode })
            }
          />
        }
      />

      {!ready ? (
        <LoadingView label="正在读取已保存的节点…" />
      ) : productNodes.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={probing}
              onRefresh={() => void refreshNodeStatuses()}
              tintColor={palette.accent}
              colors={[palette.accent]}
              progressBackgroundColor={palette.surface}
            />
          }
        >
          <EmptyState
            icon="laptop-outline"
            title="还没有节点"
            message="在电脑端 Tron 的“设置 → 通用 → 手机访问”中打开配对二维码，或手动输入节点地址与配对令牌。"
            action={
              <View style={styles.emptyActions}>
                <Button
                  label="扫码添加"
                  icon="qr-code-outline"
                  fullWidth
                  onPress={() =>
                    navigation.navigate("AddNode", { productCode, mode: "scan" })
                  }
                />
                <Button
                  label="手动添加"
                  icon="create-outline"
                  variant="secondary"
                  fullWidth
                  onPress={() =>
                    navigation.navigate("AddNode", {
                      productCode,
                      mode: "manual",
                    })
                  }
                />
              </View>
            }
          />
          <Text style={styles.securityNote}>
            配对令牌保存在系统安全存储。JWT 和会话内容只保存在内存，离开节点即清空。
          </Text>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={probing}
              onRefresh={() => void refreshNodeStatuses()}
              tintColor={palette.accent}
              colors={[palette.accent]}
              progressBackgroundColor={palette.surface}
            />
          }
        >
          <View style={styles.list}>
            {productNodes.map((node) => {
              const blocked = showBlocked(node);
              const sessionOffline =
                currentNode?.id === node.id && sessionStatus === "offline";
              const online = sessionOffline ? false : node.online;
              return (
                <NodeCard
                  key={node.id}
                  node={node}
                  online={online}
                  blocked={blocked}
                  current={currentNode?.id === node.id}
                  opening={openingId === node.id}
                  onOpen={() => void openNode(node)}
                  onRemove={() => remove(node)}
                />
              );
            })}
          </View>
          <Text style={styles.securityNote}>
            点击卡片进入节点；点击右上角菜单可删除节点并清除其配对令牌。
          </Text>
        </ScrollView>
      )}

      {openingId ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : null}
    </Screen>
  );
}

function NodeCard({
  node,
  online,
  blocked,
  current,
  opening,
  onOpen,
  onRemove,
}: {
  node: SavedNode;
  online: boolean | null;
  blocked: boolean;
  current: boolean;
  opening: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const statusLabel = blocked
    ? "已阻止"
    : online === true
      ? "在线"
      : online === false
        ? "离线"
        : "检测中";

  return (
    <View style={[styles.card, current && styles.cardCurrent]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`打开节点 ${node.name}`}
        accessibilityHint="进入该节点的会话首页，长按可删除"
        onPress={onOpen}
        onLongPress={onRemove}
        delayLongPress={450}
        style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
      >
        <View style={styles.cardTop}>
          <View style={styles.avatar}>
            {opening ? (
              <Ionicons name="sync" size={18} color={palette.accent} />
            ) : (
              <Ionicons name="desktop-outline" size={18} color={palette.accent} />
            )}
          </View>
          <View style={styles.titleBlock}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {node.name}
              </Text>
              {current ? <Badge label="当前" tone="accent" /> : null}
              {node.nodeId ? (
                <Badge label={node.nodeId} tone="muted" />
              ) : null}
            </View>
            <View style={styles.statusRow}>
              <StatusDot online={blocked ? false : online} />
              <Text style={styles.statusText}>{statusLabel}</Text>
              {node.platform ? (
                <Text style={styles.statusText}>· {node.platform}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={styles.address} numberOfLines={1}>
          {node.baseUrl}
        </Text>

        {!isSecureBaseUrl(node.baseUrl) ? (
          <Badge
            label={node.allowInsecure ? "不安全调试（非 HTTPS）" : "非 HTTPS，已阻止"}
            tone="danger"
          />
        ) : null}

        <View style={styles.cardFooter}>
          <Text style={styles.footerText}>
            最近连接 {formatDateTime(node.lastConnectedAt)}
          </Text>
          {node.version ? (
            <Text style={styles.footerText}>v{node.version}</Text>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`删除节点 ${node.name}`}
        onPress={onRemove}
        hitSlop={8}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={palette.muted} />
      </Pressable>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    emptyScroll: {
      flexGrow: 1,
      justifyContent: "center",
      paddingBottom: spacing.xxxl,
      gap: spacing.xl,
    },
    emptyActions: {
      width: "100%",
      maxWidth: 360,
      gap: spacing.sm,
    },
    listContent: {
      paddingBottom: spacing.xxxl,
      gap: spacing.lg,
    },
    list: {
      gap: spacing.md,
    },
    card: {
      position: "relative",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.card,
      overflow: "hidden",
    },
    cardCurrent: {
      borderColor: c.accentBorder,
    },
    cardBody: {
      padding: spacing.lg,
      gap: spacing.md,
    },
    pressed: {
      opacity: 0.75,
    },
    cardTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingRight: 28,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    titleBlock: {
      flex: 1,
      gap: 4,
      minWidth: 0,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    name: {
      color: c.text,
      ...typography.bodyStrong,
      flexShrink: 1,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    statusText: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    address: {
      color: c.muted,
      fontFamily: Platform.select({
        ios: "Menlo",
        android: "monospace",
        default: "monospace",
      }),
      ...typography.mono,
    },
    cardFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.md,
    },
    footerText: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    moreButton: {
      position: "absolute",
      top: spacing.md,
      right: spacing.md,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    securityNote: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
      textAlign: "center",
      lineHeight: 17,
      paddingHorizontal: spacing.xl,
    },
    overlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.scrim,
    },
  });