import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { StreamUnsupportedError, isUnauthorizedError } from "../api/client";
import {
  listChatMessages,
  listSessionGroups,
  pollMessagesUntilAssistant,
  sendChatMessage,
  sendChatMessageStream,
  type ChatMessage,
  type ChatSession,
} from "../api/tron";
import { AppHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { InlineBanner } from "../components/InlineBanner";
import { LoadingView } from "../components/LoadingView";
import { MessageBubble } from "../components/MessageBubble";
import { Screen } from "../components/Screen";
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
import { describeError, isAbortError, parseTimestamp } from "../utils/format";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

function sortByUpdatedDesc(left: ChatSession, right: ChatSession): number {
  return (
    (parseTimestamp(right.updatedAt)?.getTime() ?? 0) -
    (parseTimestamp(left.updatedAt)?.getTime() ?? 0)
  );
}

export function ChatScreen({ navigation, route }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const { currentNode: computer } = useConnections();
  const {
    status: sessionStatus,
    error: sessionError,
    contentEpoch,
    request: sessionRequest,
    ensureAccessToken,
    refreshAccessToken,
    reportRequestError,
    probeNow,
  } = useNodeSession();
  const { width } = useWindowDimensions();
  const wide = width >= layout.wideBreakpoint;

  const { session } = route.params;
  const sessionCode = session.sessionCode;
  const workspaceCode =
    route.params.workspaceCode || session.workspaceCode || "";
  const effectiveDudeCode =
    route.params.dudeCode ??
    ((session.sourceType ?? "").toUpperCase() === "DUDE"
      ? (session.sourceCode ?? null)
      : null);
  const dudeName = route.params.dudeName ?? null;
  const title =
    session.title?.trim() ||
    (dudeName ? format("与 {name} 的会话", { name: dudeName }) : t("新会话"));
  const baseUrl = computer?.baseUrl ?? "";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarSessions, setSidebarSessions] = useState<ChatSession[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(false);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const messagesSeqRef = useRef(0);
  const streamControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const activeSessionRef = useRef(sessionCode);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeSessionRef.current = sessionCode;
  }, [sessionCode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamControllerRef.current?.abort();
    };
  }, []);

  const loadMessages = useCallback(
    async (showSpinner: boolean) => {
      if (!workspaceCode || sessionStatus !== "online") {
        setLoading(false);
        return;
      }
      const sequence = ++messagesSeqRef.current;
      if (showSpinner) setLoading(true);
      try {
        const next = await sessionRequest(({ baseUrl: requestBaseUrl, token }) =>
          listChatMessages({
            baseUrl: requestBaseUrl,
            token,
            sessionCode,
            workspaceCode,
            dudeCode: effectiveDudeCode,
          }),
        );
        if (sequence !== messagesSeqRef.current) return;
        setMessages(next);
        setError(null);
      } catch (loadError) {
        if (sequence !== messagesSeqRef.current) return;
        if (!isAbortError(loadError)) setError(describeError(loadError));
      } finally {
        if (sequence === messagesSeqRef.current) setLoading(false);
      }
    },
    [effectiveDudeCode, sessionCode, sessionRequest, sessionStatus, workspaceCode],
  );

  // Session/epoch changes (node switch, app background, offline) clear the
  // in-memory message list before any reload.
  useEffect(() => {
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    messagesSeqRef.current += 1;
    setSending(false);
    setMessages([]);
    setStreamText("");
    setError(null);
    setNotice(null);
    setLoading(sessionStatus !== "offline");
    if (sessionStatus === "online") {
      void loadMessages(true);
    }
  }, [contentEpoch, loadMessages, sessionCode, sessionStatus]);

  const reloadMessages = useCallback(async (): Promise<ChatMessage[] | null> => {
    if (!workspaceCode || sessionStatus !== "online") return null;
    const sequence = ++messagesSeqRef.current;
    try {
      const next = await sessionRequest(({ baseUrl: requestBaseUrl, token }) =>
        listChatMessages({
          baseUrl: requestBaseUrl,
          token,
          sessionCode,
          workspaceCode,
          dudeCode: effectiveDudeCode,
        }),
      );
      if (mountedRef.current && sequence === messagesSeqRef.current) {
        setMessages(next);
        setError(null);
      }
      return next;
    } catch {
      // Keep the visible error from the failed send.
      return null;
    }
  }, [effectiveDudeCode, sessionCode, sessionRequest, sessionStatus, workspaceCode]);

  useEffect(() => {
    if (!wide || sessionStatus !== "online" || !workspaceCode) return;
    let cancelled = false;
    setSidebarLoading(true);
    setSidebarSessions([]);
    void sessionRequest(({ baseUrl: requestBaseUrl, token }) =>
      listSessionGroups({
        baseUrl: requestBaseUrl,
        token,
        workspaceCode,
      }),
    )
      .then((groups) => {
        if (cancelled) return;
        const byCode = new Map<string, ChatSession>();
        for (const group of groups) {
          for (const item of group.sessions ?? []) {
            const isManual = (item.sourceType ?? "").toUpperCase() === "MANUAL";
            if (isManual && !item.projectCode && !item.directoryCode) {
              byCode.set(item.sessionCode, item);
            }
          }
        }
        setSidebarSessions([...byCode.values()].sort(sortByUpdatedDesc));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSidebarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionRequest, sessionStatus, wide, workspaceCode]);

  const scrollToBottom = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  useEffect(() => {
    const subscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        setTimeout(() => scrollToBottom(true), 120);
      },
    );
    return () => subscription.remove();
  }, [scrollToBottom]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || sending) return;
    if (!baseUrl || !workspaceCode || sessionStatus !== "online") {
      setError(t("连接信息缺失或电脑离线，请返回重新连接节点"));
      return;
    }

    const serverCount = messagesRef.current.filter(
      (message) => !String(message.messageCode).startsWith("local-"),
    ).length;
    const optimisticId = `local-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      messageCode: optimisticId,
      sessionCode,
      role: "USER",
      channel: "MAIN_AGENT",
      actor: "user",
      content,
      attachments: [],
      createdAt: new Date().toISOString(),
    };

    setMessages((previous) => [...previous, optimistic]);
    setInput("");
    setSending(true);
    setError(null);
    setNotice(null);
    setStreamText("");

    const controller = new AbortController();
    streamControllerRef.current = controller;
    let accumulated = "";

    const runStream = (token: string) =>
      sendChatMessageStream({
        baseUrl,
        token,
        sessionCode,
        workspaceCode,
        content,
        dudeCode: effectiveDudeCode,
        signal: controller.signal,
        onDelta: (delta) => {
          accumulated += delta;
          if (mountedRef.current) setStreamText(accumulated);
        },
      });

    try {
      let result;
      let token: string;
      try {
        token = await ensureAccessToken();
      } catch (tokenError) {
        setError(describeError(tokenError));
        setMessages((previous) =>
          previous.filter((message) => message.messageCode !== optimisticId),
        );
        return;
      }

      try {
        result = await runStream(token);
      } catch (streamError) {
        if (!isUnauthorizedError(streamError)) throw streamError;
        // JWT expired mid-session: exchange the pairing token once more.
        const refreshedToken = await refreshAccessToken();
        result = await runStream(refreshedToken);
      }

      if (!mountedRef.current || activeSessionRef.current !== sessionCode) return;

      // `result.messages` only contains this run's messages (the user turn and
      // the assistant reply), not the whole session. Reload the list so earlier
      // history is preserved and server message codes replace the optimistic row.
      const reloaded = await reloadMessages();
      const persistedReply = reloaded?.some(
        (message) =>
          message.role === "ASSISTANT" && message.content.trim().length > 0,
      );
      if (!persistedReply && result.messages.length === 0 && accumulated.trim()) {
        const synthetic: ChatMessage = {
          id: `stream-${Date.now()}`,
          messageCode: `stream-${Date.now()}`,
          sessionCode,
          role: "ASSISTANT",
          channel: "MAIN_AGENT",
          actor: "assistant",
          content: accumulated,
          attachments: [],
          createdAt: new Date().toISOString(),
        };
        setMessages((previous) => [...previous, synthetic]);
      }
    } catch (sendError) {
      if (
        !mountedRef.current ||
        activeSessionRef.current !== sessionCode
      ) {
        return;
      }

      if (isAbortError(sendError)) {
        setStreamText("");
        return;
      }

      if (sendError instanceof StreamUnsupportedError) {
        // Documented fallback: plain POST + message polling when the runtime
        // cannot expose a readable streaming body.
        setNotice(t("当前环境不支持流式响应，正在切换为普通发送模式。"));
        try {
          const fallback = await sessionRequest(({ baseUrl: requestBaseUrl, token }) =>
            sendChatMessage({
              baseUrl: requestBaseUrl,
              token,
              sessionCode,
              workspaceCode,
              content,
              dudeCode: effectiveDudeCode,
              signal: controller.signal,
            }),
          );
          if (!mountedRef.current) return;
          await reloadMessages();
          const hasAssistant = fallback.messages.some(
            (message) =>
              message.role === "ASSISTANT" && message.content.trim().length > 0,
          );
          if (!hasAssistant) {
            const polled = await sessionRequest(({ baseUrl: requestBaseUrl, token }) =>
              pollMessagesUntilAssistant({
                baseUrl: requestBaseUrl,
                token,
                sessionCode,
                workspaceCode,
                dudeCode: effectiveDudeCode,
                afterCount: serverCount,
                signal: controller.signal,
                onMessages: (next) => {
                  if (
                    mountedRef.current &&
                    activeSessionRef.current === sessionCode
                  ) {
                    setMessages(next);
                  }
                },
              }),
            );
            if (
              mountedRef.current &&
              activeSessionRef.current === sessionCode &&
              polled.length
            ) {
              setMessages(polled);
            }
          }
          setStreamText("");
        } catch (fallbackError) {
          if (
            !mountedRef.current ||
            activeSessionRef.current !== sessionCode
          ) {
            return;
          }
          if (!isAbortError(fallbackError)) {
            reportRequestError(fallbackError);
            setError(describeError(fallbackError));
            await reloadMessages();
          }
        }
      } else {
        reportRequestError(sendError);
        setError(describeError(sendError));
        await reloadMessages();
      }
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
      if (mountedRef.current) {
        setSending(false);
        setStreamText("");
      }
    }
  };

  const openSidebarSession = (target: ChatSession) => {
    if (target.sessionCode === sessionCode) return;
    navigation.setParams({
      session: target,
      workspaceCode: target.workspaceCode ?? workspaceCode,
      dudeCode: null,
      dudeName: null,
    });
  };

  const horizontalPadding = 20;
  const offline = sessionStatus === "offline";
  const canSend =
    Boolean(input.trim()) && !sending && !loading && sessionStatus === "online";

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[styles.headerWrap, { paddingHorizontal: wide ? 32 : 20 }]}
        >
          <AppHeader
            title={title}
            subtitle={dudeName ? `Dude · ${dudeName}` : t("会话", "chat")}
            onBack={() => navigation.goBack()}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("刷新消息")}
                accessibilityState={{ disabled: sending || loading || offline }}
                disabled={sending || loading || offline}
                onPress={() => void loadMessages(true)}
                style={({ pressed }) => [
                  styles.headerIconButton,
                  (sending || loading || offline) && styles.headerIconButtonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="refresh" size={18} color={palette.text} />
              </Pressable>
            }
          />
        </View>

        {offline ? (
          <View style={styles.offlineWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title={t("电脑离线")}
              message={
                sessionError ??
                t(
                  "无法连接这台电脑，已清空当前会话内容。请确认电脑端 Tron 在运行，并检查网络与节点地址。",
                )
              }
              action={
                <Button
                  label={t("重新连接")}
                  icon="refresh"
                  onPress={() => void probeNow()}
                />
              }
            />
          </View>
        ) : (
          <View style={[styles.body, { paddingHorizontal: wide ? 32 : 0 }]}>
            {wide ? (
              <View style={styles.sidebar}>
                <View style={styles.sidebarHeader}>
                  <Text style={styles.sidebarTitle}>{t("随聊")}</Text>
                  <Text style={styles.sidebarCount}>{sidebarSessions.length}</Text>
                </View>
                {sidebarLoading ? (
                  <LoadingView compact />
                ) : sidebarSessions.length ? (
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.sidebarList}
                  >
                    {sidebarSessions.map((item) => (
                      <SessionRow
                        key={item.sessionCode}
                        session={item}
                        compact
                        active={item.sessionCode === sessionCode}
                        onPress={() => openSidebarSession(item)}
                      />
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.sidebarEmpty}>
                    {t("还没有随聊会话")}
                  </Text>
                )}
              </View>
            ) : null}

            <View style={styles.chatColumn}>
              {notice ? (
                <View style={styles.bannerWrap}>
                  <InlineBanner message={notice} tone="info" />
                </View>
              ) : null}
              {error ? (
                <View style={styles.bannerWrap}>
                  <InlineBanner
                    message={error}
                    actionLabel={t("重试")}
                    onAction={() => void loadMessages(true)}
                  />
                </View>
              ) : null}

              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(item) => String(item.messageCode ?? item.id)}
                renderItem={({ item }) => (
                  <MessageBubble
                    role={item.role}
                    content={item.content}
                    assistantName={item.role === "ASSISTANT" ? dudeName : null}
                  />
                )}
                contentContainerStyle={[
                  styles.messagesContent,
                  { paddingHorizontal: horizontalPadding },
                  messages.length === 0 && !loading && styles.messagesContentEmpty,
                ]}
                ListEmptyComponent={
                  loading ? (
                    <LoadingView
                      label={
                        sessionStatus === "online"
                          ? t("正在加载消息…")
                          : t("正在建立安全会话…")
                      }
                    />
                  ) : (
                    <EmptyState
                      bare
                      icon="chatbubble-ellipses-outline"
                      title={t("开始对话")}
                      message={
                        dudeName
                          ? format("和 {name} 打个招呼，开始新的对话。", {
                              name: dudeName,
                            })
                          : t("发送一条消息，Tron 会在这里回复。")
                      }
                    />
                  )
                }
                ListFooterComponent={
                  sending ? (
                    <MessageBubble
                      role="ASSISTANT"
                      content={streamText}
                      assistantName={dudeName}
                      pending
                    />
                  ) : undefined
                }
                onContentSizeChange={() => {
                  if (messages.length || sending) scrollToBottom(false);
                }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
              />

              <View
                style={[
                  styles.composerWrap,
                  { paddingHorizontal: horizontalPadding },
                ]}
              >
                <View style={styles.composer}>
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder={
                      dudeName
                        ? format("给 {name} 发消息…", { name: dudeName })
                        : t("输入消息…")
                    }
                    placeholderTextColor={palette.muted}
                    selectionColor={palette.accent}
                    multiline
                    maxLength={8_000}
                    style={styles.composerInput}
                    editable={!loading && sessionStatus === "online"}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("发送消息")}
                    accessibilityState={{ disabled: !canSend, busy: sending }}
                    disabled={!canSend}
                    onPress={() => void handleSend()}
                    style={({ pressed }) => [
                      styles.sendButton,
                      !canSend && styles.sendButtonDisabled,
                      pressed && canSend && styles.pressed,
                    ]}
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color={palette.onAccent} />
                    ) : (
                      <Ionicons name="arrow-up" size={20} color={palette.onAccent} />
                    )}
                  </Pressable>
                </View>
                <Text style={styles.composerHint}>
                  {sending
                    ? t("正在接收回复…")
                    : t("支持多行输入，点击右侧按钮发送")}
                </Text>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    headerWrap: {
      width: "100%",
    },
    headerIconButtonDisabled: {
      opacity: 0.4,
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
    offlineWrap: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: spacing.xl,
      paddingBottom: 80,
    },
    body: {
      flex: 1,
      flexDirection: "row",
      width: "100%",
      gap: spacing.xxl,
    },
    sidebar: {
      width: layout.chatSidebarWidth,
      paddingRight: spacing.lg,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: c.border,
    },
    sidebarHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    sidebarTitle: {
      color: c.text,
      ...typography.section,
    },
    sidebarCount: {
      color: c.muted,
      ...typography.caption,
    },
    sidebarList: {
      paddingBottom: spacing.xl,
      gap: 2,
    },
    sidebarEmpty: {
      color: c.muted,
      ...typography.caption,
      padding: spacing.lg,
      lineHeight: 18,
    },
    chatColumn: {
      flex: 1,
      minWidth: 0,
    },
    bannerWrap: {
      paddingTop: spacing.md,
      paddingHorizontal: 20,
    },
    messagesContent: {
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
    },
    messagesContentEmpty: {
      flexGrow: 1,
      justifyContent: "center",
    },
    composerWrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      backgroundColor: c.background,
    },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.card,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    composerInput: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      color: c.text,
      ...typography.body,
      lineHeight: 21,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
    },
    sendButtonDisabled: {
      opacity: 0.35,
    },
    composerHint: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    pressed: {
      opacity: 0.75,
    },
  });