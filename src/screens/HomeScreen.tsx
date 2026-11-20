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
  ASSISTANT_SOURCE_TYPE,
  createAssistantSession,
  createMainAssistantSession,
  listDirectories,
  listAssistants,
  listNavigationMenus,
  listProjects,
  listSessionGroups,
  listWorkspaceOptions,
  type ChatSession,
  type ChatSessionGroup,
  type DirectoryRecord,
  type Assistant,
  type NavigationMenu,
  type ProjectRecord,
  type WorkspaceOption,
} from "../api/tron";
import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { AssistantCard } from "../components/AssistantCard";
import { EmptyState } from "../components/EmptyState";
import { InlineBanner } from "../components/InlineBanner";
import { LoadingView } from "../components/LoadingView";
import { Screen } from "../components/Screen";
import { SectionHeader } from "../components/SectionHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { SessionRow } from "../components/SessionRow";
import { Ionicons } from "../components/icons";
import { useI18n } from "../i18n";
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
import { createDraftCode } from "../utils/draft";
import { describeError, formatRelativeTime, parseTimestamp } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

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
  const { t, format } = useI18n();
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

  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [selectedWorkspaceCode, setSelectedWorkspaceCode] = useState<string | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [directories, setDirectories] = useState<DirectoryRecord[]>([]);
  const [groups, setGroups] = useState<ChatSessionGroup[]>([]);
  const [menus, setMenus] = useState<NavigationMenu[]>([]);
  /** `pageCode` of the selected product menu, e.g. `chat.directories`. */
  const [tab, setTab] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedDirectories, setExpandedDirectories] = useState<
    Record<string, boolean>
  >({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingAssistantCode, setOpeningAssistantCode] = useState<
    string | null
  >(null);

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
    const nextWorkspaces = await sessionRequest(({ tunnel }) =>
      listWorkspaceOptions({
        tunnel,
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

    // Workspace availability is what makes the create button usable, so it is
    // committed before loading assistants. A failure must not hide the
    // workspaces or leave the screen without a default selection.
    if (sequence !== overviewSeqRef.current) {
      return selectedWorkspaceRef.current;
    }
    setWorkspaces(nextWorkspaces);
    selectedWorkspaceRef.current = candidate;
    setSelectedWorkspaceCode(candidate);

    const [nextAssistants, nextMenus] = await Promise.all([
      sessionRequest(({ tunnel }) =>
        listAssistants({
          tunnel,
          workspaceCode: candidate ?? undefined,
        }),
      ).catch(() => []),
      sessionRequest(({ tunnel }) => listNavigationMenus({ tunnel })).catch(
        () => [] as NavigationMenu[],
      ),
    ]);
    if (sequence !== overviewSeqRef.current) {
      return selectedWorkspaceRef.current;
    }

    setAssistants(nextAssistants);
    setMenus(nextMenus);
    return candidate;
  }, [computerId, sessionRequest]);

  const loadContent = useCallback(
    async (workspaceCode: string, clearFirst = false): Promise<void> => {
      const sequence = ++contentSeqRef.current;
      if (clearFirst) {
        setProjects([]);
        setDirectories([]);
        setGroups([]);
      }
      const [nextProjects, nextDirectories, nextGroups] = await sessionRequest(
        ({ tunnel }) =>
          Promise.all([
            listProjects({ tunnel, workspaceCode }),
            listDirectories({ tunnel, workspaceCode }),
            listSessionGroups({ tunnel, workspaceCode }),
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
      setDirectories(nextDirectories);
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
        setDirectories([]);
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
    setAssistants([]);
    setWorkspaces([]);
    setSelectedWorkspaceCode(null);
    setProjects([]);
    setDirectories([]);
    setGroups([]);
    setMenus([]);
    setTab(null);
    setExpandedProjects({});
    setExpandedDirectories({});
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

  // Chat sections are product navigation widgets. Older nodes do not expose
  // them yet, so fall back to Tron's canonical labels until they do.
  const chatMenus = useMemo<NavigationMenu[]>(() => {
    if (menus.length) return menus;
    return [
      {
        menuCode: "CHAT_PROJECTS",
        label: t("主题", "topics"),
        pageCode: "chat.projects",
        icon: null,
      },
      {
        menuCode: "CHAT_DIRECTORIES",
        label: t("工作区"),
        pageCode: "chat.directories",
        icon: null,
      },
      {
        menuCode: "CHAT_RECENTS",
        label: t("随聊"),
        pageCode: "chat.recents",
        icon: null,
      },
    ];
  }, [menus, t]);

  useEffect(() => {
    if (!chatMenus.length) return;
    if (!tab || !chatMenus.some((menu) => menu.pageCode === tab)) {
      setTab(chatMenus[0].pageCode);
    }
  }, [chatMenus, tab]);

  const activeWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspaceStatusActive(workspace.status)),
    [workspaces],
  );

  const sortedAssistants = useMemo(
    () =>
      [...assistants].sort(
        (left, right) => Number(right.isMain) - Number(left.isMain),
      ),
    [assistants],
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

  const sessionsByDirectory = useMemo(() => {
    const result = new Map<string, ChatSession[]>();
    for (const directory of directories) {
      result.set(
        directory.directoryCode,
        allSessions
          .filter(
            (session) =>
              isManualSession(session) &&
              session.directoryCode === directory.directoryCode,
          )
          .sort(sortByUpdatedDesc),
      );
    }
    return result;
  }, [allSessions, directories]);

  const selectWorkspace = useCallback(
    (workspaceCode: string) => {
      if (workspaceCode === selectedWorkspaceRef.current) return;
      selectedWorkspaceRef.current = workspaceCode;
      setSelectedWorkspaceCode(workspaceCode);
      setExpandedProjects({});
      setExpandedDirectories({});
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
        setError(t("该会话缺少工作空间信息，请刷新后重试"));
        return;
      }
      const isAssistantSession =
        (session.sourceType ?? "").toUpperCase() === ASSISTANT_SOURCE_TYPE;
      const matchingAssistant = isAssistantSession
        ? assistants.find(
            (assistant) => assistant.assistantCode === session.sourceCode,
          )
        : undefined;
      navigation.push("Chat", {
        session,
        draft: undefined,
        workspaceCode,
        assistantCode: isAssistantSession
          ? (matchingAssistant?.assistantCode ?? session.sourceCode ?? null)
          : null,
        assistantName: matchingAssistant?.name ?? null,
      });
    },
    [assistants, navigation],
  );

  const openAssistantSession = useCallback(
    async (assistant: Assistant) => {
      if (!assistant.enabled || openingAssistantCode || sessionStatus !== "online") {
        return;
      }
      setOpeningAssistantCode(assistant.assistantCode);
      setError(null);
      try {
        const workspaceCodeForAssistant =
          selectedWorkspaceRef.current ??
          activeWorkspaces[0]?.workspaceCode ??
          workspaces[0]?.workspaceCode ??
          undefined;
        const session = assistant.isMain
          ? await sessionRequest(({ tunnel }) =>
              createMainAssistantSession({
                tunnel,
                workspaceCode: workspaceCodeForAssistant,
              }),
            )
          : await sessionRequest(({ tunnel }) =>
              createAssistantSession({
                tunnel,
                assistantCode: assistant.assistantCode,
                workspaceCode: workspaceCodeForAssistant,
              }),
            );
        const workspaceCode =
          session.workspaceCode ??
          selectedWorkspaceRef.current ??
          workspaceCodeForAssistant ??
          null;
        if (!workspaceCode) {
          setError(t("这台电脑还没有可用工作空间，无法打开个人助手会话"));
          return;
        }
        navigation.push("Chat", {
          session,
          draft: undefined,
          workspaceCode,
          assistantCode: assistant.assistantCode,
          assistantName: assistant.name,
        });
      } catch (assistantError) {
        if (focusedRef.current) setError(describeError(assistantError));
      } finally {
        setOpeningAssistantCode(null);
      }
    },
    [
      activeWorkspaces,
      navigation,
      openingAssistantCode,
      sessionRequest,
      sessionStatus,
      t,
      workspaces,
    ],
  );

  const createChat = useCallback(() => {
    if (sessionStatus !== "online") return;
    // Resolve the workspace at press time. `selectedWorkspaceCode` can be
    // briefly unset while a refresh is in flight; the loaded list is the
    // source of truth, and an empty result must never be sent to the node.
    const workspaceCode =
      selectedWorkspaceRef.current ??
      activeWorkspaces[0]?.workspaceCode ??
      workspaces[0]?.workspaceCode ??
      null;
    if (!workspaceCode) {
      setError(t("这台电脑还没有可用的工作空间，无法创建会话。"));
      return;
    }
    if (selectedWorkspaceRef.current !== workspaceCode) {
      selectedWorkspaceRef.current = workspaceCode;
      setSelectedWorkspaceCode(workspaceCode);
    }
    setError(null);
    // Opening a draft is local-only; the node creates the session on the first
    // message, so an abandoned `+` leaves no empty session behind.
    navigation.push("Chat", {
      draft: { draftCode: createDraftCode(), workspaceCode },
      workspaceCode,
      assistantCode: null,
      assistantName: null,
    });
  }, [
    activeWorkspaces,
    navigation,
    sessionStatus,
    t,
    workspaces,
  ]);

  const refreshFromPull = useCallback(() => {
    void refreshAll(false, true);
  }, [refreshAll]);

  const canCreate =
    Boolean(
      selectedWorkspaceCode ??
        activeWorkspaces[0]?.workspaceCode ??
        workspaces[0]?.workspaceCode,
    ) &&
    !loading &&
    sessionStatus === "online";

  if (!computer) {
    return (
      <Screen>
        <AppHeader
          title="PersonAI"
          subtitle={t("尚未选择节点")}
        />
        <EmptyState
          icon="laptop-outline"
          title={t("还没有选中节点")}
          message={t("回到节点列表，选择一台已保存的电脑开始使用。")}
          action={
            <Button
              label={t("返回看板")}
              icon="swap-horizontal"
              onPress={() => navigation.navigate("Dashboard")}
            />
          }
        />
      </Screen>
    );
  }

  const unauthorized = sessionStatus === "unauthorized";
  const offline = sessionStatus === "offline";
  const disconnected = offline || unauthorized;
  const connecting = sessionStatus === "idle" || sessionStatus === "connecting";
  const loadFailed =
    sessionStatus === "online" &&
    !loading &&
    Boolean(error) &&
    assistants.length === 0 &&
    workspaces.length === 0;

  const statusLabel = unauthorized
    ? t("凭证失效")
    : offline
      ? t("离线")
      : sessionStatus === "online"
        ? t("在线")
        : t("连接中");

  const renderAssistantSection = () => (
    <View style={styles.section}>
      <SectionHeader title={t("个人助手")} count={assistants.length} />
      {assistants.length === 0 ? (
        <EmptyState
          bare
          icon="sparkles-outline"
          title={t("暂无个人助手")}
          message={t("在电脑端创建个人助手后，这里会显示可用的个人助手。")}
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.assistantList}
        >
          {sortedAssistants.map((assistant) => (
            <AssistantCard
              key={assistant.assistantCode}
              assistant={assistant}
              opening={openingAssistantCode === assistant.assistantCode}
              onPress={() => void openAssistantSession(assistant)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );

  const renderWorkspaceSection = () => (
    <View style={styles.section}>
      <SectionHeader title={t("工作空间")} count={activeWorkspaces.length} />
      {activeWorkspaces.length === 0 ? (
        <Text style={styles.mutedText}>
          {t("这台电脑还没有可用的工作空间。")}
        </Text>
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
                accessibilityLabel={format("切换到工作空间 {name}", {
                  name: workspace.name,
                })}
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

  const renderChats = () => (
    <View style={styles.section}>
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
            title={t("还没有随聊")}
            message={t("点击右下角的 + 新建一个随聊，开始和 Tron 对话。")}
          />
        )
      ) : (
        <Text style={styles.mutedText}>{t("请选择一个工作空间。")}</Text>
      )}
    </View>
  );

  const renderDirectories = () => (
    <View style={styles.section}>
      {!selectedWorkspaceCode ? (
        <Text style={styles.mutedText}>{t("请选择一个工作空间。")}</Text>
      ) : directories.length === 0 ? (
        <EmptyState
          bare
          icon="folder-open-outline"
          title={t("还没有目录")}
          message={t("在电脑端添加目录后，可以在这里按目录查看会话。")}
        />
      ) : (
        <View style={styles.projectList}>
          {directories.map((directory) => {
            const directorySessions =
              sessionsByDirectory.get(directory.directoryCode) ?? [];
            const expanded = Boolean(
              expandedDirectories[directory.directoryCode],
            );
            return (
              <View key={directory.directoryCode} style={styles.projectCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={format(
                    expanded ? "收起目录 {name}" : "展开目录 {name}",
                    { name: directory.name },
                  )}
                  accessibilityState={{ expanded }}
                  onPress={() =>
                    setExpandedDirectories((previous) => ({
                      ...previous,
                      [directory.directoryCode]:
                        !previous[directory.directoryCode],
                    }))
                  }
                  style={({ pressed }) => [
                    styles.projectHeader,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.projectIcon}>
                    <Ionicons
                      name="folder-outline"
                      size={16}
                      color={palette.accent}
                    />
                  </View>
                  <View style={styles.projectTitleBlock}>
                    <Text style={styles.projectName} numberOfLines={1}>
                      {directory.name || directory.directoryCode}
                    </Text>
                    <Text style={styles.directoryPath} numberOfLines={1}>
                      {directory.path}
                    </Text>
                  </View>
                  {directory.available === false ? (
                    <Badge label={t("目录不可用")} tone="danger" />
                  ) : (
                    <Badge label={`${directorySessions.length}`} />
                  )}
                  <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={palette.muted}
                  />
                </Pressable>

                {expanded ? (
                  <View style={styles.projectSessions}>
                    {directorySessions.length ? (
                      directorySessions.map((session, index) => (
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
                        {t("该目录下还没有会话。")}
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

  const renderTopics = () => (
    <View style={styles.section}>
      {!selectedWorkspaceCode ? (
        <Text style={styles.mutedText}>{t("请选择一个工作空间。")}</Text>
      ) : projects.length === 0 ? (
        <EmptyState
          bare
          icon="folder-open-outline"
          title={t("还没有主题")}
          message={t("在电脑端创建主题后，可以在这里按主题查看会话。")}
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
                  accessibilityLabel={format(
                    expanded ? "收起主题 {name}" : "展开主题 {name}",
                    { name: project.name },
                  )}
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
                      {format("更新于 {time}", {
                        time: formatRelativeTime(project.updatedAt),
                      })}
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
                        {t("该主题下还没有手动会话。")}
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

  const tabLabel = (label: string, count: number) =>
    count ? `${label} ${count}` : label;

  const menuCount = (pageCode: string): number => {
    if (pageCode === "chat.projects") return projects.length;
    if (pageCode === "chat.directories") return directories.length;
    if (pageCode === "chat.recents") return recentSessions.length;
    return 0;
  };

  const activeMenu =
    chatMenus.find((menu) => menu.pageCode === tab) ?? chatMenus[0];

  const tabControl = (
    <View style={styles.section}>
      <View style={styles.tabsRow}>
        <View style={styles.tabsControl}>
          <SegmentedControl<string>
            value={activeMenu?.pageCode ?? ""}
            onChange={setTab}
            options={chatMenus.map((menu) => ({
              value: menu.pageCode,
              label: tabLabel(menu.label, menuCount(menu.pageCode)),
            }))}
          />
        </View>
        {contentLoading ? (
          <ActivityIndicator size="small" color={palette.accent} />
        ) : null}
      </View>
    </View>
  );

  const activeTab = !activeMenu ? null : activeMenu.pageCode ===
    "chat.projects" ? (
    renderTopics()
  ) : activeMenu.pageCode === "chat.directories" ? (
    renderDirectories()
  ) : activeMenu.pageCode === "chat.recents" ? (
    renderChats()
  ) : (
    <EmptyState
      bare
      icon="apps-outline"
      title={activeMenu.label}
      message={t("手机暂不支持这个分组。")}
    />
  );

  return (
    <Screen>
      <AppHeader
        title={computer.name}
        subtitle={computer.baseUrl}
        onBack={() => navigation.navigate("Dashboard")}
        right={
          <Badge
            withDot
            tone={disconnected ? "danger" : sessionStatus === "online" ? "accent" : "muted"}
            label={statusLabel}
          />
        }
      />

      {disconnected ? (
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
            icon={unauthorized ? "key-outline" : "cloud-offline-outline"}
            title={unauthorized ? t("凭证失效") : t("电脑离线")}
            message={
              sessionError ??
              (unauthorized
                ? t(
                    "电脑端已吊销或删除了这台设备的配对凭证。请删除节点后重新扫码配对。",
                  )
                : t(
                    "无法连接这台电脑，已清空当前会话内容。请确认电脑端 Tron 在运行，并检查网络与节点地址。",
                  ))
            }
            action={
              unauthorized ? (
                <Button
                  label={t("管理节点")}
                  icon="settings-outline"
                  onPress={() =>
                    navigation.navigate("Nodes", {
                      productCode: computer.productCode,
                    })
                  }
                />
              ) : (
                <Button
                  label={t("重新连接")}
                  icon="refresh"
                  onPress={() => void probeNow()}
                />
              )
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
                actionLabel={t("重试")}
                onAction={() => void refreshAll(false, true)}
              />
            </View>
          ) : null}

          {loadFailed ? (
            <EmptyState
              icon="alert-circle-outline"
              title={t("无法加载节点数据")}
              message={error ?? t("请稍后重试。")}
              action={
                <Button
                  label={t("重试")}
                  icon="refresh"
                  onPress={() => void refreshAll(false, true)}
                />
              }
            />
          ) : wide ? (
            <View style={styles.columns}>
              <View style={styles.column}>
                {renderAssistantSection()}
                {renderWorkspaceSection()}
              </View>
              <View style={styles.column}>
                {tabControl}
                {activeTab}
              </View>
            </View>
          ) : (
            <View style={styles.mobileStack}>
              {renderAssistantSection()}
              {renderWorkspaceSection()}
              {tabControl}
              {activeTab}
            </View>
          )}
        </ScrollView>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("新建随聊")}
        accessibilityState={{ disabled: !canCreate }}
        disabled={!canCreate}
        onPress={() => createChat()}
        style={({ pressed }) => [
          styles.fab,
          !canCreate && styles.fabDisabled,
          pressed && styles.fabPressed,
        ]}
      >
        <Ionicons name="add" size={28} color={palette.onAccent} />
      </Pressable>
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
    tabsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    tabsControl: {
      flex: 1,
      minWidth: 0,
    },
    mutedText: {
      color: c.muted,
      ...typography.caption,
      lineHeight: 18,
      paddingVertical: spacing.sm,
    },
    assistantList: {
      gap: spacing.md,
      paddingRight: spacing.sm,
    },
    assistantCard: {
      width: 200,
      minHeight: 172,
      padding: spacing.lg,
      borderRadius: radius.card,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      gap: spacing.sm,
    },
    assistantCardMain: {
      borderColor: c.accentBorder,
      backgroundColor: c.surfaceAlt,
    },
    assistantDisabled: {
      opacity: 0.65,
    },
    assistantTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      minHeight: 28,
    },
    assistantAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.accentBorder,
    },
    assistantBadges: {
      flexDirection: "row",
      gap: spacing.xs,
      flexShrink: 1,
    },
    assistantName: {
      color: c.text,
      ...typography.bodyStrong,
      fontSize: 16,
    },
    assistantDescription: {
      flex: 1,
      color: c.muted,
      ...typography.caption,
      lineHeight: 17,
    },
    assistantFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.sm,
    },
    assistantFooterText: {
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
    directoryPath: {
      color: c.muted,
      ...typography.mono,
      fontSize: 10,
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