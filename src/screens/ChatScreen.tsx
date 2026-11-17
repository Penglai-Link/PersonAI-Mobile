import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import {
  ASSISTANT_SOURCE_TYPE,
  listAssistants,
  listChatMessages,
  answerChatUserInput,
  getChatA2uiState,
  listChatProtocolEvents,
  runChatA2uiAction,
  sendChatMessageStream,
  steerChatMessage,
  stopChatRun,
  type ChatMessage,
} from "../api/tron";
import type { AgUiEvent } from "../api/rpc";
import { AppHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { InlineBanner } from "../components/InlineBanner";
import { LoadingView } from "../components/LoadingView";
import { MessageBubble as LocalMessageBubble } from "../components/MessageBubble";
import { NodeLatencyText } from "../components/NodeLatency";
import { RunProcess } from "../components/RunProcess";
import {
  ApprovalCard,
  MessageBubble as AgentMessageBubble,
} from "@personai/agent-ui-chat-react-native";
import {
  ChatA2uiSession,
  batchApprovalDecisions,
  nativeUserInputBatchAnswer,
  nativeUserInputRequests,
  pendingApprovalRequests,
  type ChatA2uiActionHandler,
  type ChatA2uiState,
  type ChatMessage as AgentChatMessage,
  type ChatUserInputAnswer,
  type ChatUserInputLabels,
  type ChatUserInputRequest,
} from "@personai/agent-ui-chat-core/headless";
import { Screen } from "../components/Screen";
import { Ionicons } from "../components/icons";
import { useI18n } from "../i18n";
import type { RootStackParamList } from "../navigation/types";
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
import { describeError, isAbortError } from "../utils/format";
import { useKeyboardOverlap } from "../utils/keyboard";
import {
  buildRunTraces,
  reduceRunTrace,
  type RunTrace,
} from "../utils/runTrace";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

interface QueuedChatMessage {
  id: string;
  content: string;
}

function toAgentMessage(
  message: ChatMessage,
  sessionCode: string,
  assistantName: string | null,
): AgentChatMessage {
  const createdAt =
    typeof message.createdAt === "string"
      ? message.createdAt
      : new Date(message.createdAt).toISOString();
  const isUser = message.role === "USER";
  return {
    id: message.id,
    messageId: message.messageCode ?? String(message.id),
    sessionId: sessionCode,
    role: isUser ? "USER" : "ASSISTANT",
    channel: message.channel ?? "MAIN_AGENT",
    actor: isUser
      ? (message.actor ?? "user")
      : assistantName?.trim() || message.actor || "assistant",
    content: message.content,
    createdAt,
    ...(message.a2ui ? { a2ui: message.a2ui } : {}),
  };
}

export function ChatScreen({ navigation, route }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { t, format } = useI18n();
  const {
    status: sessionStatus,
    error: sessionError,
    contentEpoch,
    currentNode,
    request: sessionRequest,
    reportRequestError,
    probeNow,
  } = useNodeSession();
  const { width } = useWindowDimensions();
  const wide = width >= layout.wideBreakpoint;
  const keyboardOverlap = useKeyboardOverlap();
  const agentTheme = {
    textColor: palette.text,
    mutedTextColor: palette.muted,
    surfaceColor: palette.surface,
    borderColor: palette.border,
    primaryColor: palette.accent,
    primaryTextColor: palette.onAccent,
    dangerColor: palette.danger,
    borderRadius: radius.card,
    spacing: spacing.md,
    panelColor: palette.background,
    userBubbleColor: palette.accent,
    userBubbleTextColor: palette.onAccent,
    assistantBubbleColor: palette.surface,
  };

  const { session } = route.params;
  const sessionCode = session.sessionCode;
  const workspaceCode =
    route.params.workspaceCode || session.workspaceCode || "";
  const effectiveAssistantCode =
    route.params.assistantCode ??
    ((session.sourceType ?? "").toUpperCase() === ASSISTANT_SOURCE_TYPE
      ? (session.sourceCode ?? null)
      : null);
  const [resolvedAssistantName, setResolvedAssistantName] = useState<
    string | null
  >(route.params.assistantName ?? null);
  const assistantName = resolvedAssistantName;
  const assistantChat = Boolean(effectiveAssistantCode);
  // Assistant sessions are titled with their assistant code on the node
  // (`main-dude · Interactive`); the name is what belongs in the header.
  const title = assistantChat
    ? assistantName?.trim() || t("个人助手")
    : session.title?.trim() ||
      (assistantName
        ? format("与 {name} 的会话", { name: assistantName })
        : t("新会话"));
  const nodeLabel = currentNode?.name?.trim() || t("节点");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [traces, setTraces] = useState<Map<string, RunTrace>>(
    () => new Map(),
  );
  const [liveTrace, setLiveTrace] = useState<RunTrace | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedChatMessage[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ChatUserInputRequest[]>([]);
  const [answering, setAnswering] = useState(false);
  const [a2uiRevision, setA2uiRevision] = useState(0);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messagesSeqRef = useRef(0);
  const streamControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const activeSessionRef = useRef(sessionCode);
  const sendingRef = useRef(false);
  const sessionStatusRef = useRef(sessionStatus);
  const liveTraceRef = useRef<RunTrace | null>(null);
  /** What the message list was last reset for; status flips must not reset it. */
  const resetKeyRef = useRef<string>("");
  /** Guards the one reload per online transition. */
  const onlineLoadedRef = useRef(false);
  const queuedRef = useRef<QueuedChatMessage[]>([]);
  const a2uiSession = useMemo(() => new ChatA2uiSession(sessionCode), [sessionCode]);
  const a2uiSessionRef = useRef(a2uiSession);
  const answeredRequestIdsRef = useRef(new Set<string>());
  const pendingRequestsRef = useRef<ChatUserInputRequest[]>([]);
  const a2uiBusyRef = useRef(false);
  /** Assistant name lookup for sessions opened without one (drawer, running). */
  const assistantLookupRef = useRef<string>("");
  const runMessageRef = useRef<(content: string) => Promise<void>>(
    async () => undefined,
  );

  useEffect(() => {
    const givenName = route.params.assistantName?.trim();
    if (givenName) {
      setResolvedAssistantName(givenName);
      return;
    }
    if (!effectiveAssistantCode) {
      setResolvedAssistantName(null);
      return;
    }
    if (sessionStatus !== "online") return;

    const key = `${effectiveAssistantCode}|${workspaceCode}`;
    if (assistantLookupRef.current === key) return;
    assistantLookupRef.current = key;
    let cancelled = false;
    void sessionRequest(({ tunnel }) =>
      listAssistants({ tunnel, workspaceCode }),
    )
      .then((assistants) => {
        if (cancelled) return;
        const match = assistants.find(
          (assistant) => assistant.assistantCode === effectiveAssistantCode,
        );
        setResolvedAssistantName(match?.name?.trim() || null);
      })
      .catch(() => {
        // Let the next online transition try again.
        if (assistantLookupRef.current === key) assistantLookupRef.current = "";
      });
    return () => {
      cancelled = true;
    };
  }, [
    effectiveAssistantCode,
    route.params.assistantName,
    sessionRequest,
    sessionStatus,
    workspaceCode,
  ]);

  useEffect(() => {
    queuedRef.current = queued;
  }, [queued]);

  useEffect(() => {
    liveTraceRef.current = liveTrace;
  }, [liveTrace]);

  useEffect(() => {
    pendingRequestsRef.current = pendingRequests;
  }, [pendingRequests]);

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

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

  const refreshProtocolEvents = useCallback(
    (sequence: number) => {
      if (!workspaceCode || sessionStatus !== "online") return;
      void sessionRequest(
        ({ tunnel }) =>
          listChatProtocolEvents({
            tunnel,
            sessionCode,
            workspaceCode,
            assistantCode: effectiveAssistantCode,
          }),
        { retry: false },
      )
        .then((events) => {
          if (mountedRef.current && sequence === messagesSeqRef.current) {
            setTraces((previous) => {
              const next = buildRunTraces(events);
              // A run that just finished may not be in the node's replay yet;
              // keep the trace collected live instead of dropping it.
              for (const [runId, trace] of previous) {
                if (!next.has(runId)) next.set(runId, trace);
              }
              return next;
            });
            const requests = nativeUserInputRequests(
              events as Parameters<typeof nativeUserInputRequests>[0],
              sessionCode,
            ).filter(
              (request) => !answeredRequestIdsRef.current.has(request.requestId),
            );
            setPendingRequests(requests);
          }
        })
        .catch(() => undefined);
    },
    [effectiveAssistantCode, sessionCode, sessionRequest, sessionStatus, workspaceCode],
  );

  const refreshA2uiState = useCallback(async () => {
    if (!workspaceCode || sessionStatus !== "online") return;
    try {
      const state = await sessionRequest(
        ({ tunnel }) =>
          getChatA2uiState({
            tunnel,
            sessionCode,
            workspaceCode,
            assistantCode: effectiveAssistantCode,
          }),
        { retry: false },
      );
      if (!state || !mountedRef.current) return;
      a2uiSessionRef.current.hydrate(state as unknown as ChatA2uiState);
      setA2uiRevision((value) => value + 1);
    } catch {
      // Older nodes do not expose A2UI state; display-only surfaces still work.
    }
  }, [
    effectiveAssistantCode,
    sessionCode,
    sessionRequest,
    sessionStatus,
    workspaceCode,
  ]);

  const loadMessages = useCallback(
    async (showSpinner: boolean) => {
      if (!workspaceCode || sessionStatus !== "online") {
        setLoading(false);
        return;
      }
      const sequence = ++messagesSeqRef.current;
      if (showSpinner) setLoading(true);
      try {
        const next = await sessionRequest(({ tunnel }) =>
          listChatMessages({
            tunnel,
            sessionCode,
            workspaceCode,
            assistantCode: effectiveAssistantCode,
          }),
        );
        if (sequence !== messagesSeqRef.current) return;
        setMessages(next);
        setError(null);
        refreshProtocolEvents(sequence);
        void refreshA2uiState();
      } catch (loadError) {
        if (sequence !== messagesSeqRef.current) return;
        if (!isAbortError(loadError)) setError(describeError(loadError));
      } finally {
        if (sequence === messagesSeqRef.current) setLoading(false);
      }
    },
    [
      effectiveAssistantCode,
      refreshA2uiState,
      refreshProtocolEvents,
      sessionCode,
      sessionRequest,
      sessionStatus,
      workspaceCode,
    ],
  );

  // Only a node switch, a background transition, or another session clears the
  // in-memory list. A connectivity flip (online -> reconnecting -> online) must
  // never wipe what is already on screen.
  useEffect(() => {
    const resetKey = `${contentEpoch}|${sessionCode}`;
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    onlineLoadedRef.current = false;
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    messagesSeqRef.current += 1;
    sendingRef.current = false;
    setSending(false);
    setMessages([]);
    setStreamText("");
    setError(null);
    setNotice(null);
    setTraces(new Map());
    setLiveTrace(null);
    liveTraceRef.current = null;
    setActiveRunId(null);
    queuedRef.current = [];
    setQueued([]);
    setPendingRequests([]);
    setAnswering(false);
    answeredRequestIdsRef.current = new Set();
    a2uiBusyRef.current = false;
    setA2uiRevision((value) => value + 1);
    setLoading(sessionStatus !== "offline");
  }, [contentEpoch, sessionCode, sessionStatus]);

  useEffect(() => {
    a2uiSessionRef.current = a2uiSession;
  }, [a2uiSession]);

  // Reconnects reload the transcript in place instead of clearing it.
  useEffect(() => {
    if (sessionStatus !== "online") {
      onlineLoadedRef.current = false;
      return;
    }
    if (onlineLoadedRef.current) return;
    onlineLoadedRef.current = true;
    void loadMessages(true);
  }, [loadMessages, sessionStatus]);

  const reloadMessages = useCallback(async (): Promise<ChatMessage[] | null> => {
    if (!workspaceCode || sessionStatus !== "online") return null;
    const sequence = ++messagesSeqRef.current;
    try {
      const next = await sessionRequest(({ tunnel }) =>
        listChatMessages({
          tunnel,
          sessionCode,
          workspaceCode,
          assistantCode: effectiveAssistantCode,
        }),
      );
      if (mountedRef.current && sequence === messagesSeqRef.current) {
        setMessages(next);
        setError(null);
        refreshProtocolEvents(sequence);
      }
      return next;
    } catch {
      // Keep the visible error from the failed send.
      return null;
    }
  }, [
    effectiveAssistantCode,
    refreshProtocolEvents,
    sessionCode,
    sessionRequest,
    sessionStatus,
    workspaceCode,
  ]);

  const scrollToBottom = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  // Virtualized rows (especially markdown) can finish measuring after the last
  // content-size callback, which used to leave the transcript parked above the
  // newest turn. One short deferred scroll settles it on the real bottom.
  useEffect(() => {
    if (!messages.length && !sending) return;
    const timer = setTimeout(() => scrollToBottom(false), 120);
    return () => clearTimeout(timer);
  }, [messages, scrollToBottom, sending]);

  useEffect(() => {
    const subscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        setTimeout(() => scrollToBottom(true), 120);
      },
    );
    return () => subscription.remove();
  }, [scrollToBottom]);

  const runMessage = useCallback(
    async (rawContent: string) => {
      const content = rawContent.trim();
      if (!content || sendingRef.current) return;
      if (!workspaceCode || sessionStatus !== "online") {
        setError(t("连接信息缺失或电脑离线，请返回重新连接节点"));
        return;
      }

      sendingRef.current = true;
      setSending(true);
      setError(null);
      setNotice(null);
      setStreamText("");
      setLiveTrace(null);
      liveTraceRef.current = null;
      setActiveRunId(null);

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

      const controller = new AbortController();
      streamControllerRef.current = controller;
      let accumulated = "";

      // `session.sendMessage` streams AG-UI events through the tunnel. Text
      // deltas feed the streaming bubble; every other event feeds the run trace
      // so tool calls and reasoning stay visible while the agent works.
      try {
        const result = await sessionRequest(
          ({ tunnel }) =>
            sendChatMessageStream({
              tunnel,
              sessionCode,
              workspaceCode,
              content,
              assistantCode: effectiveAssistantCode,
              signal: controller.signal,
              onDelta: (delta) => {
                accumulated += delta;
                if (mountedRef.current) setStreamText(accumulated);
              },
              onEvent: (event) => {
                if (!mountedRef.current) return;
                const type = (event.type ?? "").toUpperCase();
                if (type === "RUN_STARTED") {
                  setActiveRunId(
                    typeof event.runId === "string" ? event.runId : null,
                  );
                  setPendingRequests([]);
                } else if (type === "RUN_FINISHED") {
                  setActiveRunId(null);
                  const requests = nativeUserInputRequests(
                    [event as Parameters<typeof nativeUserInputRequests>[0][number]],
                    sessionCode,
                  ).filter(
                    (request) =>
                      !answeredRequestIdsRef.current.has(request.requestId),
                  );
                  setPendingRequests(requests);
                  void refreshA2uiState();
                } else if (type === "RUN_ERROR") {
                  setActiveRunId(null);
                  setPendingRequests([]);
                }
                const nextTrace = reduceRunTrace(
                  liveTraceRef.current,
                  event,
                );
                if (nextTrace !== liveTraceRef.current) {
                  liveTraceRef.current = nextTrace;
                  setLiveTrace(nextTrace);
                }
              },
            }),
          { retry: false },
        );
        if (!mountedRef.current || activeSessionRef.current !== sessionCode) {
          return;
        }

        // `result.messages` only contains this run's messages (the user turn
        // and the assistant reply), not the whole session. Reload the list so
        // earlier history is preserved and server message codes replace the
        // optimistic row.
        const reloaded = await reloadMessages();
        const persistedReply = reloaded?.some(
          (message) =>
            message.role === "ASSISTANT" && message.content.trim().length > 0,
        );
        if (
          !persistedReply &&
          result.messages.length === 0 &&
          accumulated.trim()
        ) {
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

        // Protocol replay may be unavailable on older nodes; keep the trace we
        // collected live so the process view does not disappear.
        const finishedTrace = liveTraceRef.current as RunTrace | null;
        if (finishedTrace && finishedTrace.status !== "running") {
          setTraces((previous) =>
            new Map(previous).set(finishedTrace.runId, finishedTrace),
          );
        }
      } catch (sendError) {
        if (!mountedRef.current || activeSessionRef.current !== sessionCode) {
          return;
        }

        if (isAbortError(sendError)) {
          setStreamText("");
          return;
        }

        reportRequestError(sendError);
        setError(describeError(sendError));
        await reloadMessages();
      } finally {
        if (streamControllerRef.current === controller) {
          streamControllerRef.current = null;
        }
        sendingRef.current = false;
        if (mountedRef.current) {
          setSending(false);
          setStreamText("");
        }
        if (
          mountedRef.current &&
          !controller.signal.aborted &&
          sessionStatusRef.current === "online" &&
          pendingRequestsRef.current.length === 0
        ) {
          const [nextQueued, ...rest] = queuedRef.current;
          if (nextQueued) {
            queuedRef.current = rest;
            setQueued(rest);
            setTimeout(() => void runMessageRef.current(nextQueued.content), 50);
          }
        }
      }
    },
    [
      effectiveAssistantCode,
      refreshA2uiState,
      reloadMessages,
      reportRequestError,
      sessionCode,
      sessionRequest,
      sessionStatus,
      t,
      workspaceCode,
    ],
  );

  useEffect(() => {
    runMessageRef.current = runMessage;
  }, [runMessage]);

  const handleSend = useCallback(() => {
    const content = input.trim();
    if (!content || sendingRef.current) return;
    if (pendingRequests.length > 0 || answering) {
      setNotice(t("请先完成上面的回答"));
      return;
    }
    if (!workspaceCode || sessionStatus !== "online") {
      setError(t("连接信息缺失或电脑离线，请返回重新连接节点"));
      return;
    }
    setInput("");
    void runMessage(content);
  }, [
    answering,
    input,
    pendingRequests.length,
    runMessage,
    sessionStatus,
    t,
    workspaceCode,
  ]);

  const handleSteer = useCallback(async () => {
    const content = input.trim();
    if (!content || !sendingRef.current) return;
    if (!activeRunId) {
      setError(t("正在等待运行开始，暂时无法引导"));
      return;
    }
    try {
      const message = await sessionRequest(
        ({ tunnel }) =>
          steerChatMessage({
            tunnel,
            sessionCode,
            runId: activeRunId,
            content,
            workspaceCode,
            assistantCode: effectiveAssistantCode,
          }),
        { retry: false },
      );
      if (!mountedRef.current) return;
      setInput("");
      setError(null);
      setNotice(t("已插入引导，当前执行会收到这条消息"));
      if (message) {
        setMessages((previous) => [...previous, message]);
      }
    } catch (steerError) {
      if (mountedRef.current) setError(describeError(steerError));
    }
  }, [
    activeRunId,
    effectiveAssistantCode,
    input,
    sessionCode,
    sessionRequest,
    t,
    workspaceCode,
  ]);

  const queueInput = useCallback(() => {
    const content = input.trim();
    if (!content || !sendingRef.current) return;
    const next = [
      ...queuedRef.current,
      { id: `queue-${Date.now()}`, content },
    ];
    queuedRef.current = next;
    setQueued(next);
    setInput("");
    setNotice(t("已加入队列，当前回复结束后自动发送"));
  }, [input, t]);

  const removeQueued = useCallback((id: string) => {
    const next = queuedRef.current.filter((item) => item.id !== id);
    queuedRef.current = next;
    setQueued(next);
  }, []);

  const handleStop = useCallback(async () => {
    if (!activeRunId) return;
    try {
      await sessionRequest(
        ({ tunnel }) =>
          stopChatRun({
            tunnel,
            sessionCode,
            runId: activeRunId,
            assistantCode: effectiveAssistantCode,
          }),
        { retry: false },
      );
      if (mountedRef.current) setNotice(t("已停止当前执行"));
    } catch (stopError) {
      if (mountedRef.current) setError(describeError(stopError));
    }
  }, [activeRunId, effectiveAssistantCode, sessionCode, sessionRequest, t]);

  const applyInteractionEvents = useCallback(
    (events: AgUiEvent[]) => {
      if (!events.length) return;
      setTraces((previous) => {
        const next = new Map(previous);
        for (const [runId, trace] of buildRunTraces(events)) {
          next.set(runId, trace);
        }
        return next;
      });
      const requests = nativeUserInputRequests(
        events as Parameters<typeof nativeUserInputRequests>[0],
        sessionCode,
      ).filter(
        (request) => !answeredRequestIdsRef.current.has(request.requestId),
      );
      setPendingRequests(requests);
    },
    [sessionCode],
  );

  const handleAnswer = useCallback(
    async (request: ChatUserInputRequest, answers: ChatUserInputAnswer[]) => {
      if (!request || answering) return;
      const approval =
        request.nativeInteraction?.reason === "approval_required" ||
        (request.nativeInteraction?.responseSchema as { type?: string } | undefined)
          ?.type === "boolean";
      let requests = [request];
      let finalAnswers = answers;
      if (approval) {
        const selected = answers.find(
          (answer) =>
            answer.questionId === request.requestId &&
            answer.answerKind === "Option",
        );
        const payload = selected?.optionId
          ? request.nativeInteraction?.optionPayloads[selected.optionId]
          : undefined;
        const group = pendingApprovalRequests(request, pendingRequests);
        const decisions =
          typeof payload === "boolean"
            ? batchApprovalDecisions(group, payload)
            : null;
        if (decisions && group.length > 1) {
          requests = group;
          finalAnswers = Object.values(decisions).flat();
        }
      }
      let input;
      try {
        input = nativeUserInputBatchAnswer(requests, finalAnswers);
      } catch (answerError) {
        setError(describeError(answerError));
        return;
      }
      setAnswering(true);
      const answeredIds = new Set(requests.map((item) => item.requestId));
      answeredIds.forEach((id) => answeredRequestIdsRef.current.add(id));
      setPendingRequests((previous) =>
        previous.filter((item) => !answeredIds.has(item.requestId)),
      );
      try {
        const events = await sessionRequest(
          ({ tunnel }) =>
            answerChatUserInput({
              tunnel,
              sessionCode,
              workspaceCode,
              assistantCode: effectiveAssistantCode,
              requestCode: request.requestId,
              answers: input.answers,
              resume: input.resume,
              a2uiMetadata: input.a2uiMetadata,
            }),
          { retry: false },
        );
        if (!mountedRef.current) return;
        applyInteractionEvents(events);
        await reloadMessages();
        void refreshA2uiState();
      } catch (answerError) {
        answeredIds.forEach((id) => answeredRequestIdsRef.current.delete(id));
        setPendingRequests((previous) => [
          ...requests.filter(
            (item) => !previous.some((entry) => entry.requestId === item.requestId),
          ),
          ...previous,
        ]);
        if (!isAbortError(answerError)) {
          reportRequestError(answerError);
          setError(describeError(answerError));
        }
      } finally {
        if (mountedRef.current) setAnswering(false);
      }
    },
    [
      answering,
      applyInteractionEvents,
      effectiveAssistantCode,
      pendingRequests,
      refreshA2uiState,
      reloadMessages,
      reportRequestError,
      sessionCode,
      sessionRequest,
      workspaceCode,
    ],
  );

  const handleA2UIAction = useCallback<ChatA2uiActionHandler>(
    (message, metadata, context) => {
      const surface = context?.surface;
      if (!surface || a2uiBusyRef.current) return;
      a2uiBusyRef.current = true;
      const actionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      void (async () => {
        try {
          const events = await sessionRequest(
            ({ tunnel }) =>
              runChatA2uiAction({
                tunnel,
                sessionCode,
                workspaceCode,
                assistantCode: effectiveAssistantCode,
                actionId,
                surfaceInstanceId: surface.surfaceInstanceId,
                expectedRevision: surface.revision,
                message,
                metadata,
              }),
            { retry: false },
          );
          if (!mountedRef.current) return;
          applyInteractionEvents(events);
          await reloadMessages();
          void refreshA2uiState();
        } catch (actionError) {
          if (!isAbortError(actionError)) {
            reportRequestError(actionError);
            setError(describeError(actionError));
          }
        } finally {
          a2uiBusyRef.current = false;
        }
      })();
    },
    [
      applyInteractionEvents,
      effectiveAssistantCode,
      refreshA2uiState,
      reloadMessages,
      reportRequestError,
      sessionCode,
      sessionRequest,
      workspaceCode,
    ],
  );

  const userInputLabels = useMemo<ChatUserInputLabels>(
    () => ({
      ariaLabel: t("助手提问"),
      progress: (current, total) =>
        format("第 {current} / {total} 题", { current, total }),
      back: t("上一步"),
      next: t("下一步"),
      continue: t("继续"),
      continuing: t("继续中…"),
      otherOptionLabel: t("其他"),
      otherOptionDescription: t("输入自定义回答"),
      skipOptionLabel: t("跳过"),
      skipOptionDescription: t("跳过此问题"),
      otherAnswerPlaceholder: t("输入你的答案"),
      otherAnswerAriaLabel: (index) =>
        format("其他答案（第 {index} 题）", { index }),
      approve: t("批准"),
      reject: t("拒绝"),
      approved: t("已批准"),
      rejected: t("已拒绝"),
      approvalTitle: t("批准工具执行"),
      approvalExecution: t("执行"),
      approvalDirectory: t("工作目录"),
      approvalParameters: t("全部参数"),
      approvalReason: t("为什么需要批准"),
      approvalScope: t("仅对本次调用生效"),
      approvalMissingDetails: t("执行详情未提供"),
    }),
    [format, t],
  );

  const horizontalPadding = 20;
  const offline = sessionStatus === "offline";
  const canSend =
    Boolean(input.trim()) &&
    !sending &&
    !answering &&
    pendingRequests.length === 0 &&
    !loading &&
    sessionStatus === "online";
  const canSteer = Boolean(input.trim()) && sending && Boolean(activeRunId);
  const canQueue = Boolean(input.trim()) && sending;

  // A run can produce more than one assistant message (steer/resume). Render
  // its process above the final message only, instead of repeating the tools.
  const traceOwnerByRun = useMemo(() => {
    const owners = new Map<string, string>();
    for (const message of messages) {
      if (message.role === "ASSISTANT" && message.runCode) {
        owners.set(message.runCode, message.messageCode);
      }
    }
    return owners;
  }, [messages]);

  return (
    <Screen padded={false}>
      <View style={[styles.flex, { paddingBottom: keyboardOverlap }]}>
        <View
          style={[styles.headerWrap, { paddingHorizontal: wide ? 32 : 20 }]}
        >
          <AppHeader
            title={title}
            subtitle={
              assistantChat
                ? nodeLabel
                : assistantName
                  ? `${t("个人助手")} · ${assistantName}`
                  : t("会话", "chat")
            }
            subtitleAccessory={
              assistantChat && currentNode ? (
                <NodeLatencyText
                  nodeId={currentNode.id}
                  leadingSeparator="·"
                  showPlaceholder
                />
              ) : null
            }
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
            <View style={styles.chatColumn}>
              {sessionStatus === "connecting" && sessionError ? (
                <View style={styles.bannerWrap}>
                  <InlineBanner
                    message={sessionError ?? t("正在重新连接电脑…")}
                    tone="info"
                  />
                </View>
              ) : null}
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
                extraData={[traces, a2uiRevision, pendingRequests]}
                keyExtractor={(item) => String(item.messageCode ?? item.id)}
                renderItem={({ item }) => {
                  const trace =
                    item.role === "ASSISTANT" &&
                    item.runCode &&
                    traceOwnerByRun.get(item.runCode) === item.messageCode
                      ? traces.get(item.runCode)
                      : undefined;
                  return (
                    <View>
                      {trace ? <RunProcess trace={trace} /> : null}
                      {item.role === "USER" && item.runCode ? (
                        <View style={styles.steerBadge}>
                          <Ionicons
                            name="git-branch-outline"
                            size={12}
                            color={palette.muted}
                          />
                          <Text style={styles.steerBadgeText}>{t("引导")}</Text>
                        </View>
                      ) : null}
                      <AgentMessageBubble
                        key={`${item.messageCode ?? item.id}:${a2uiRevision}`}
                        message={toAgentMessage(
                          item,
                          sessionCode,
                          assistantName,
                        )}
                        onA2UIAction={handleA2UIAction}
                        runtime={a2uiSession}
                        showIdentity={item.role === "ASSISTANT"}
                        theme={agentTheme}
                      />
                    </View>
                  );
                }}
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
                        assistantName
                          ? format("和 {name} 打个招呼，开始新的对话。", {
                              name: assistantName,
                            })
                          : t("发送一条消息，Tron 会在这里回复。")
                      }
                    />
                  )
                }
                ListFooterComponent={
                  sending ? (
                    <View>
                      {liveTrace ? (
                        <RunProcess trace={liveTrace} live />
                      ) : null}
                      <LocalMessageBubble
                        role="ASSISTANT"
                        content={streamText}
                        assistantName={assistantName}
                        pending
                      />
                    </View>
                  ) : undefined
                }
                onContentSizeChange={() => {
                  if (messages.length || sending) {
                    requestAnimationFrame(() => scrollToBottom(false));
                  }
                }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
              />

              {pendingRequests.length ? (
                <View
                  style={{
                    maxHeight: "45%",
                    paddingBottom: 8,
                    paddingHorizontal: horizontalPadding,
                  }}
                >
                  {pendingRequests.map((request) => (
                    <ApprovalCard
                      key={request.requestId}
                      labels={userInputLabels}
                      onSubmit={(answers) => void handleAnswer(request, answers)}
                      pending={answering}
                      request={request}
                      theme={agentTheme}
                    />
                  ))}
                </View>
              ) : null}

              <View
                style={[
                  styles.composerWrap,
                  { paddingHorizontal: horizontalPadding },
                ]}
              >
                {queued.length ? (
                  <View style={styles.queueList}>
                    {queued.map((item) => (
                      <View key={item.id} style={styles.queueItem}>
                        <Ionicons
                          name="time-outline"
                          size={13}
                          color={palette.muted}
                        />
                        <Text style={styles.queueText} numberOfLines={2}>
                          {item.content}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("移除排队消息")}
                          hitSlop={8}
                          onPress={() => removeQueued(item.id)}
                        >
                          <Ionicons name="close" size={14} color={palette.muted} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                {sending ? (
                  <View style={styles.runningBar}>
                    <Text style={styles.runningText} numberOfLines={1}>
                      {t("运行中，可引导或排队")}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("引导")}
                      accessibilityState={{ disabled: !canSteer }}
                      disabled={!canSteer}
                      onPress={() => void handleSteer()}
                      style={({ pressed }) => [
                        styles.modeButton,
                        !canSteer && styles.modeButtonDisabled,
                        pressed && canSteer && styles.pressed,
                      ]}
                    >
                      <Ionicons
                        name="git-branch-outline"
                        size={14}
                        color={canSteer ? palette.accent : palette.muted}
                      />
                      <Text
                        style={[
                          styles.modeLabel,
                          { color: canSteer ? palette.accent : palette.muted },
                        ]}
                      >
                        {t("引导")}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("排队")}
                      accessibilityState={{ disabled: !canQueue }}
                      disabled={!canQueue}
                      onPress={queueInput}
                      style={({ pressed }) => [
                        styles.modeButton,
                        !canQueue && styles.modeButtonDisabled,
                        pressed && canQueue && styles.pressed,
                      ]}
                    >
                      <Ionicons
                        name="return-down-forward-outline"
                        size={14}
                        color={canQueue ? palette.text : palette.muted}
                      />
                      <Text
                        style={[
                          styles.modeLabel,
                          { color: canQueue ? palette.text : palette.muted },
                        ]}
                      >
                        {t("排队")}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                <View style={styles.composer}>
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder={
                      assistantName
                        ? format("给 {name} 发消息…", { name: assistantName })
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
                    accessibilityLabel={sending ? t("停止") : t("发送消息")}
                    accessibilityState={{
                      disabled: sending ? !activeRunId : !canSend,
                      busy: sending,
                    }}
                    disabled={sending ? !activeRunId : !canSend}
                    onPress={sending ? () => void handleStop() : handleSend}
                    style={({ pressed }) => [
                      sending ? styles.stopButton : styles.sendButton,
                      (sending ? !activeRunId : !canSend) &&
                        styles.sendButtonDisabled,
                      pressed &&
                        (sending ? Boolean(activeRunId) : canSend) &&
                        styles.pressed,
                    ]}
                  >
                    {sending ? (
                      <Ionicons name="stop" size={18} color={palette.onAccent} />
                    ) : (
                      <Ionicons name="arrow-up" size={20} color={palette.onAccent} />
                    )}
                  </Pressable>
                </View>
                <Text style={styles.composerHint}>
                  {sending
                    ? t("引导会插入当前执行；排队会在结束后发送")
                    : t("支持多行输入，点击右侧按钮发送")}
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>
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
      width: "100%",
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
    steerBadge: {
      alignSelf: "flex-end",
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      marginBottom: 4,
      marginRight: 4,
    },
    steerBadgeText: {
      color: c.muted,
      ...typography.caption,
      fontSize: 10,
    },
    queueList: {
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    queueItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    queueText: {
      flex: 1,
      color: c.muted,
      ...typography.caption,
    },
    runningBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    runningText: {
      flex: 1,
      color: c.muted,
      ...typography.caption,
    },
    modeButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    modeButtonDisabled: {
      opacity: 0.5,
    },
    modeLabel: {
      ...typography.caption,
      fontWeight: "600",
    },
    stopButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.danger,
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