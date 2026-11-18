import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import {
  ApiError,
  isCredentialError,
  isDeviceAuthError,
  isTicketError,
  isTransportError,
  isUnauthorizedError,
} from "../api/client";
import { SecureTunnel, tunnels } from "../api/tunnel";
import { translate } from "../i18n";
import { describeError } from "../utils/format";
import { useConnections, type SavedNode } from "./connections";

/** `unauthorized`: the node rejected this device; only re-pairing can heal it. */
export type NodeSessionStatus =
  | "idle"
  | "connecting"
  | "online"
  | "offline"
  | "unauthorized";

export interface NodeConnection {
  node: SavedNode;
  tunnel: SecureTunnel;
  methods: string[];
}

export interface NodeSessionContextValue {
  status: NodeSessionStatus;
  /** Last connection problem (offline/pairing/device messages). */
  error: string | null;
  currentNode: SavedNode | null;
  /** Changes when the active node's transport identity changes. */
  nodeKey: string | null;
  /** Increments whenever in-memory conversation content must be dropped. */
  contentEpoch: number;
  /** RPC methods advertised by the active node (`ready.methods`). */
  methods: string[];
  connect: () => Promise<void>;
  probeNow: () => Promise<boolean>;
  /**
   * Runs one call on the active node; re-handshakes once on channel loss.
   * Streaming sends pass `{ retry: false }` so a mid-run disconnect never
   * replays the message.
   */
  request: <T>(
    invoke: (connection: NodeConnection) => Promise<T>,
    options?: { retry?: boolean },
  ) => Promise<T>;
  /**
   * Runs one call against a specific saved node without changing the active
   * node. Tunnels are shared and idle-closed by the pool.
   */
  requestForNode: <T>(
    node: SavedNode,
    invoke: (connection: NodeConnection) => Promise<T>,
    options?: { retry?: boolean },
  ) => Promise<T>;
  /** Marks the node offline when the failure looks like a transport problem. */
  reportRequestError: (error: unknown) => void;
}

const NodeSessionContext = createContext<NodeSessionContextValue | null>(null);

const HEALTH_INTERVAL_MS = 15_000;
/** Generous on purpose: a slow ack must not read as "the computer is gone". */
const HEALTH_TIMEOUT_MS = 10_000;
/** Automatic reconnect backoff; the cap keeps trying while the app is open. */
const RECOVERY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];
/**
 * Attempts the app makes before it admits the node is offline. Retries keep
 * running afterwards, so a brief outage heals without a manual tap.
 */
const OFFLINE_AFTER_FAILURES = 3;

const OFFLINE_MESSAGE =
  "电脑离线，请确认电脑端正在运行远程访问，并检查网络与节点地址。";
const RECONNECTING_MESSAGE = "连接中断，正在自动重连…";
const TICKET_MESSAGE =
  "配对票据无效或已过期，请在电脑端刷新配对二维码后重新扫码配对。";
const DEVICE_MESSAGE =
  "设备凭证已失效（可能已在电脑端被吊销或删除）。请删除节点后重新扫码配对。";
const NODE_KEY_MESSAGE =
  "这台节点的设备密钥已丢失，请删除后重新配对";

function sessionNodeKey(node: SavedNode | null): string | null {
  if (!node) return null;
  // The node identity is stable across LAN/public endpoints. Endpoint changes
  // must not discard in-memory conversation content.
  return `${node.id}|${node.nodeId}|${node.keyId}`;
}

/** `null` (web before the first event) counts as foreground. */
function inForeground(state: AppStateStatus | null): boolean {
  return state === null || state === "active";
}

function shouldRetryOnNewTunnel(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return (
    error.code === "TUNNEL_CLOSED" ||
    error.code === "TUNNEL_HEARTBEAT_TIMEOUT" ||
    error.code === "SOCKET_ERROR"
  );
}

