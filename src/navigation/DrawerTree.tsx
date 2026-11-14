import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  TRON_PRODUCT_CODE,
  type ChatSession,
  type DirectoryRecord,
  type ProjectRecord,
} from "../api/tron";
import { StatusDot } from "../components/StatusDot";
import { Ionicons } from "../components/icons";
import { useI18n } from "../i18n";
import { useConnections, type Product, type SavedNode } from "../store/connections";
import { useNodeSession } from "../store/nodeSession";
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import {
  describeError,
  formatNodeCount,
  formatRelativeTime,
  parseTimestamp,
} from "../utils/format";
import { loadNodeOverview } from "../utils/nodeOverview";

interface DrawerTreeProps {
  /** Refresh expanded nodes whenever the drawer is opened. */
  active: boolean;
  onOpenSession: (
    node: SavedNode,
    session: ChatSession,
    workspaceCode: string,
  ) => void;
}

interface TreeSession {
  session: ChatSession;
  detail?: string;
  workspaceCode: string;
}

interface TreeGroup {
  key: "topics" | "directories" | "chats" | "sessions";
  sessions: TreeSession[];
}

type NodeTreeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; groups: TreeGroup[] };

function sortByUpdatedDesc(left: TreeSession, right: TreeSession): number {
  return (
    (parseTimestamp(right.session.updatedAt)?.getTime() ?? 0) -
    (parseTimestamp(left.session.updatedAt)?.getTime() ?? 0)
  );
}

function buildTreeGroups(
  node: SavedNode,
  sessions: ChatSession[],
  projects: ProjectRecord[],
  directories: DirectoryRecord[],
  workspaceCode: string,
): TreeGroup[] {
  const allSessions: TreeSession[] = sessions.map((session) => ({
    session,
    workspaceCode,
  }));

  if (node.productCode !== TRON_PRODUCT_CODE) {
    if (!allSessions.length) return [];
    return [
      {
        key: "sessions",
        sessions: allSessions.sort(sortByUpdatedDesc),
      },
    ];
  }

  const projectNames = new Map(
    projects.map((project) => [project.projectCode, project.name]),
  );
  const directoryNames = new Map(
    directories.map((directory) => [
      directory.directoryCode,
      directory.name || directory.path,
    ]),
  );

  const topics: TreeSession[] = [];
  const directorySessions: TreeSession[] = [];
  const chats: TreeSession[] = [];

  for (const item of allSessions) {
    const { session } = item;
    if (session.projectCode) {
      topics.push({
        ...item,
        detail:
          projectNames.get(session.projectCode) ?? session.projectCode,
      });
    } else if (session.directoryCode) {
      directorySessions.push({
        ...item,
        detail:
          directoryNames.get(session.directoryCode) ?? session.directoryCode,
      });
    } else {
      chats.push(item);
    }
  }

  const groups: TreeGroup[] = [
    {
      key: "topics",
      sessions: topics.sort(sortByUpdatedDesc),
    },
    {
      key: "directories",
      sessions: directorySessions.sort(sortByUpdatedDesc),
    },
    {
      key: "chats",
      sessions: chats.sort(sortByUpdatedDesc),
    },
  ];
  return groups.filter((group) => group.sessions.length > 0);
}

function workspaceStatusActive(status: string): boolean {
  return status?.toUpperCase() === "ACTIVE";
}

