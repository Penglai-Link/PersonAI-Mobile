import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  createDudeSession,
  createMainDudeSession,
  type ChatSession,
  type Dude,
} from "../api/tron";
import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { DudeCard } from "../components/DudeCard";
import { EmptyState } from "../components/EmptyState";
import { InlineBanner } from "../components/InlineBanner";
import { Screen } from "../components/Screen";
import { SectionHeader } from "../components/SectionHeader";
import { StatusDot } from "../components/StatusDot";
import { Ionicons, type IconName } from "../components/icons";
import { useI18n } from "../i18n";
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
import { describeError, formatRelativeTime, parseTimestamp } from "../utils/format";
import { loadNodeOverview } from "../utils/nodeOverview";

type Props = NativeStackScreenProps<RootStackParamList, "Dashboard">;

interface NodeSummary {
  node: SavedNode;
  sessions: ChatSession[];
  dudes: Dude[];
  workspaceCode: string | null;
  error: string | null;
}

interface DashboardDude {
  node: SavedNode;
  dude: Dude;
  workspaceCode: string;
}

interface RunningSession {
  node: SavedNode;
  session: ChatSession;
  workspaceCode: string;
}

function isRunningSession(session: ChatSession): boolean {
  const status = (session.lastRunStatus ?? session.status ?? "").toUpperCase();
  return status === "RUNNING" || status === "IN_PROGRESS";
}

function sortSessionsDesc(left: ChatSession, right: ChatSession): number {
  return (
    (parseTimestamp(right.updatedAt)?.getTime() ?? 0) -
    (parseTimestamp(left.updatedAt)?.getTime() ?? 0)
  );
}

