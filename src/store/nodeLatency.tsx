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

import { tunnels } from "../api/tunnel";
import { useConnections, type SavedNode } from "./connections";

/** Latest heartbeat reading for one saved node. */
export interface NodeLatencySample {
  /** Round trip in milliseconds, or null when the last attempt failed. */
  latencyMs: number | null;
  /** When the last attempt finished (`Date.now()`). */
  sampledAt: number;
}

interface NodeLatencyContextValue {
  /** Keyed by `SavedNode.id`; a missing entry means the node was not sampled. */
  latencies: Record<string, NodeLatencySample>;
}

const NodeLatencyContext = createContext<NodeLatencyContextValue | null>(null);

/** Matches the tunnel heartbeat, so sampling reuses the live tunnel. */
const SAMPLE_INTERVAL_MS = 20_000;
const SAMPLE_TIMEOUT_MS = 4_000;

function onlineAppState(state: AppStateStatus | null): boolean {
  // `unknown`/`null` (web before the first event) counts as foreground.
  return state !== "background" && state !== "inactive";
}

function nodeSignature(nodes: SavedNode[]): string {
  return nodes
    .map(
      (node) =>
        `${node.id}|${node.baseUrl}|${node.lanBaseUrl ?? ""}|${
          node.publicBaseUrl ?? ""
        }|${node.keyId}`,
    )
    .join(",");
}

/**
 * Samples every saved node's latency in the background.
 *
 * Readings are node-scoped connectivity metadata, not conversation content, so
 * they survive node switches and are refreshed on a fixed interval while the
 * app is in the foreground. Measurement goes through the secure tunnel's
 * heartbeat (`SecureTunnelPool.measureLatency`); there is no HTTP probe path.
 */
export function NodeLatencyProvider({ children }: { children: ReactNode }) {
  const { nodes } = useConnections();
  const [latencies, setLatencies] = useState<
    Record<string, NodeLatencySample>
  >({});

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const appStateRef = useRef<AppStateStatus | null>(
    (AppState.currentState as AppStateStatus | null) ?? null,
  );
  const inFlightRef = useRef<Set<string>>(new Set());
  /** Bumped when the app backgrounds so in-flight readings are discarded. */
  const epochRef = useRef(0);

  const sampleNode = useCallback(async (node: SavedNode) => {
    if (inFlightRef.current.has(node.id)) return;
    inFlightRef.current.add(node.id);
    const epoch = epochRef.current;
    const isCurrent = () =>
      epoch === epochRef.current &&
      onlineAppState(appStateRef.current) &&
      nodesRef.current.some((candidate) => candidate.id === node.id);
    try {
      const measured = await tunnels.measureLatency(node, SAMPLE_TIMEOUT_MS);
      if (!isCurrent()) return;
      setLatencies((previous) => ({
        ...previous,
        [node.id]: {
          // The heartbeat resolves on the next frame, which can land in the
          // same millisecond on a loopback LAN node.
          latencyMs: Math.max(1, Math.round(measured)),
          sampledAt: Date.now(),
        },
      }));
    } catch {
      if (!isCurrent()) return;
      setLatencies((previous) => ({
        ...previous,
        [node.id]: { latencyMs: null, sampledAt: Date.now() },
      }));
    } finally {
      inFlightRef.current.delete(node.id);
    }
  }, []);

  const sampleAll = useCallback(async () => {
    if (!onlineAppState(appStateRef.current)) return;
    const list = nodesRef.current;
    if (!list.length) return;
    await Promise.all(list.map(sampleNode));
  }, [sampleNode]);

  // Drop readings for removed nodes, then (re)start the background refresh.
  // The interval only restarts when a node's identity or endpoint changes, so
  // online/offline churn does not keep pushing the next sample back.
  const signature = useMemo(() => nodeSignature(nodes), [nodes]);

  useEffect(() => {
    const ids = new Set(nodesRef.current.map((node) => node.id));
    setLatencies((previous) => {
      const kept = Object.entries(previous).filter(([id]) => ids.has(id));
      if (kept.length === Object.keys(previous).length) return previous;
      return Object.fromEntries(kept);
    });
    if (!ids.size) return;
    void sampleAll();
    const timer = setInterval(() => {
      void sampleAll();
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [sampleAll, signature]);

  // Tunnels close when the app leaves the foreground, so old readings would be
  // stale on return: drop them and sample again as soon as the app is active.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      const wasOnline = onlineAppState(previous);
      const isOnline = onlineAppState(next);
      if (wasOnline && !isOnline) {
        epochRef.current += 1;
        inFlightRef.current.clear();
        setLatencies({});
        return;
      }
      if (!wasOnline && isOnline) void sampleAll();
    });
    return () => subscription.remove();
  }, [sampleAll]);

  const value = useMemo<NodeLatencyContextValue>(
    () => ({ latencies }),
    [latencies],
  );

  return (
    <NodeLatencyContext.Provider value={value}>
      {children}
    </NodeLatencyContext.Provider>
  );
}

export function useNodeLatency(): NodeLatencyContextValue {
  const context = useContext(NodeLatencyContext);
  if (!context) {
    throw new Error("useNodeLatency must be used inside NodeLatencyProvider");
  }
  return context;
}