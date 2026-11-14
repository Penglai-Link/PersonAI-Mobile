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

import { translate } from "../i18n";

import {
  ApiError,
  SecurityError,
  TimeoutError,
  assertTransportAllowed,
  isSecureBaseUrl,
  isTransportError,
  isUnauthorizedError,
} from "../api/client";
import {
  checkHealth,
  createRemoteSession,
  type RemoteIdentity,
} from "../api/tron";
import { describeError } from "../utils/format";
import { useConnections, type SavedNode } from "./connections";

export type NodeSessionStatus = "idle" | "connecting" | "online" | "offline";

export interface NodeConnection {
  baseUrl: string;
  token: string;
  node: SavedNode;
}

export interface NodeSessionContextValue {
  status: NodeSessionStatus;
  /** Last connection problem (offline/security/pairing-token messages). */
  error: string | null;
  identity: RemoteIdentity | null;
  currentNode: SavedNode | null;
  /** Changes when the active node changes (id/address/security flag). */
  nodeKey: string | null;
  /** Increments whenever in-memory conversations must be dropped. */
  contentEpoch: number;
  accessToken: string | null;
  connect: () => Promise<void>;
  probeNow: () => Promise<boolean>;
  ensureAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string>;
  /** Runs an authenticated call; refreshes the JWT once on HTTP 401. */
  request: <T>(invoke: (connection: NodeConnection) => Promise<T>) => Promise<T>;
  /**
   * Runs an authenticated call against a specific saved node without changing
   * the active node. The short-lived JWT is cached in memory per node.
   */
  requestForNode: <T>(
    node: SavedNode,
    invoke: (connection: NodeConnection) => Promise<T>,
  ) => Promise<T>;
  /** Marks the node offline when the failure looks like a transport problem. */
  reportRequestError: (error: unknown) => void;
}

const NodeSessionContext = createContext<NodeSessionContextValue | null>(null);

const HEALTH_INTERVAL_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const OFFLINE_MESSAGE =
  "电脑离线，请确认电脑端 Tron 正在运行，并检查网络与节点地址。";
const SECURITY_MESSAGE =
  "出于安全考虑，已阻止通过非 HTTPS 地址连接该节点。若这是可信局域网中的调试环境，请删除节点并使用“不安全调试”重新配对。";
const TOKEN_EXPIRED_MESSAGE =
  "配对令牌无效或已过期，请在电脑端重新生成配对二维码后再试。";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

function nodeTokenKey(node: SavedNode): string {
  return `${node.id}|${node.baseUrl}|${node.allowInsecure ? 1 : 0}`;
}