export function DashboardScreen({ navigation }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const { products, nodes, selectNode, ready } = useConnections();
  const { requestForNode, contentEpoch } = useNodeSession();

  const [summaries, setSummaries] = useState<Record<string, NodeSummary>>({});
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openingDudeKey, setOpeningDudeKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const nodesRef = useRef<SavedNode[]>(nodes);
  nodesRef.current = nodes;
  const seqRef = useRef(0);
  const lastNodeSignatureRef = useRef<string | null>(null);
  const focused = useIsFocused();

  const nodeSignature = useMemo(
    () =>
      nodes
        .map(
          (node) =>
            `${node.id}|${node.baseUrl}|${node.transport}|${node.keyId}`,
        )
        .join(","),
    [nodes],
  );

  const load = useCallback(
    async (pull: boolean) => {
      const sequence = ++seqRef.current;
      if (pull) setRefreshing(true);
      else setLoading(true);

      const list = nodesRef.current;
      if (!list.length) {
        if (sequence === seqRef.current) {
          setSummaries({});
          setLoaded(true);
          setLoading(false);
          setRefreshing(false);
        }
        return;
      }

      const entries = await Promise.all(
        list.map(async (node): Promise<NodeSummary> => {
          try {
            const overview = await loadNodeOverview(node, requestForNode);
            return {
              node,
              sessions: overview.sessions,
              dudes: overview.dudes,
              workspaceCode: overview.workspaceCode,
              error: null,
            };
          } catch (error) {
            return {
              node,
              sessions: [],
              dudes: [],
              workspaceCode: null,
              error: describeError(error),
            };
          }
        }),
      );
      if (sequence !== seqRef.current) return;
      const next: Record<string, NodeSummary> = {};
      for (const entry of entries) next[entry.node.id] = entry;
      setSummaries(next);
      setLoaded(true);
      setLoading(false);
      setRefreshing(false);
    },
    [requestForNode],
  );

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load(false);
    }, [load, ready]),
  );

  // Hydration finishes after the first render; reload once the saved nodes are
  // available, and whenever the node set changes.
  useEffect(() => {
    if (!ready) return;
    if (lastNodeSignatureRef.current === nodeSignature) return;
    lastNodeSignatureRef.current = nodeSignature;
    void load(false);
  }, [load, nodeSignature, ready]);

  // Conversation metadata is memory-only; drop it whenever the session epoch
  // changes (node switch, background, offline), then reload if still visible.
  useEffect(() => {
    if (contentEpoch === 0) return;
    setSummaries({});
    setLoaded(false);
    if (focused && AppState.currentState === "active") void load(false);
  }, [contentEpoch, focused, load]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && focused) void load(false);
    });
    return () => subscription.remove();
  }, [focused, load]);

  const productNameByCode = useMemo(
    () => new Map(products.map((product) => [product.code, product.name])),
    [products],
  );

  const onlineNodes = nodes.filter((node) => node.online === true).length;
  const productsWithNodes = products.filter((product) =>
    nodes.some((node) => node.productCode === product.code),
  ).length;

  const sessions = useMemo(
    () => Object.values(summaries).flatMap((summary) => summary.sessions),
    [summaries],
  );
  const totalSessions = sessions.length;

  const runningSessions = useMemo<RunningSession[]>(() => {
    const result: RunningSession[] = [];
    for (const summary of Object.values(summaries)) {
      for (const session of summary.sessions) {
        if (!isRunningSession(session)) continue;
        result.push({
          node: summary.node,
          session,
          workspaceCode:
            summary.workspaceCode ?? session.workspaceCode ?? "",
        });
      }
    }
    return result.sort((left, right) =>
      sortSessionsDesc(left.session, right.session),
    );
  }, [summaries]);

  const dudes = useMemo<DashboardDude[]>(() => {
    const result: DashboardDude[] = [];
    for (const summary of Object.values(summaries)) {
      if (!summary.workspaceCode) continue;
      for (const dude of summary.dudes) {
        result.push({
          node: summary.node,
          dude,
          workspaceCode: summary.workspaceCode,
        });
      }
    }
    return result.sort((left, right) => {
      const main = Number(right.dude.isMain) - Number(left.dude.isMain);
      if (main !== 0) return main;
      return left.node.name.localeCompare(right.node.name);
    });
  }, [summaries]);

  const openDude = useCallback(
    async (item: DashboardDude) => {
      if (!item.dude.enabled || openingDudeKey) return;
      const key = `${item.node.id}:${item.dude.dudeCode}`;
      setOpeningDudeKey(key);
      setActionError(null);
      try {
        const session = await requestForNode(item.node, ({ tunnel }) =>
          item.dude.isMain
            ? createMainDudeSession({
                tunnel,
                workspaceCode: item.workspaceCode,
              })
            : createDudeSession({
                tunnel,
                dudeCode: item.dude.dudeCode,
                workspaceCode: item.workspaceCode,
              }),
        );
        selectNode(item.node);
        navigation.navigate("Chat", {
          session,
          workspaceCode:
            session.workspaceCode ?? item.workspaceCode ?? "",
          dudeCode: item.dude.dudeCode,
          dudeName: item.dude.name,
        });
      } catch (error) {
        setActionError(describeError(error));
      } finally {
        setOpeningDudeKey(null);
      }
    },
    [navigation, openingDudeKey, requestForNode, selectNode],
  );

  const sessionsPending = loading || (nodes.length > 0 && !loaded);

  const openSession = useCallback(
    (item: RunningSession) => {
      selectNode(item.node);
      const isDude =
        (item.session.sourceType ?? "").toUpperCase() === "DUDE";
      navigation.navigate("Chat", {
        session: item.session,
        workspaceCode: item.workspaceCode || item.session.workspaceCode || "",
        dudeCode: isDude ? (item.session.sourceCode ?? null) : null,
        dudeName: null,
      });
    },
    [navigation, selectNode],
  );

  const sessionValue = sessionsPending ? "—" : totalSessions;
  const runningValue = sessionsPending ? "—" : runningSessions.length;

  return (
    <Screen>
      <AppHeader
        title={t("看板")}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("刷新")}
            accessibilityState={{ disabled: loading || refreshing }}
            disabled={loading || refreshing}
            onPress={() => void load(true)}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            {loading || refreshing ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <Ionicons name="refresh" size={18} color={palette.text} />
            )}
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={palette.accent}
            colors={[palette.accent]}
            progressBackgroundColor={palette.surface}
          />
        }
      >
        <View style={styles.metrics}>
          <MetricCard
            icon="cube-outline"
            label={t("产品")}
            value={products.length}
            hint={format("有节点：{count}", { count: productsWithNodes })}
          />
          <MetricCard
            icon="laptop-outline"
            label={t("节点")}
            value={nodes.length}
            hint={format("在线：{count}", { count: onlineNodes })}
          />
          <MetricCard
            icon="chatbubbles-outline"
            label={t("会话")}
            value={sessionValue}
            hint={sessionsPending ? t("正在汇总…") : undefined}
          />
          <MetricCard
            icon="pulse-outline"
            label={t("运行中")}
            value={runningValue}
            hint={
              sessionsPending
                ? t("正在汇总…")
                : format("共 {count} 个会话", { count: totalSessions })
            }
            accent
          />
        </View>

        {actionError ? <InlineBanner message={actionError} /> : null}

        <View style={styles.section}>
          <SectionHeader
            title="Dude"
            count={sessionsPending ? undefined : dudes.length}
          />
          {sessionsPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={palette.accent} />
              <Text style={styles.mutedText}>{t("正在汇总…")}</Text>
            </View>
          ) : dudes.length === 0 ? (
            <EmptyState bare icon="sparkles-outline" title={t("暂无 Dude")} />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dudeList}
            >
              {dudes.map((item) => {
                const key = `${item.node.id}:${item.dude.dudeCode}`;
                return (
                  <DudeCard
                    key={key}
                    dude={item.dude}
                    context={item.node.name}
                    opening={openingDudeKey === key}
                    onPress={() => void openDude(item)}
                  />
                );
              })}
            </ScrollView>
          )}
        </View>

        <View style={styles.section}>
          <SectionHeader
            title={t("运行中的会话")}
            count={sessionsPending ? undefined : runningSessions.length}
          />
          {sessionsPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={palette.accent} />
              <Text style={styles.mutedText}>{t("正在汇总…")}</Text>
            </View>
          ) : runningSessions.length === 0 ? (
            <EmptyState
              bare
              icon="pulse-outline"
              title={t("暂无运行中的会话")}
            />
          ) : (
            <View style={styles.list}>
              {runningSessions.map((item) => (
                <Pressable
                  key={`${item.node.id}:${item.session.sessionCode}`}
                  accessibilityRole="button"
                  accessibilityLabel={format("打开会话：{title}", {
                    title: item.session.title?.trim() || t("未命名会话"),
                  })}
                  onPress={() => openSession(item)}
                  style={({ pressed }) => [
                    styles.sessionRow,
                    pressed && styles.pressed,
                  ]}
                >
                  <StatusDot online size={7} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.session.title?.trim() || t("未命名会话")}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {productNameByCode.get(item.node.productCode) ??
                        item.node.productCode}
                      {" · "}
                      {item.node.name}
                      {" · "}
                      {formatRelativeTime(item.session.updatedAt)}
                    </Text>
                  </View>
                  <Badge label={t("运行中")} tone="accent" />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {Object.values(summaries).some((summary) => summary.error) ? (
          <Text style={styles.warningText}>
            {format("有 {count} 个节点暂不可达", {
              count: Object.values(summaries).filter(
                (summary) => summary.error,
              ).length,
            })}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  accent = false,
}: {
  icon: IconName;
  label: string;
  value: number | string;
  hint?: string;
  accent?: boolean;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.metricCard, accent && styles.metricCardAccent]}>
      <View style={styles.metricIcon}>
        <Ionicons
          name={icon}
          size={16}
          color={accent ? palette.accent : palette.muted}
        />
      </View>
      <Text style={[styles.metricValue, accent && { color: palette.accent }]}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {hint ? (
        <Text style={styles.metricHint} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    content: {
      paddingBottom: spacing.xxxl,
      gap: spacing.xl,
    },
    headerButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    metrics: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    metricCard: {
      flexBasis: "47%",
      flexGrow: 1,
      gap: 2,
      padding: spacing.md,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    metricCardAccent: {
      borderColor: c.accentBorder,
      backgroundColor: c.accentSoft,
    },
    metricIcon: {
      width: 28,
      height: 28,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
      marginBottom: 4,
    },
    metricValue: {
      color: c.text,
      ...typography.title,
      fontSize: 26,
      lineHeight: 30,
    },
    metricLabel: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    metricHint: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
      marginTop: 2,
    },
    section: {
      gap: spacing.sm,
    },
    list: {
      gap: spacing.sm,
    },
    dudeList: {
      gap: spacing.md,
      paddingRight: spacing.sm,
    },
    rowText: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    rowTitle: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 13,
    },
    rowMeta: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    sessionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    mutedText: {
      color: c.muted,
      ...typography.caption,
    },
    warningText: {
      color: c.muted,
      ...typography.caption,
      textAlign: "center",
    },
    pressed: {
      opacity: 0.75,
    },
  });