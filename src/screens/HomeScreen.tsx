import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  createChatSession,
  createDudeSession,
  createMainDudeSession,
  listDudes,
  listProjects,
  listSessionGroups,
  listWorkspaceOptions,
  type ChatSession,
  type ChatSessionGroup,
  type Dude,
  type ProjectRecord,
  type WorkspaceOption,
} from "../api/tron";
import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { InlineBanner } from "../components/InlineBanner";
import { LoadingView } from "../components/LoadingView";
import { Screen } from "../components/Screen";
import { SectionHeader } from "../components/SectionHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { SessionRow } from "../components/SessionRow";
import { Ionicons } from "../components/icons";
import type { RootStackParamList } from "../navigation/types";
import { useConnections } from "../store/connections";
import { useNodeSession } from "../store/nodeSession";
import {
  layout,
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from "../theme";
import { describeError, formatRelativeTime, parseTimestamp } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;
type HomeTab = "recent" | "themes";

const workspaceStatusActive = (status: string) =>
  status?.toUpperCase() === "ACTIVE";

function isManualSession(session: ChatSession): boolean {
  return (session.sourceType ?? "").toUpperCase() === "MANUAL";
}

function sortByUpdatedDesc(left: ChatSession, right: ChatSession): number {
  const leftTime = parseTimestamp(left.updatedAt)?.getTime() ?? 0;
  const rightTime = parseTimestamp(right.updatedAt)?.getTime() ?? 0;
  return rightTime - leftTime;
}

export function HomeScreen({ navigation }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { currentNode: computer } = useConnections();
  const {
    status: sessionStatus,
    error: sessionError,
    contentEpoch,
    request: sessionRequest,
    probeNow,
  } = useNodeSession();
  const { width } = useWindowDimensions();
  const wide = width >= layout.wideBreakpoint;

  const [dudes, setDudes] = useState<Dude[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [selectedWorkspaceCode, setSelectedWorkspaceCode] = useState<string | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [groups, setGroups] = useState<ChatSessionGroup[]>([]);
  const [tab, setTab] = useState<HomeTab>("recent");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openingDudeCode, setOpeningDudeCode] = useState<string | null>(null);

  const computerId = computer?.id ?? null;

  const selectedWorkspaceRef = useRef<string | null>(null);
  const overviewSeqRef = useRef(0);
  const contentSeqRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const focusedRef = useRef(false);

  const loadOverview = useCallback(async (): Promise<string | null> => {
    if (!computerId) return null;
    const sequence = ++overviewSeqRef.current;
    // Load workspaces first so every subsequent request can carry workspaceCode.
    const nextWorkspaces = await sessionRequest(({ baseUrl, token }) =>
      listWorkspaceOptions({
        baseUrl,
        token,
        workspaceCode: selectedWorkspaceRef.current,
      }),
    );
    if (sequence !== overviewSeqRef.current) {
      return selectedWorkspaceRef.current;
    }

    const activeWorkspaces = nextWorkspaces.filter((workspace) =>
      workspaceStatusActive(workspace.status),
    );
    const candidate =
      selectedWorkspaceRef.current &&
      activeWorkspaces.some(
        (workspace) =>
          workspace.workspaceCode === selectedWorkspaceRef.current,
      )
        ? selectedWorkspaceRef.current
        : (activeWorkspaces[0]?.workspaceCode ?? null);

    const nextDudes = await sessionRequest(({ baseUrl, token }) =>
      listDudes({
        baseUrl,
        token,
        workspaceCode: candidate ?? undefined,
      }),
    );
    if (sequence !== overviewSeqRef.current) {
      return selectedWorkspaceRef.current;
    }

    setDudes(nextDudes);
    setWorkspaces(nextWorkspaces);
    selectedWorkspaceRef.current = candidate;
    setSelectedWorkspaceCode(candidate);
    return candidate;
  }, [computerId, sessionRequest]);

  const loadContent = useCallback(
    async (workspaceCode: string, clearFirst = false): Promise<void> => {
      const sequence = ++contentSeqRef.current;
      if (clearFirst) {
        setProjects([]);
        setGroups([]);
      }
      const [nextProjects, nextGroups] = await sessionRequest(({ baseUrl, token }) =>
        Promise.all([
          listProjects({ baseUrl, token, workspaceCode }),
          listSessionGroups({ baseUrl, token, workspaceCode }),
        ]),
      );
      if (sequence !== contentSeqRef.current) return;
      setProjects(
        [...nextProjects].sort(
          (left, right) =>
            (parseTimestamp(right.updatedAt)?.getTime() ?? 0) -
            (parseTimestamp(left.updatedAt)?.getTime() ?? 0),
        ),
      );
      setGroups(nextGroups);
    },
    [sessionRequest],
  );

  const refreshAll = useCallback(
    async (initial: boolean, showRefresh: boolean) => {
      if (!computerId || sessionStatus !== "online") {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (initial) setLoading(true);
      if (showRefresh) setRefreshing(true);
      setError(null);

      let targetWorkspace: string | null = null;
      try {
        targetWorkspace = await loadOverview();
      } catch (overviewError) {
        if (focusedRef.current) setError(describeError(overviewError));
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (targetWorkspace) {
        try {
          await loadContent(targetWorkspace);
        } catch (contentError) {
          if (focusedRef.current) setError(describeError(contentError));
        }
      } else {
        setProjects([]);
        setGroups([]);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [computerId, loadContent, loadOverview, sessionStatus],
  );

  const clearContent = useCallback(() => {
    overviewSeqRef.current += 1;
    contentSeqRef.current += 1;
    selectedWorkspaceRef.current = null;
    hasLoadedRef.current = false;
    setDudes([]);
    setWorkspaces([]);
    setSelectedWorkspaceCode(null);
    setProjects([]);
    setGroups([]);
    setExpandedProjects({});
    setContentLoading(false);
    setRefreshing(false);
    setError(null);
  }, []);

  // A new node, an offline transition or leaving the app bumps `contentEpoch`:
  // drop every in-memory conversation and reload once the session is online.
  useEffect(() => {
    clearContent();
    if (sessionStatus !== "online") {
      setLoading(sessionStatus === "connecting" || sessionStatus === "idle");
      return;
    }
    setLoading(true);
    let disposed = false;
    void refreshAll(true, false).finally(() => {
      if (!disposed) hasLoadedRef.current = true;
    });
    return () => {
      disposed = true;
    };
  }, [clearContent, contentEpoch, computerId, refreshAll, sessionStatus]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (sessionStatus === "online" && hasLoadedRef.current) {
        void refreshAll(false, false);
      }
      return () => {
        focusedRef.current = false;
      };
    }, [refreshAll, sessionStatus]),
  );

  const activeWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspaceStatusActive(workspace.status)),
    [workspaces],
  );

  const sortedDudes = useMemo(
    () =>
      [...dudes].sort(
        (left, right) => Number(right.isMain) - Number(left.isMain),
      ),
    [dudes],
  );

  const allSessions = useMemo(() => {
    const byCode = new Map<string, ChatSession>();
    for (const group of groups) {
      for (const session of group.sessions ?? []) {
        if (session?.sessionCode) byCode.set(session.sessionCode, session);
      }
    }
    return [...byCode.values()];
  }, [groups]);

  const recentSessions = useMemo(
    () =>
      allSessions
        .filter(
          (session) =>
            isManualSession(session) &&
            !session.projectCode &&
            !session.directoryCode,
        )
        .sort(sortByUpdatedDesc),
    [allSessions],
  );

  const sessionsByProject = useMemo(() => {
    const result = new Map<string, ChatSession[]>();
    for (const project of projects) {
      result.set(
        project.projectCode,
        allSessions
          .filter(
            (session) =>
              isManualSession(session) &&
              session.projectCode === project.projectCode,
          )
          .sort(sortByUpdatedDesc),
      );
    }
    return result;
  }, [allSessions, projects]);

  const selectWorkspace = useCallback(
    (workspaceCode: string) => {
      if (workspaceCode === selectedWorkspaceRef.current) return;
      selectedWorkspaceRef.current = workspaceCode;
      setSelectedWorkspaceCode(workspaceCode);
      setExpandedProjects({});
      setError(null);
      setContentLoading(true);
      void loadContent(workspaceCode, true)
        .catch((contentError) => {
          if (focusedRef.current) setError(describeError(contentError));
        })
        .finally(() => setContentLoading(false));
    },
    [loadContent],
  );

  const openSession = useCallback(
    (session: ChatSession) => {
      const workspaceCode =
        session.workspaceCode ?? selectedWorkspaceRef.current ?? "";
      if (!workspaceCode) {
        setError("该会话缺少工作区信息，请刷新后重试");
        return;
      }
      const isDudeSession =
        (session.sourceType ?? "").toUpperCase() === "DUDE";
      const matchingDude = isDudeSession
        ? dudes.find((dude) => dude.dudeCode === session.sourceCode)
        : undefined;
      navigation.push("Chat", {
        session,
        workspaceCode,
        dudeCode: isDudeSession
          ? (matchingDude?.dudeCode ?? session.sourceCode ?? null)
          : null,
        dudeName: matchingDude?.name ?? null,
      });
    },
    [dudes, navigation],
  );

  const openDudeSession = useCallback(
    async (dude: Dude) => {
      if (!dude.enabled || openingDudeCode || sessionStatus !== "online") {
        return;
      }
      setOpeningDudeCode(dude.dudeCode);
      setError(null);
      try {
        const workspaceCodeForDude = selectedWorkspaceRef.current ?? undefined;
        const session = dude.isMain
          ? await sessionRequest(({ baseUrl, token }) =>
              createMainDudeSession({
                baseUrl,
                token,
                workspaceCode: workspaceCodeForDude,
              }),
            )
          : await sessionRequest(({ baseUrl, token }) =>
              createDudeSession({
                baseUrl,
                token,
                dudeCode: dude.dudeCode,
                workspaceCode: workspaceCodeForDude,
              }),
            );
        const workspaceCode =
          session.workspaceCode ?? selectedWorkspaceRef.current ?? null;
        if (!workspaceCode) {
          setError("这台电脑还没有可用工作区，无法打开 Dude 会话");
          return;
        }
        navigation.push("Chat", {
          session,
          workspaceCode,
          dudeCode: dude.dudeCode,
          dudeName: dude.name,
        });
      } catch (dudeError) {
        if (focusedRef.current) setError(describeError(dudeError));
      } finally {
        setOpeningDudeCode(null);
      }
    },
    [navigation, openingDudeCode, sessionRequest, sessionStatus],
  );

  const createChat = useCallback(async () => {
    const workspaceCode = selectedWorkspaceRef.current;
    if (!workspaceCode || creating || sessionStatus !== "online") return;
    setCreating(true);
    setError(null);
    try {
      const session = await sessionRequest(({ baseUrl, token }) =>
        createChatSession({ baseUrl, token, workspaceCode }),
      );
      navigation.push("Chat", {
        session,
        workspaceCode: session.workspaceCode ?? workspaceCode,
        dudeCode: null,
        dudeName: null,
      });
    } catch (createError) {
      if (focusedRef.current) setError(describeError(createError));
    } finally {
      setCreating(false);
    }
  }, [creating, navigation, sessionRequest, sessionStatus]);

  const refreshFromPull = useCallback(() => {
    void refreshAll(false, true);
  }, [refreshAll]);

  const canCreate =
    Boolean(selectedWorkspaceCode) &&
    !creating &&
    !loading &&
    sessionStatus === "online";

  if (!computer) {
    return (
      <Screen>
        <AppHeader title="PersonAI" subtitle="尚未选择节点" />
        <EmptyState
          icon="laptop-outline"
          title="还没有选中节点"
          message="回到节点列表，选择一台已保存的电脑开始使用。"
          action={
            <Button
              label="返回产品列表"
              icon="swap-horizontal"
              onPress={() => navigation.navigate("Products")}
            />
          }
        />
      </Screen>
    );
  }

  const offline = sessionStatus === "offline";
  const connecting = sessionStatus === "idle" || sessionStatus === "connecting";
  const loadFailed =
    sessionStatus === "online" &&
    !loading &&
    Boolean(error) &&
    dudes.length === 0 &&
    workspaces.length === 0;

  const statusLabel = offline
    ? "离线"
    : sessionStatus === "online"
      ? "在线"
      : "连接中";

  const renderDudeSection = () => (
    <View style={styles.section}>
      <SectionHeader title="Dude" count={dudes.length} />
      {dudes.length === 0 ? (
        <EmptyState
          bare
          icon="sparkles-outline"
          title="暂无 Dude"
          message="在电脑端创建 Dude 后，这里会显示可用的助手。"
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dudeList}
        >
          {sortedDudes.map((dude) => (
            <DudeCard
              key={dude.dudeCode}
              dude={dude}
              opening={openingDudeCode === dude.dudeCode}
              onPress={() => void openDudeSession(dude)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );

  const renderWorkspaceSection = () => (
    <View style={styles.section}>
      <SectionHeader title="工作区" count={activeWorkspaces.length} />
      {activeWorkspaces.length === 0 ? (
        <Text style={styles.mutedText}>这台电脑还没有可用的工作区。</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.workspaceList}
        >
          {activeWorkspaces.map((workspace) => {
            const selected = workspace.workspaceCode === selectedWorkspaceCode;
            return (
              <Pressable
                key={workspace.workspaceCode}
                accessibilityRole="button"
                accessibilityLabel={`切换到工作区 ${workspace.name}`}
                accessibilityState={{ selected }}
                onPress={() => selectWorkspace(workspace.workspaceCode)}
                style={({ pressed }) => [
                  styles.workspaceChip,
                  selected && styles.workspaceChipSelected,
                  pressed && styles.pressed,
                ]}
              >
                {selected ? (
                  <Ionicons name="checkmark" size={13} color={palette.accent} />
                ) : null}
                <Text
                  style={[
                    styles.workspaceChipText,
                    selected && { color: palette.accent },
                  ]}
                  numberOfLines={1}
                >
                  {workspace.label || workspace.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  const renderRecentSessions = () => (
    <View style={styles.section}>
      <SectionHeader
        title="随聊"
        count={recentSessions.length}
        right={
          contentLoading ? <ActivityIndicator size="small" color={palette.accent} /> : null
        }
      />
      {selectedWorkspaceCode ? (
        recentSessions.length ? (
          <Card style={styles.listCard}>
            {recentSessions.map((session, index) => (
              <View key={session.sessionCode}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <SessionRow
                  session={session}
                  compact
                  onPress={() => openSession(session)}
                />
              </View>
            ))}
          </Card>
        ) : (
          <EmptyState
            bare
            icon="chatbubbles-outline"
            title="还没有随聊"
            message="点击右下角的 + 新建一个随聊，开始和 Tron 对话。"
          />
        )
      ) : (
        <Text style={styles.mutedText}>请选择一个工作区。</Text>
      )}
    </View>
  );

  const renderThemes = () => (
    <View style={styles.section}>
      <SectionHeader
        title="主题"
        count={projects.length}
        right={
          contentLoading ? <ActivityIndicator size="small" color={palette.accent} /> : null
        }
      />
      {!selectedWorkspaceCode ? (
        <Text style={styles.mutedText}>请选择一个工作区。</Text>
      ) : projects.length === 0 ? (
        <EmptyState
          bare
          icon="folder-open-outline"
          title="还没有主题"
          message="在电脑端创建主题后，可以在这里按主题查看会话。"
        />
      ) : (
        <View style={styles.projectList}>
          {projects.map((project) => {
            const projectSessions = sessionsByProject.get(project.projectCode) ?? [];
            const expanded = Boolean(expandedProjects[project.projectCode]);
            return (
              <View key={project.projectCode} style={styles.projectCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${expanded ? "收起" : "展开"}主题 ${project.name}`}
                  accessibilityState={{ expanded }}
                  onPress={() =>
                    setExpandedProjects((previous) => ({
                      ...previous,
                      [project.projectCode]: !previous[project.projectCode],
                    }))
                  }
                  style={({ pressed }) => [
                    styles.projectHeader,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.projectIcon}>
                    <Ionicons name="folder-outline" size={16} color={palette.accent} />
                  </View>
                  <View style={styles.projectTitleBlock}>
                    <Text style={styles.projectName} numberOfLines={1}>
                      {project.name}
                    </Text>
                    <Text style={styles.projectMeta} numberOfLines={1}>
                      更新于 {formatRelativeTime(project.updatedAt)}
                    </Text>
                  </View>
                  <Badge label={`${projectSessions.length}`} />
                  <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={palette.muted}
                  />
                </Pressable>

                {expanded ? (
                  <View style={styles.projectSessions}>
                    {projectSessions.length ? (
                      projectSessions.map((session, index) => (
                        <View key={session.sessionCode}>
                          {index > 0 ? <View style={styles.divider} /> : null}
                          <SessionRow
                            session={session}
                            compact
                            onPress={() => openSession(session)}
                          />
                        </View>
                      ))
                    ) : (
                      <Text style={styles.projectEmpty}>
                        该主题下还没有手动会话。
                      </Text>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  return (
    <Screen>
      <AppHeader
        eyebrow="PERSONAI"
        title={computer.name}
        subtitle={computer.baseUrl}
        onBack={() => navigation.goBack()}
        right={
          <View style={styles.headerActions}>
            <Badge
              withDot
              tone={offline ? "danger" : sessionStatus === "online" ? "accent" : "muted"}
              label={statusLabel}
            />
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
          </View>
        }
      />

      {offline ? (
        <ScrollView
          contentContainerStyle={styles.centeredContent}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => void probeNow()}
              tintColor={palette.accent}
              colors={[palette.accent]}
              progressBackgroundColor={palette.surface}
            />
          }
        >
          <EmptyState
            icon="cloud-offline-outline"
            title="电脑离线"
            message={
              sessionError ??
              "无法连接这台电脑，已清空当前会话内容。请确认电脑端 Tron 在运行，并检查网络与节点地址。"
            }
            action={
              <Button
                label="重新连接"
                icon="refresh"
                onPress={() => void probeNow()}
              />
            }
          />
        </ScrollView>
      ) : connecting || loading ? (
        <LoadingView
          label={
            sessionStatus === "online"
              ? "正在加载电脑数据…"
              : "正在建立安全会话…"
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshFromPull}
              tintColor={palette.accent}
              colors={[palette.accent]}
              progressBackgroundColor={palette.surface}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {error && !loadFailed ? (
            <View style={styles.bannerWrap}>
              <InlineBanner
                message={error}
                actionLabel="重试"
                onAction={() => void refreshAll(false, true)}
              />
            </View>
          ) : null}

          {loadFailed ? (
            <EmptyState
              icon="alert-circle-outline"
              title="无法加载节点数据"
              message={error ?? "请稍后重试。"}
              action={
                <Button
                  label="重试"
                  icon="refresh"
                  onPress={() => void refreshAll(false, true)}
                />
              }
            />
          ) : wide ? (
            <View style={styles.columns}>
              <View style={styles.column}>
                {renderDudeSection()}
                {renderWorkspaceSection()}
                {renderRecentSessions()}
              </View>
              <View style={styles.column}>{renderThemes()}</View>
            </View>
          ) : (
            <View style={styles.mobileStack}>
              {renderDudeSection()}
              {renderWorkspaceSection()}
              <View style={styles.section}>
                <SegmentedControl<HomeTab>
                  value={tab}
                  onChange={setTab}
                  options={[
                    {
                      value: "recent",
                      label: `随聊${
                        recentSessions.length ? ` ${recentSessions.length}` : ""
                      }`,
                    },
                    {
                      value: "themes",
                      label: `主题${projects.length ? ` ${projects.length}` : ""}`,
                    },
                  ]}
                />
              </View>
              {tab === "recent" ? renderRecentSessions() : renderThemes()}
            </View>
          )}
        </ScrollView>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="新建随聊"
        accessibilityState={{ disabled: !canCreate, busy: creating }}
        disabled={!canCreate}
        onPress={() => void createChat()}
        style={({ pressed }) => [
          styles.fab,
          !canCreate && styles.fabDisabled,
          pressed && styles.fabPressed,
        ]}
      >
        {creating ? (
          <ActivityIndicator size="small" color={palette.onAccent} />
        ) : (
          <Ionicons name="add" size={28} color={palette.onAccent} />
        )}
      </Pressable>
    </Screen>
  );
}

function DudeCard({
  dude,
  opening,
  onPress,
}: {
  dude: Dude;
  opening: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${dude.name}${dude.isMain ? "，主 Dude" : ""}`}
      accessibilityHint={dude.enabled ? "进入这个 Dude 的会话" : "该 Dude 已停用"}
      accessibilityState={{ disabled: !dude.enabled, busy: opening }}
      disabled={!dude.enabled || opening}
      onPress={onPress}
      style={({ pressed }) => [
        styles.dudeCard,
        dude.isMain && styles.dudeCardMain,
        !dude.enabled && styles.dudeDisabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.dudeTopRow}>
        <View style={styles.dudeAvatar}>
          <Ionicons name="sparkles" size={16} color={palette.accent} />
        </View>
        <View style={styles.dudeBadges}>
          {dude.isMain ? <Badge label="主 Dude" tone="accent" /> : null}
          {!dude.enabled ? <Badge label="已停用" tone="danger" /> : null}
        </View>
      </View>
      <Text style={styles.dudeName} numberOfLines={1}>
        {dude.name}
      </Text>
      <Text style={styles.dudeDescription} numberOfLines={3}>
        {dude.description?.trim() || "这个 Dude 还没有描述。"}
      </Text>
      <View style={styles.dudeFooter}>
        <Text style={styles.dudeFooterText} numberOfLines={1}>
          {dude.enabled ? "进入会话" : "已停用"}
        </Text>
        {opening ? (
          <ActivityIndicator size="small" color={palette.accent} />
        ) : dude.enabled ? (
          <Ionicons name="arrow-forward" size={14} color={palette.accent} />
        ) : null}
      </View>
    </Pressable>
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
    bannerWrap: {
      marginBottom: spacing.md,
    },
    scrollContent: {
      paddingBottom: 140,
    },
    centeredContent: {
      flexGrow: 1,
      justifyContent: "center",
      paddingBottom: 100,
    },
    columns: {
      flexDirection: "row",
      gap: spacing.xxl,
      alignItems: "flex-start",
    },
    column: {
      flex: 1,
      minWidth: 0,
    },
    mobileStack: {
      gap: 0,
    },
    section: {
      marginBottom: spacing.xxl,
    },
    mutedText: {
      color: c.muted,
      ...typography.caption,
      lineHeight: 18,
      paddingVertical: spacing.sm,
    },
    dudeList: {
      gap: spacing.md,
      paddingRight: spacing.sm,
    },
    dudeCard: {
      width: 200,
      minHeight: 172,
      padding: spacing.lg,
      borderRadius: radius.card,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      gap: spacing.sm,
    },
    dudeCardMain: {
      borderColor: c.accentBorder,
      backgroundColor: c.surfaceAlt,
    },
    dudeDisabled: {
      opacity: 0.65,
    },
    dudeTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      minHeight: 28,
    },
    dudeAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    dudeBadges: {
      flexDirection: "row",
      gap: spacing.xs,
      flexShrink: 1,
    },
    dudeName: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 16,
    },
    dudeDescription: {
      flex: 1,
      color: c.muted,
      ...typography.caption,
      lineHeight: 17,
    },
    dudeFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.sm,
    },
    dudeFooterText: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    workspaceList: {
      gap: spacing.sm,
      paddingRight: spacing.sm,
    },
    workspaceChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 38,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      maxWidth: 240,
    },
    workspaceChipSelected: {
      backgroundColor: c.accentSoft,
      borderColor: c.accentBorder,
    },
    workspaceChipText: {
      color: c.muted,
      ...typography.bodyStrong,
      fontSize: 13,
      flexShrink: 1,
    },
    listCard: {
      padding: 4,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginHorizontal: spacing.md,
    },
    projectList: {
      gap: spacing.md,
    },
    projectCard: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.card,
      overflow: "hidden",
    },
    projectHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.lg,
    },
    projectIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    projectTitleBlock: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    projectName: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 14,
    },
    projectMeta: {
      color: c.muted,
      ...typography.caption,
      fontSize: 11,
    },
    projectSessions: {
      paddingHorizontal: 4,
      paddingBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    projectEmpty: {
      color: c.muted,
      ...typography.caption,
      padding: spacing.lg,
    },
    fab: {
      position: "absolute",
      right: 20,
      bottom: 24,
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
      shadowColor: c.accent,
      shadowOpacity: 0.35,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    fabDisabled: {
      opacity: 0.4,
    },
    fabPressed: {
      transform: [{ scale: 0.96 }],
    },
    pressed: {
      opacity: 0.75,
    },
  });