export function NodeSessionProvider({ children }: { children: ReactNode }) {
  const {
    ready,
    currentNode,
    getPairingToken,
    markNodeOnline,
    markNodeOffline,
  } = useConnections();

  const [status, setStatus] = useState<NodeSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<RemoteIdentity | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [contentEpoch, setContentEpoch] = useState(0);

  const nodeRef = useRef<SavedNode | null>(null);
  const statusRef = useRef<NodeSessionStatus>("idle");
  const tokenRef = useRef<CachedToken | null>(null);
  const exchangingRef = useRef<Promise<string> | null>(null);
  const nodeTokensRef = useRef(new Map<string, CachedToken>());
  const nodeExchangesRef = useRef(new Map<string, Promise<string>>());
  const nodeTokenEpochRef = useRef(0);
  const epochRef = useRef(0);
  const appStateRef = useRef<AppStateStatus | null>((AppState.currentState as AppStateStatus | null) ?? null);

  // Identity of the active node; only transport-relevant fields participate so
  // online-status updates do not reset the session.
  const nodeKey = useMemo(
    () =>
      currentNode
        ? `${currentNode.id}|${currentNode.baseUrl}|${
            currentNode.allowInsecure ? 1 : 0
          }`
        : null,
    [currentNode],
  );

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

  const clearToken = useCallback(() => {
    tokenRef.current = null;
    setAccessToken(null);
    setIdentity(null);
  }, []);

  const markOfflineState = useCallback(
    (reason: string) => {
      const node = nodeRef.current;
      if (node) markNodeOffline(node.id);
      clearToken();
      if (statusRef.current !== "offline") {
        setStatusValue("offline");
        bumpEpoch();
      }
      setError(translate(reason));
    },
    [bumpEpoch, clearToken, markNodeOffline, setStatusValue],
  );

  const exchange = useCallback(
    async (options: { force?: boolean } = {}): Promise<string> => {
      const node = nodeRef.current;
      if (!node) {
        throw new ApiError(translate("尚未选择节点"), { code: "NO_NODE" });
      }
      const cached = tokenRef.current;
      if (
        !options.force &&
        cached &&
        cached.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS
      ) {
        return cached.accessToken;
      }
      if (exchangingRef.current) return exchangingRef.current;

      const promise = (async () => {
        assertTransportAllowed(node.baseUrl, node.allowInsecure);
        const pairingToken = await getPairingToken(node.id);
        if (!pairingToken) {
          throw new ApiError(
            translate("这台节点的配对令牌已丢失，请删除后重新配对"),
            { code: "PAIRING_TOKEN_MISSING" },
          );
        }
        const result = await createRemoteSession({
          baseUrl: node.baseUrl,
          pairingToken,
          timeoutMs: 12_000,
        });
        if (nodeRef.current?.id !== node.id) {
          throw new ApiError(translate("节点已切换"), { code: "NODE_CHANGED" });
        }
        tokenRef.current = {
          accessToken: result.accessToken,
          expiresAt: Date.now() + result.expiresIn * 1_000,
        };
        setAccessToken(result.accessToken);
        setIdentity(result.identity);
        setError(null);
        setStatusValue("online");
        markNodeOnline(node.id);
        return result.accessToken;
      })();

      exchangingRef.current = promise;
      try {
        return await promise;
      } catch (exchangeError) {
        const stillCurrent = nodeRef.current?.id === node.id;
        const switched =
          exchangeError instanceof ApiError &&
          exchangeError.code === "NODE_CHANGED";
        if (stillCurrent && !switched) {
          const reason =
            exchangeError instanceof SecurityError
              ? exchangeError.message
              : exchangeError instanceof ApiError &&
                  (exchangeError.status === 401 ||
                    exchangeError.status === 403)
                ? TOKEN_EXPIRED_MESSAGE
                : exchangeError instanceof TimeoutError
                  ? OFFLINE_MESSAGE
                  : describeError(exchangeError);
          markOfflineState(reason);
        }
        throw exchangeError;
      } finally {
        if (exchangingRef.current === promise) exchangingRef.current = null;
      }
    },
    [
      getPairingToken,
      markNodeOnline,
      markOfflineState,
      setStatusValue,
    ],
  );

  const exchangeForNode = useCallback(
    async (
      node: SavedNode,
      options: { force?: boolean } = {},
    ): Promise<string> => {
      const key = nodeTokenKey(node);
      const cached = nodeTokensRef.current.get(key);
      if (
        !options.force &&
        cached &&
        cached.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS
      ) {
        return cached.accessToken;
      }
      const pending = nodeExchangesRef.current.get(key);
      if (!options.force && pending) return pending;

      const epoch = nodeTokenEpochRef.current;
      const promise = (async () => {
        assertTransportAllowed(node.baseUrl, node.allowInsecure);
        const pairingToken = await getPairingToken(node.id);
        if (!pairingToken) {
          throw new ApiError(
            translate("这台节点的配对令牌已丢失，请删除后重新配对"),
            { code: "PAIRING_TOKEN_MISSING" },
          );
        }
        const result = await createRemoteSession({
          baseUrl: node.baseUrl,
          pairingToken,
          timeoutMs: 12_000,
        });
        if (epoch !== nodeTokenEpochRef.current) {
          throw new ApiError(translate("请求已取消"), { code: "ABORTED" });
        }
        nodeTokensRef.current.set(key, {
          accessToken: result.accessToken,
          expiresAt: Date.now() + result.expiresIn * 1_000,
        });
        markNodeOnline(node.id);
        return result.accessToken;
      })();

      nodeExchangesRef.current.set(key, promise);
      try {
        return await promise;
      } catch (exchangeError) {
        if (isTransportError(exchangeError)) markNodeOffline(node.id);
        throw exchangeError;
      } finally {
        if (nodeExchangesRef.current.get(key) === promise) {
          nodeExchangesRef.current.delete(key);
        }
      }
    },
    [getPairingToken, markNodeOffline, markNodeOnline],
  );

  const requestForNode = useCallback(
    async <T,>(
      node: SavedNode,
      invoke: (connection: NodeConnection) => Promise<T>,
    ): Promise<T> => {
      const key = nodeTokenKey(node);
      const token = await exchangeForNode(node);
      try {
        return await invoke({ baseUrl: node.baseUrl, token, node });
      } catch (firstError) {
        if (!isUnauthorizedError(firstError)) throw firstError;
        nodeTokensRef.current.delete(key);
        const secondToken = await exchangeForNode(node, { force: true });
        return invoke({ baseUrl: node.baseUrl, token: secondToken, node });
      }
    },
    [exchangeForNode],
  );

  const connect = useCallback(async () => {
    const node = nodeRef.current;
    if (!node) return;
    if (statusRef.current === "online" && tokenRef.current) return;
    setStatusValue("connecting");
    try {
      await exchange();
    } catch {
      // Offline/security state is already set by `exchange`.
    }
  }, [exchange, setStatusValue]);

  const probeNow = useCallback(async (): Promise<boolean> => {
    const node = nodeRef.current;
    if (!node) return false;
    if (!isSecureBaseUrl(node.baseUrl) && !node.allowInsecure) {
      markOfflineState(SECURITY_MESSAGE);
      return false;
    }
    try {
      await checkHealth({ baseUrl: node.baseUrl, timeoutMs: 5_000 });
    } catch {
      markOfflineState(OFFLINE_MESSAGE);
      return false;
    }
    if (nodeRef.current?.id !== node.id) return false;
    if (statusRef.current === "online" && tokenRef.current) {
      setError(null);
      markNodeOnline(node.id);
      return true;
    }
    try {
      await exchange();
      return statusRef.current === "online";
    } catch {
      return false;
    }
  }, [exchange, markNodeOnline, markOfflineState]);

  const ensureAccessToken = useCallback(async () => exchange(), [exchange]);
  const refreshAccessToken = useCallback(
    async () => exchange({ force: true }),
    [exchange],
  );

  const reportRequestError = useCallback(
    (requestError: unknown) => {
      if (requestError instanceof SecurityError) {
        markOfflineState(SECURITY_MESSAGE);
        return;
      }
      if (isTransportError(requestError)) {
        markOfflineState(OFFLINE_MESSAGE);
        return;
      }
      if (isUnauthorizedError(requestError)) {
        markOfflineState(TOKEN_EXPIRED_MESSAGE);
      }
    },
    [markOfflineState],
  );

  const request = useCallback(
    async <T,>(
      invoke: (connection: NodeConnection) => Promise<T>,
    ): Promise<T> => {
      const node = nodeRef.current;
      if (!node) {
        throw new ApiError(translate("尚未选择节点"), { code: "NO_NODE" });
      }
      const firstToken = await exchange();
      try {
        return await invoke({ baseUrl: node.baseUrl, token: firstToken, node });
      } catch (firstError) {
        if (isUnauthorizedError(firstError)) {
          // JWT expired or was revoked: exchange the pairing token once more.
          let secondToken: string;
          try {
            secondToken = await exchange({ force: true });
          } catch {
            throw firstError;
          }
          try {
            return await invoke({
              baseUrl: node.baseUrl,
              token: secondToken,
              node,
            });
          } catch (retryError) {
            reportRequestError(retryError);
            throw retryError;
          }
        }
        reportRequestError(firstError);
        throw firstError;
      }
    },
    [exchange, reportRequestError],
  );

  // Clear the in-memory JWT and visible conversation state when the app leaves
  // the foreground, then reconnect on return.
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
        clearToken();
        nodeTokenEpochRef.current += 1;
        nodeTokensRef.current.clear();
        nodeExchangesRef.current.clear();
        setStatusValue("idle");
        setError(null);
        bumpEpoch();
      }
    });
    return () => subscription.remove();
  }, [bumpEpoch, clearToken, probeNow, setStatusValue]);

  // Foreground health probe: every 15 seconds the node is re-checked; a failure
  // marks it offline immediately and bumps `contentEpoch` so screens drop data.
  useEffect(() => {
    if (!ready || !nodeKey) return;
    const timer = setInterval(() => {
      if (appStateRef.current !== "active") return;
      void probeNow();
    }, HEALTH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [nodeKey, probeNow, ready]);

  // Node switch: drop tokens and every screen's content, then reconnect.
  useEffect(() => {
    if (!ready) return;
    const node = nodeRef.current;
    clearToken();
    setError(null);
    bumpEpoch();
    setStatusValue(node ? "connecting" : "idle");
    if (node) {
      void connect();
    }
    // `nodeKey` is the identity of the active node; refs hold mutable state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, ready]);

  const value = useMemo<NodeSessionContextValue>(
    () => ({
      status,
      error,
      identity,
      currentNode,
      nodeKey,
      contentEpoch,
      accessToken,
      connect,
      probeNow,
      ensureAccessToken,
      refreshAccessToken,
      request,
      requestForNode,
      reportRequestError,
    }),
    [
      accessToken,
      connect,
      contentEpoch,
      currentNode,
      ensureAccessToken,
      error,
      identity,
      nodeKey,
      probeNow,
      refreshAccessToken,
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