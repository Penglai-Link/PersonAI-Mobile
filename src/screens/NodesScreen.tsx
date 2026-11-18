import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type PressableInstance,
} from "react-native";

import { loadDeviceKey } from "../crypto/keys";
import { ActionMenu, type ActionMenuItem } from "../components/ActionMenu";
import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { LoadingView } from "../components/LoadingView";
import { NodeLatencyText } from "../components/NodeLatency";
import { Screen } from "../components/Screen";
import { useI18n } from "../i18n";
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
import { confirmDestructive } from "../utils/confirm";
import { describeError, formatDateTime } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Nodes">;

export function NodesScreen({ navigation, route }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const productCode = route.params.productCode;
  const {
    products,
    nodes,
    ready,
    currentProductCode,
    currentNode,
    selectProduct,
    selectNode,
    removeNode,
    refreshNodeStatuses,
  } = useConnections();
  const { status: sessionStatus } = useNodeSession();
  const [openingId, setOpeningId] = useState<string | null>(null);
  // The native pull-to-refresh spinner is user-initiated only. It used to be
  // bound to the global `probing` flag, so every background probe (focus,
  // network path update) animated the spinner without anyone pulling.
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const onPullRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await refreshNodeStatuses();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [refreshNodeStatuses]);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={() => void onPullRefresh()}
        tintColor={palette.accent}
        colors={[palette.accent]}
        progressBackgroundColor={palette.surface}
      />
    ),
    [onPullRefresh, palette.accent, palette.surface, refreshing],
  );

  const product = products.find((item) => item.code === productCode) ?? null;
  const productNodes = useMemo(
    () => nodes.filter((node) => node.productCode === productCode),
    [nodes, productCode],
  );

  // Route params are the single source of truth for the active product. The
  // drawer and product list only navigate here; selecting in both places used
  // to race and made the "switch product" highlight bounce during the close
  // animation.
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
        // The device private key is the only credential; if SecureStore lost it
        // the node must be re-paired.
        const deviceKey = await loadDeviceKey(node.nodeId);
        if (!deviceKey) {
          Alert.alert(
            t("设备密钥丢失"),
            t("这台节点的设备密钥已不存在，请删除后重新扫码配对。"),
          );
          return;
        }
        selectNode(node);
        navigation.navigate("Home");
      } finally {
        setOpeningId(null);
      }
    },
    [navigation, openingId, selectNode, t],
  );

  const remove = useCallback(
    (node: SavedNode) => {
      confirmDestructive({
        title: t("删除节点"),
        message: format(
          "确定删除「{name}」？系统安全存储中的设备密钥也会被删除。",
          { name: node.name },
        ),
        onConfirm: () => {
          void removeNode(node.id).catch((error) => {
            Alert.alert(t("删除失败"), describeError(error));
          });
        },
      });
    },
    [format, removeNode, t],
  );

  return (
    <Screen>
      <AppHeader
        title={product?.name ?? t("产品", "singular")}
        onBack={() => navigation.navigate("Dashboard")}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("添加节点")}
            onPress={() => navigation.navigate("AddNode", { productCode })}
            hitSlop={8}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="add" size={22} color={palette.accent} />
          </Pressable>
        }
      />

      {!ready ? (
        <LoadingView label={t("正在读取已保存的节点…")} />
      ) : productNodes.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={refreshControl}
        >
          <EmptyState
            icon="laptop-outline"
            title={t("还没有节点")}
            message={t(
              "在电脑端打开配对二维码，或手动粘贴配对链接。",
            )}
            action={
              <View style={styles.emptyActions}>
                <Button
                  label={t("扫码添加")}
                  icon="qr-code-outline"
                  fullWidth
                  onPress={() =>
                    navigation.navigate("AddNode", { productCode, mode: "scan" })
                  }
                />
                <Button
                  label={t("手动添加")}
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
          />        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={refreshControl}
        >
          <View style={styles.list}>
            {productNodes.map((node) => {
              const sessionOffline =
                currentNode?.id === node.id &&
                (sessionStatus === "offline" ||
                  sessionStatus === "unauthorized");
              const credentialInvalid =
                currentNode?.id === node.id && sessionStatus === "unauthorized";
              const online = sessionOffline ? false : node.online;
              return (
                <NodeCard
                  key={node.id}
                  node={node}
                  online={online}
                  credentialInvalid={credentialInvalid}
                  current={currentNode?.id === node.id}
                  opening={openingId === node.id}
                  onOpen={() => void openNode(node)}
                  onRemove={() => remove(node)}
                />
              );
            })}
          </View>        </ScrollView>
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
  credentialInvalid,
  current,
  opening,
  onOpen,
  onRemove,
}: {
  node: SavedNode;
  online: boolean | null;
  credentialInvalid: boolean;
  current: boolean;
  opening: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const moreRef = useRef<PressableInstance>(null);
  const [menuAnchor, setMenuAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const statusLabel = credentialInvalid
    ? t("凭证失效")
    : online === true
      ? t("在线")
      : online === false
        ? t("离线")
        : t("检测中");

  const openMenu = useCallback(() => {
    moreRef.current?.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ x, y, width, height });
    });
  }, []);

  const menuItems: ActionMenuItem[] = useMemo(
    () => [
      {
        key: "open",
        label: t("打开节点"),
        icon: "open-outline",
        onPress: onOpen,
      },
      {
        key: "delete",
        label: t("删除节点"),
        icon: "trash-outline",
        destructive: true,
        onPress: onRemove,
      },
    ],
    [onOpen, onRemove, t],
  );

  return (
    <View style={[styles.card, current && styles.cardCurrent]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={format("打开节点：{name}", { name: node.name })}
        accessibilityHint={t("进入该节点的会话首页，长按可管理节点")}
        onPress={onOpen}
        onLongPress={openMenu}
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
              {current ? <Badge label={t("当前")} tone="accent" /> : null}
              {node.nodeId ? (
                <Badge label={node.nodeId} tone="muted" />
              ) : null}
            </View>
            <View style={styles.statusRow}>
              <StatusDot online={online} />
              <Text style={styles.statusText}>{statusLabel}</Text>
              {node.platform ? (
                <Text style={styles.statusText}>· {node.platform}</Text>
              ) : null}
              <NodeLatencyText
                nodeId={node.id}
                leadingSeparator="·"
                style={styles.statusText}
              />
            </View>
          </View>
        </View>

        <Text style={styles.address} numberOfLines={1}>
          {node.baseUrl}
        </Text>

        <View style={styles.badgeRow}>
          <Badge
            label={
              node.transport === "public"
                ? t("公网 WSS + Noise")
                : t("局域网 WS + Noise")
            }
            tone={node.transport === "public" ? "success" : "muted"}
          />
          <Badge label={node.keyId} tone="muted" />
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.footerText}>
            {format("最近连接 {time}", {
              time: formatDateTime(node.lastConnectedAt),
            })}
          </Text>
          {node.version ? (
            <Text style={styles.footerText}>v{node.version}</Text>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        ref={moreRef}
        accessibilityRole="button"
        accessibilityLabel={format("节点菜单：{name}", { name: node.name })}
        accessibilityHint={t("打开节点操作菜单")}
        accessibilityState={{ expanded: menuAnchor !== null }}
        onPress={openMenu}
        hitSlop={8}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={palette.muted} />
      </Pressable>

      <ActionMenu
        visible={menuAnchor !== null}
        anchor={menuAnchor}
        items={menuItems}
        onClose={() => setMenuAnchor(null)}
        dismissLabel={t("关闭菜单")}
      />
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
    badgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    pressed: {
      opacity: 0.75,
    },
    addButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
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