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
  isDeviceAuthError,
  isTicketError,
  isTransportError,
  isUnauthorizedError,
} from "../api/client";
import { SecureTunnel, tunnels } from "../api/tunnel";
import { translate } from "../i18n";
import { describeError } from "../utils/format";
import { useConnections, type SavedNode } from "./connections";

export type NodeSessionStatus = "idle" | "connecting" | "online" | "offline";

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
const HEALTH_TIMEOUT_MS = 5_000;

const OFFLINE_MESSAGE =
  "电脑离线，请确认电脑端正在运行远程访问，并检查网络与节点地址。";
const TICKET_MESSAGE =
  "配对票据无效或已过期，请在电脑端刷新配对二维码后重新扫码配对。";
const DEVICE_MESSAGE =
  "电脑已拒绝这台设备（可能已被吊销），请删除节点后重新配对。";
const NODE_KEY_MESSAGE =
  "节点公钥缺失或已变化，请删除节点后重新扫码配对。";

function sessionNodeKey(node: SavedNode | null): string | null {
  if (!node) return null;
  // The node identity is stable across LAN/public endpoints. Endpoint changes
  // must not discard in-memory conversation content.
  return `${node.id}|${node.nodeId}|${node.keyId}`;
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

  const markOfflineState = useCallback(
    (reason: string) => {
      const node = nodeRef.current;
      if (node) markNodeOffline(node.id);
      if (statusRef.current !== "offline") {
        setStatusValue("offline");
        bumpEpoch();
      }
      setError(translate(reason));
      setMethods([]);
    },
    [bumpEpoch, markNodeOffline, setStatusValue],
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
        if (isTransportError(requestError)) markNodeOffline(node.id);
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
        if (isTransportError(requestError)) markOfflineState(OFFLINE_MESSAGE);
        else if (isDeviceAuthError(requestError)) markOfflineState(DEVICE_MESSAGE);
        else if (isUnauthorizedError(requestError)) markOfflineState(TICKET_MESSAGE);
        throw requestError;
      }
    },
    [invokeForNode, markOfflineState],
  );

  const reportRequestError = useCallback(
    (requestError: unknown) => {
      if (isTransportError(requestError)) {
        markOfflineState(OFFLINE_MESSAGE);
        return;
      }
      if (isDeviceAuthError(requestError)) {
        markOfflineState(DEVICE_MESSAGE);
        return;
      }
      if (isUnauthorizedError(requestError)) {
        markOfflineState(TICKET_MESSAGE);
      }
    },
    [markOfflineState],
  );

  const connect = useCallback(async () => {
    const node = nodeRef.current;
    if (!node) return;
    setStatusValue("connecting");
    try {
      const tunnel = await tunnels.connectAndPing(node, HEALTH_TIMEOUT_MS);
      if (nodeRef.current?.id !== node.id) return;
      syncSession(node, tunnel);
    } catch (connectError) {
      if (nodeRef.current?.id !== node.id) return;
      markOfflineState(describeConnectionError(connectError));
    }
  }, [describeConnectionError, markOfflineState, setStatusValue, syncSession]);

  const probeNow = useCallback(async (): Promise<boolean> => {
    const node = nodeRef.current;
    if (!node) return false;
    try {
      const tunnel = await tunnels.connectAndPing(node, HEALTH_TIMEOUT_MS);
      if (nodeRef.current?.id !== node.id) return false;
      syncSession(node, tunnel);
      return true;
    } catch (probeError) {
      if (nodeRef.current?.id === node.id) {
        markOfflineState(describeConnectionError(probeError));
      }
      return false;
    }
  }, [describeConnectionError, markOfflineState, syncSession]);

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
        tunnels.closeAll();
        setMethods([]);
        setError(null);
        setStatusValue("idle");
        bumpEpoch();
      }
    });
    return () => subscription.remove();
  }, [bumpEpoch, probeNow, setStatusValue]);

  // Foreground heartbeat: keeps `ready.methods` and online state fresh without
  // any HTTP probe path.
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
          if (nodeRef.current?.id === node.id) markNodeOnline(node.id);
        } catch {
          if (nodeRef.current?.id === node.id) {
            markOfflineState(OFFLINE_MESSAGE);
          }
        }
      })();
    }, HEALTH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [markNodeOnline, markOfflineState, nodeKey, ready]);

  // Node switch: drop previous tunnels and content, then reconnect.
  useEffect(() => {
    if (!ready) return;
    const node = nodeRef.current;
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