export function NodeSessionProvider({ children }: { children: ReactNode }) {
  const { ready, currentNode, markNodeOnline, markNodeOffline, updateNodeSession } =
    useConnections();

  const [status, setStatus] = useState<NodeSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [contentEpoch, setContentEpoch] = useState(0);

  const nodeRef = useRef<SavedNode | null>(null);
  const statusRef = useRef<NodeSessionStatus>("idle");
  const epochRef = useRef(0);
  const appStateRef = useRef<AppStateStatus | null>(
    (AppState.currentState as AppStateStatus | null) ?? null,
  );
  /** Pending backoff timer for the automatic reconnect loop. */
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryAttemptRef = useRef(0);
  const recoveringRef = useRef(false);

  const nodeKey = useMemo(() => sessionNodeKey(currentNode), [currentNode]);

  useEffect(() => {
    nodeRef.current = currentNode;
  }, [currentNode]);

  const setStatusValue = useCallback((next: NodeSessionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const bumpEpoch = useCallback(() => {
    epochRef.current += 1;
    setContentEpoch(epochRef.current);
  }, []);

  const stopRecovery = useCallback(() => {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    recoveringRef.current = false;
    recoveryAttemptRef.current = 0;
  }, []);

  const markOfflineState = useCallback(
    (reason: string) => {
      const node = nodeRef.current;
      if (node) markNodeOffline(node.id);
      if (statusRef.current !== "offline") {
        setStatusValue("offline");
        // Conversation content is dropped on node switch and background, never
        // on a connectivity flap: the messages are still valid on the node.
      }
      setError(translate(reason));
      setMethods([]);
    },
    [markNodeOffline, setStatusValue],
  );

  /**
   * The node answered the secure handshake but refused this device's
   * credential. Reconnecting cannot heal that, so the retry loop stops and the
   * UI asks for a fresh pairing instead of claiming the computer is offline.
   */
  const markUnauthorizedState = useCallback(
    (reason: string) => {
      const node = nodeRef.current;
      if (node) markNodeOffline(node.id);
      stopRecovery();
      setStatusValue("unauthorized");
      setError(translate(reason));
      setMethods([]);
    },
    [markNodeOffline, setStatusValue, stopRecovery],
  );

  /** Records the authenticated device/session facts on the saved node. */
  const syncSession = useCallback(
    (node: SavedNode, tunnel: SecureTunnel): void => {
      const readyInfo = tunnel.ready;
      updateNodeSession(node.id, {
        deviceId: readyInfo.deviceId,
        methods: readyInfo.methods,
        baseUrl: tunnel.baseUrl,
        transport: tunnel.transport,
      });
      markNodeOnline(node.id);
      // Requests for other nodes (dashboard/drawer summaries) must not change
      // the active node's visible session state.
      if (nodeRef.current?.id !== node.id) return;
      setMethods(readyInfo.methods);
      setError(null);
      setStatusValue("online");
    },
    [markNodeOnline, setStatusValue, updateNodeSession],
  );

  const describeConnectionError = useCallback(
    (connectionError: unknown): string => {
      if (isTicketError(connectionError)) return translate(TICKET_MESSAGE);
      if (isDeviceAuthError(connectionError)) return translate(DEVICE_MESSAGE);
      if (
        connectionError instanceof ApiError &&
        connectionError.code === "DEVICE_KEY_MISSING"
      ) {
        return translate(NODE_KEY_MESSAGE);
      }
      if (isTransportError(connectionError)) return translate(OFFLINE_MESSAGE);
      if (isUnauthorizedError(connectionError)) return translate(DEVICE_MESSAGE);
      return describeError(connectionError);
    },
    [],
  );

  const openTunnel = useCallback(
    async (node: SavedNode, options: { force?: boolean } = {}): Promise<SecureTunnel> => {
      if (options.force) tunnels.closeNode(node);
      return tunnels.acquire(node);
    },
    [],
  );

  /** One heartbeat against the node; used to tell "slow" from "gone". */
  const channelAlive = useCallback(async (node: SavedNode): Promise<boolean> => {
    try {
      const tunnel = await tunnels.acquire(node);
      await tunnel.ping(HEALTH_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Keeps trying the node with backoff instead of dead-ending on the offline
   * card. Only repeated failures are reported as offline, and the loop keeps
   * running afterwards so a short outage heals on its own.
   *
   * `soft` means "we are not sure yet" (a request timed out): the active
   * session shows a reconnecting banner and keeps its content, while hard
   * failures keep whatever message the caller already set.
   */
  const beginRecovery = useCallback(
    (options: { soft?: boolean } = {}) => {
      if (!nodeRef.current) return;
      if (!inForeground(appStateRef.current)) return;
      if (recoveringRef.current) return;
      recoveringRef.current = true;
      if (options.soft) {
        if (statusRef.current === "online") setStatusValue("connecting");
        setError(translate(RECONNECTING_MESSAGE));
      }

      const schedule = (): void => {
        if (!nodeRef.current || !inForeground(appStateRef.current)) {
          stopRecovery();
          return;
        }
        const index = Math.min(
          recoveryAttemptRef.current,
          RECOVERY_DELAYS_MS.length - 1,
        );
        recoveryTimerRef.current = setTimeout(() => {
          recoveryTimerRef.current = null;
          void (async () => {
            const node = nodeRef.current;
            if (!node || !inForeground(appStateRef.current)) {
              stopRecovery();
              return;
            }
            try {
              const tunnel = await tunnels.connectAndPing(
                node,
                HEALTH_TIMEOUT_MS,
              );
              const isCurrent = nodeRef.current?.id === node.id;
              stopRecovery();
              syncSession(node, tunnel);
              if (isCurrent) setError(null);
            } catch (recoveryError) {
              recoveryAttemptRef.current += 1;
              if (isCredentialError(recoveryError)) {
                if (nodeRef.current?.id === node.id) {
                  markUnauthorizedState(
                    describeConnectionError(recoveryError),
                  );
                } else {
                  stopRecovery();
                }
                return;
              }
              if (
                recoveryAttemptRef.current >= OFFLINE_AFTER_FAILURES &&
                nodeRef.current?.id === node.id
              ) {
                markOfflineState(describeConnectionError(recoveryError));
              }
              schedule();
            }
          })();
        }, RECOVERY_DELAYS_MS[index]);
      };

      schedule();
    },
    [
      describeConnectionError,
      markOfflineState,
      markUnauthorizedState,
      setStatusValue,
      stopRecovery,
      syncSession,
    ],
  );

  /**
   * A dropped call only proves the call died. Heartbeat first: if the channel
   * still answers, the node is online (a large result may simply have been
   * dropped by the node) and the session state must not change.
   */
  const handleTransportFailure = useCallback(
    (failure: unknown) => {
      const node = nodeRef.current;
      if (!node) return;
      const channelLost =
        failure instanceof ApiError &&
        (failure.code === "TUNNEL_CLOSED" ||
          failure.code === "SOCKET_ERROR" ||
          failure.code === "TUNNEL_HEARTBEAT_TIMEOUT");
      if (channelLost) {
        beginRecovery({ soft: true });
        return;
      }
      void channelAlive(node).then((alive) => {
        if (!alive && nodeRef.current?.id === node.id) beginRecovery();
      });
    },
    [beginRecovery, channelAlive],
  );

  const invokeForNode = useCallback(
    async <T,>(
      node: SavedNode,
      invoke: (connection: NodeConnection) => Promise<T>,
      options: { retry?: boolean } = {},
    ): Promise<T> => {
      let tunnel: SecureTunnel;
      try {
        tunnel = await openTunnel(node);
      } catch (openError) {
        throw new ApiError(describeConnectionError(openError), {
          code:
            openError instanceof ApiError && openError.code
              ? openError.code
              : "TUNNEL_CLOSED",
          status: openError instanceof ApiError ? openError.status : undefined,
          data: openError,
        });
      }

      syncSession(node, tunnel);
      try {
        return await invoke({
          node,
          tunnel,
          methods: tunnel.methods,
        });
      } catch (firstError) {
        if (options.retry === false) throw firstError;
        if (!shouldRetryOnNewTunnel(firstError)) throw firstError;
        // The secure channel dropped (app resumed, network change, 24h rotation):
        // re-handshake once and replay the call.
        const retried = await openTunnel(node, { force: true });
        syncSession(node, retried);
        return invoke({
          node,
          tunnel: retried,
          methods: retried.methods,
        });
      }
    },
    [describeConnectionError, openTunnel, syncSession],
  );

  const requestForNode = useCallback(
    async <T,>(
      node: SavedNode,
      invoke: (connection: NodeConnection) => Promise<T>,
      options: { retry?: boolean } = {},
    ): Promise<T> => {
      try {
        return await invokeForNode(node, invoke, options);
      } catch (requestError) {
        if (isTransportError(requestError) || isCredentialError(requestError)) {
          markNodeOffline(node.id);
        }
        throw requestError;
      }
    },
    [invokeForNode, markNodeOffline],
  );

  const request = useCallback(
    async <T,>(
      invoke: (connection: NodeConnection) => Promise<T>,
      options: { retry?: boolean } = {},
    ): Promise<T> => {
      const node = nodeRef.current;
      if (!node) {
        throw new ApiError(translate("尚未选择节点"), { code: "NO_NODE" });
      }
      try {
        return await invokeForNode(node, invoke, options);
      } catch (requestError) {
        if (isTransportError(requestError)) handleTransportFailure(requestError);
        else if (isDeviceAuthError(requestError)) {
          markUnauthorizedState(DEVICE_MESSAGE);
        } else if (isUnauthorizedError(requestError)) {
          markOfflineState(TICKET_MESSAGE);
        }
        throw requestError;
      }
    },
    [handleTransportFailure, invokeForNode, markOfflineState, markUnauthorizedState],
  );

  const reportRequestError = useCallback(
    (requestError: unknown) => {
      if (isTransportError(requestError)) {
        handleTransportFailure(requestError);
        return;
      }
      if (isDeviceAuthError(requestError)) {
        markUnauthorizedState(DEVICE_MESSAGE);
        return;
      }
      if (isUnauthorizedError(requestError)) {
        markOfflineState(TICKET_MESSAGE);
      }
    },
    [handleTransportFailure, markOfflineState, markUnauthorizedState],
  );

  const connect = useCallback(async () => {
    const node = nodeRef.current;
    if (!node) return;
    stopRecovery();
    setStatusValue("connecting");
    try {
      const tunnel = await tunnels.connectAndPing(node, HEALTH_TIMEOUT_MS);
      if (nodeRef.current?.id !== node.id) return;
      syncSession(node, tunnel);
    } catch (connectError) {
      if (nodeRef.current?.id !== node.id) return;
      const message = describeConnectionError(connectError);
      if (isCredentialError(connectError)) {
        // Re-pairing is the only fix; keep the card honest instead of retrying.
        markUnauthorizedState(message);
        return;
      }
      markOfflineState(message);
      // Keep retrying in the background; the card clears by itself when the
      // computer answers again.
      beginRecovery();
    }
  }, [
    beginRecovery,
    describeConnectionError,
    markOfflineState,
    markUnauthorizedState,
    setStatusValue,
    stopRecovery,
    syncSession,
  ]);

  const probeNow = useCallback(async (): Promise<boolean> => {
    const node = nodeRef.current;
    if (!node) return false;
    stopRecovery();
    try {
      const tunnel = await tunnels.connectAndPing(node, HEALTH_TIMEOUT_MS);
      if (nodeRef.current?.id !== node.id) return false;
      syncSession(node, tunnel);
      return true;
    } catch (probeError) {
      if (nodeRef.current?.id === node.id) {
        const message = describeConnectionError(probeError);
        if (isCredentialError(probeError)) {
          markUnauthorizedState(message);
        } else {
          markOfflineState(message);
          beginRecovery();
        }
      }
      return false;
    }
  }, [
    beginRecovery,
    describeConnectionError,
    markOfflineState,
    markUnauthorizedState,
    stopRecovery,
    syncSession,
  ]);

  // Background: close every tunnel and drop in-memory conversation state.
  // SecureStore keeps the device key; returning to the foreground reconnects.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (next === "active") {
        if (nodeRef.current && previous !== "active") {
          void probeNow();
        }
        return;
      }
      if (previous === "active") {
        stopRecovery();
        tunnels.closeAll();
        setMethods([]);
        setError(null);
        setStatusValue("idle");
        bumpEpoch();
      }
    });
    return () => subscription.remove();
  }, [bumpEpoch, probeNow, setStatusValue, stopRecovery]);

  // Foreground heartbeat: keeps `ready.methods` and online state fresh without
  // any HTTP probe path. A miss starts the reconnect loop instead of pinning
  // the session to "offline" until the user taps the card.
  useEffect(() => {
    if (!ready || !nodeKey) return;
    const timer = setInterval(() => {
      if (appStateRef.current !== "active") return;
      const node = nodeRef.current;
      if (!node) return;
      if (statusRef.current !== "online") return;
      void (async () => {
        try {
          const tunnel = await tunnels.acquire(node);
          await tunnel.ping(HEALTH_TIMEOUT_MS);
          // Heartbeats keep `online` fresh but are not a new connection, so
          // they must not rewrite `lastConnectedAt`.
          if (nodeRef.current?.id === node.id) markNodeOnline(node.id, false);
        } catch {
          if (nodeRef.current?.id === node.id) beginRecovery({ soft: true });
        }
      })();
    }, HEALTH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [beginRecovery, markNodeOnline, nodeKey, ready]);

  // Node switch: drop previous tunnels and content, then reconnect.
  useEffect(() => {
    if (!ready) return;
    const node = nodeRef.current;
    stopRecovery();
    tunnels.closeAll();
    setMethods([]);
    setError(null);
    bumpEpoch();
    setStatusValue(node ? "connecting" : "idle");
    if (node) {
      void connect();
    }
    // `nodeKey` is the transport identity of the active node; refs hold state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, ready]);

  // Never leave a retry timer behind when the provider unmounts.
  useEffect(() => stopRecovery, [stopRecovery]);

  const value = useMemo<NodeSessionContextValue>(
    () => ({
      status,
      error,
      currentNode,
      nodeKey,
      contentEpoch,
      methods,
      connect,
      probeNow,
      request,
      requestForNode,
      reportRequestError,
    }),
    [
      connect,
      contentEpoch,
      currentNode,
      error,
      methods,
      nodeKey,
      probeNow,
      reportRequestError,
      request,
      requestForNode,
      status,
    ],
  );

  return (
    <NodeSessionContext.Provider value={value}>
      {children}
    </NodeSessionContext.Provider>
  );
}

export function useNodeSession(): NodeSessionContextValue {
  const context = useContext(NodeSessionContext);
  if (!context) {
    throw new Error("useNodeSession must be used inside NodeSessionProvider");
  }
  return context;
}