export function DrawerTree({ active, onOpenSession }: DrawerTreeProps) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const { requestForNode, contentEpoch } = useNodeSession();
  const { products, nodes } = useConnections();

  const [expandedProducts, setExpandedProducts] = useState<
    Record<string, boolean>
  >({});
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [nodeStates, setNodeStates] = useState<Record<string, NodeTreeState>>(
    {},
  );
  const wasActiveRef = useRef(false);

  // Session metadata is memory-only conversation content: drop it when the
  // active node changes, the app backgrounds, or a node goes offline.
  useEffect(() => {
    if (contentEpoch === 0) return;
    setNodeStates({});
    setExpandedGroups({});
  }, [contentEpoch]);

  const productsWithNodes = useMemo(
    () =>
      products
        .map((product) => ({
          product,
          nodes: nodes.filter((node) => node.productCode === product.code),
        }))
        .filter((entry) => entry.nodes.length > 0),
    [nodes, products],
  );

  const groupLabel = (key: TreeGroup["key"]) => {
    if (key === "topics") return t("主题", "topics");
    if (key === "directories") return t("目录");
    if (key === "chats") return t("随聊");
    return t("会话");
  };

  const loadNode = useCallback(
    async (node: SavedNode) => {
      setNodeStates((previous) => ({
        ...previous,
        [node.id]: { status: "loading" },
      }));
      try {
        const overview = await loadNodeOverview(node, requestForNode);
        setNodeStates((previous) => ({
          ...previous,
          [node.id]: {
            status: "ready",
            groups: buildTreeGroups(
              node,
              overview.sessions,
              overview.projects,
              overview.directories,
              overview.workspaceCode ?? "",
            ),
          },
        }));
      } catch (error) {
        setNodeStates((previous) => ({
          ...previous,
          [node.id]: {
            status: "error",
            message: describeError(error),
          },
        }));
      }
    },
    [requestForNode],
  );

  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false;
      return;
    }
    if (wasActiveRef.current) return;
    wasActiveRef.current = true;
    for (const node of nodes) {
      if (expandedNodes[node.id]) void loadNode(node);
    }
    // Only react to the drawer opening; expansion state is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const toggleProduct = (product: Product) => {
    setExpandedProducts((previous) => ({
      ...previous,
      [product.code]: previous[product.code] === false,
    }));
  };

  const toggleNode = (node: SavedNode) => {
    const nextOpen = !expandedNodes[node.id];
    setExpandedNodes((previous) => ({ ...previous, [node.id]: nextOpen }));
    if (!nextOpen) return;
    const state = nodeStates[node.id];
    if (!state || state.status === "error") {
      void loadNode(node);
    }
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((previous) => ({
      ...previous,
      [groupId]: !previous[groupId],
    }));
  };

  const productOpen = (product: Product) =>
    expandedProducts[product.code] !== false;

  if (!productsWithNodes.length) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="git-network-outline" size={22} color={palette.muted} />
        <Text style={styles.emptyText}>{t("还没有节点")}</Text>
        <Text style={styles.emptyHint}>{t("请先添加一个节点")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {productsWithNodes.map(({ product, nodes: productNodes }) => (
        <View key={product.code} style={styles.productBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: productOpen(product) }}
            accessibilityLabel={product.name}
            onPress={() => toggleProduct(product)}
            style={({ pressed }) => [
              styles.productRow,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.productIcon}>
              <Ionicons name="cube-outline" size={15} color={palette.accent} />
            </View>
            <Text style={styles.productName} numberOfLines={1}>
              {product.name}
            </Text>
            <Text style={styles.productCount}>
              {formatNodeCount(productNodes.length)}
            </Text>
            <Ionicons
              name={productOpen(product) ? "chevron-down" : "chevron-forward"}
              size={14}
              color={palette.muted}
            />
          </Pressable>

          {productOpen(product)
            ? productNodes.map((node) => {
                const nodeOpen = Boolean(expandedNodes[node.id]);
                const state = nodeStates[node.id];
                const flat =
                  product.code !== TRON_PRODUCT_CODE &&
                  state?.status === "ready" &&
                  state.groups.length === 1 &&
                  state.groups[0]?.key === "sessions";

                const renderSession = (item: TreeSession) => (
                  <Pressable
                    key={item.session.sessionCode}
                    accessibilityRole="button"
                    accessibilityLabel={format("打开会话：{title}", {
                      title:
                        item.session.title?.trim() || t("未命名会话"),
                    })}
                    onPress={() =>
                      onOpenSession(
                        node,
                        item.session,
                        item.workspaceCode,
                      )
                    }
                    style={({ pressed }) => [
                      styles.sessionRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.sessionDot} />
                    <View style={styles.sessionText}>
                      <Text style={styles.sessionTitle} numberOfLines={1}>
                        {item.session.title?.trim() || t("未命名会话")}
                      </Text>
                      <Text style={styles.sessionMeta} numberOfLines={1}>
                        {[item.detail, formatRelativeTime(item.session.updatedAt)]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </Pressable>
                );

                return (
                  <View key={node.id}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: nodeOpen }}
                      accessibilityLabel={format("打开节点：{name}", {
                        name: node.name,
                      })}
                      onPress={() => toggleNode(node)}
                      style={({ pressed }) => [
                        styles.nodeRow,
                        pressed && styles.pressed,
                      ]}
                    >
                      <StatusDot online={node.online} size={6} />
                      <View style={styles.nodeText}>
                        <Text style={styles.nodeName} numberOfLines={1}>
                          {node.name}
                        </Text>
                        <Text style={styles.nodeAddress} numberOfLines={1}>
                          {node.baseUrl}
                        </Text>
                      </View>
                      {state?.status === "loading" ? (
                        <ActivityIndicator
                          size="small"
                          color={palette.accent}
                        />
                      ) : (
                        <Ionicons
                          name={nodeOpen ? "chevron-down" : "chevron-forward"}
                          size={13}
                          color={palette.muted}
                        />
                      )}
                    </Pressable>

                    {nodeOpen ? (
                      <View style={styles.nodeBody}>
                        {state?.status === "loading" ? (
                          <Text style={styles.hint}>
                            {t("正在读取会话…")}
                          </Text>
                        ) : state?.status === "error" ? (
                          <View style={styles.errorRow}>
                            <Text style={styles.errorText} numberOfLines={3}>
                              {state.message}
                            </Text>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => void loadNode(node)}
                              hitSlop={6}
                            >
                              <Text style={styles.retryText}>{t("重试")}</Text>
                            </Pressable>
                          </View>
                        ) : state?.status === "ready" &&
                          state.groups.length === 0 ? (
                          <Text style={styles.hint}>{t("没有会话")}</Text>
                        ) : flat && state?.status === "ready" ? (
                          <View style={styles.sessionList}>
                            {state.groups[0]!.sessions.map(renderSession)}
                          </View>
                        ) : state?.status === "ready" ? (
                          state.groups.map((group) => {
                            const groupId = `${node.id}:${group.key}`;
                            const groupOpen =
                              expandedGroups[groupId] === true;
                            return (
                              <View key={group.key}>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityState={{
                                    expanded: groupOpen,
                                  }}
                                  onPress={() => toggleGroup(groupId)}
                                  style={({ pressed }) => [
                                    styles.groupRow,
                                    pressed && styles.pressed,
                                  ]}
                                >
                                  <Ionicons
                                    name={
                                      group.key === "topics"
                                        ? "albums-outline"
                                        : group.key === "directories"
                                          ? "folder-outline"
                                          : "chatbubbles-outline"
                                    }
                                    size={14}
                                    color={palette.muted}
                                  />
                                  <Text style={styles.groupLabel}>
                                    {groupLabel(group.key)}
                                  </Text>
                                  <Text style={styles.groupCount}>
                                    {group.sessions.length}
                                  </Text>
                                  <Ionicons
                                    name={
                                      groupOpen
                                        ? "chevron-down"
                                        : "chevron-forward"
                                    }
                                    size={12}
                                    color={palette.muted}
                                  />
                                </Pressable>
                                {groupOpen ? (
                                  <View style={styles.sessionList}>
                                    {group.sessions.map(renderSession)}
                                  </View>
                                ) : null}
                              </View>
                            );
                          })
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })
            : null}
        </View>
      ))}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: spacing.xs,
    },
    productBlock: {
      gap: 2,
    },
    productRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 42,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.control,
    },
    productIcon: {
      width: 26,
      height: 26,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
    },
    productName: {
      flex: 1,
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 13,
    },
    productCount: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    nodeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 40,
      paddingLeft: spacing.xl,
      paddingRight: spacing.sm,
      borderRadius: radius.control,
    },
    nodeText: {
      flex: 1,
      gap: 1,
      minWidth: 0,
    },
    nodeName: {
      color: c.text,
      ...typography.body,
      fontSize: 12,
    },
    nodeAddress: {
      color: c.muted,
      fontSize: 9,
      letterSpacing: 0.2,
    },
    nodeBody: {
      paddingLeft: spacing.xl + spacing.md,
      paddingRight: spacing.sm,
      paddingBottom: spacing.sm,
      gap: 2,
    },
    hint: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
      paddingVertical: spacing.sm,
    },
    errorRow: {
      gap: 4,
      paddingVertical: spacing.sm,
    },
    errorText: {
      color: c.danger,
      ...typography.caption,
      fontSize: 11,
      lineHeight: 16,
    },
    retryText: {
      color: c.accent,
      ...typography.caption,
      fontWeight: "600",
    },
    groupRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 34,
      paddingHorizontal: spacing.sm,
      borderRadius: 8,
    },
    groupLabel: {
      flex: 1,
      color: c.muted,
      ...typography.label,
      fontSize: 11,
    },
    groupCount: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    sessionList: {
      gap: 1,
      paddingLeft: spacing.md,
    },
    sessionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 36,
      paddingHorizontal: spacing.sm,
      borderRadius: 8,
    },
    sessionDot: {
      width: 3,
      height: 3,
      borderRadius: 2,
      backgroundColor: c.accent,
      opacity: 0.7,
    },
    sessionText: {
      flex: 1,
      gap: 1,
      minWidth: 0,
    },
    sessionTitle: {
      color: c.text,
      ...typography.body,
      fontSize: 11,
    },
    sessionMeta: {
      color: c.muted,
      ...typography.caption,
      fontSize: 9,
    },
    emptyState: {
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.xxxl,
      paddingHorizontal: spacing.lg,
    },
    emptyText: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 13,
    },
    emptyHint: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
      textAlign: "center",
    },
    pressed: {
      opacity: 0.72,
    },
  });