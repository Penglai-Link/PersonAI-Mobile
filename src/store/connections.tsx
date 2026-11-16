import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  addNetworkStateListener,
  getNetworkStateAsync,
  NetworkStateType,
  type NetworkState,
} from "expo-network";
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

import {
  normalizeBaseUrl,
  transportForBaseUrl,
  type NodeTransport,
} from "../api/client";
import { deleteDeviceKey } from "../crypto/keys";
import {
  setTunnelNetworkKind,
  tunnels,
  type TunnelNetworkKind,
  type TunnelTarget,
} from "../api/tunnel";
import { TRON_PRODUCT_CODE, TRON_PRODUCT_NAME } from "../api/tron";
import { translate } from "../i18n";

const PRODUCTS_KEY = "@personai/products/v1";
const NODES_KEY = "@personai/nodes/v1";
const LEGACY_PRODUCTS_KEY = "@tron/products/v1";

const PRODUCT_CODE_PATTERN = /^[a-z0-9.-]+$/;

export { TRON_PRODUCT_CODE, TRON_PRODUCT_NAME };

/** A product installed in the mobile client (built-in or user-added). */
export interface Product {
  code: string;
  name: string;
  builtIn: boolean;
  createdAt: string;
}

/**
 * A paired remote node.
 *
 * The device private key for `nodeId` lives in SecureStore
 * (`personai.devicekey.<nodeId>`); everything else is stored in AsyncStorage.
 */
export interface SavedNode extends TunnelTarget {
  id: string;
  name: string;
  /** `https` -> public (WSS), `http` -> LAN (WS). */
  transport: NodeTransport;
  /** LAN endpoint from the pairing QR; preferred when reachable. */
  lanBaseUrl?: string | null;
  /** Public endpoint from the pairing QR; fallback when LAN is unreachable. */
  publicBaseUrl?: string | null;
  /** `ready.methods` from the last successful authentication. */
  methods: string[];
  platform: string | null;
  version: string | null;
  /** null while the status probe is still running. */
  online: boolean | null;
  lastConnectedAt: string | null;
  createdAt: string;
}

export interface SaveNodeInput {
  productCode: string;
  name: string;
  baseUrl: string;
  lanBaseUrl?: string | null;
  publicBaseUrl?: string | null;
  nodeId: string;
  nodeKey: string;
  keyId: string;
  deviceId: string;
  methods: string[];
  platform?: string | null;
  version?: string | null;
}

interface ConnectionsContextValue {
  ready: boolean;
  products: Product[];
  nodes: SavedNode[];
  currentProductCode: string | null;
  currentNode: SavedNode | null;
  selectProduct: (productCode: string) => void;
  addProduct: (input: { code: string; name: string }) => Product;
  removeProduct: (productCode: string) => Promise<void>;
  selectNode: (node: SavedNode) => void;
  saveNode: (input: SaveNodeInput) => Promise<SavedNode>;
  removeNode: (nodeId: string) => Promise<void>;
  /** Persists `deviceId`/`methods` after a (re)authentication. */
  updateNodeSession: (
    nodeId: string,
    patch: {
      deviceId?: string;
      methods?: string[];
      baseUrl?: string;
      transport?: NodeTransport;
    },
  ) => void;
  refreshNodeStatuses: () => Promise<void>;
  probing: boolean;
  markNodeOnline: (nodeId: string) => void;
  markNodeOffline: (nodeId: string) => void;
}

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null);

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const BUILT_IN_PRODUCT_DEFINITIONS: ReadonlyArray<{
  code: string;
  name: string;
}> = [
  { code: TRON_PRODUCT_CODE, name: TRON_PRODUCT_NAME },
  { code: "axiom-agent", name: "运维智能体" },
  { code: "novel-agent", name: "小说智能体" },
  { code: "git-deck", name: "GitDeck" },
];

function builtInProducts(): Product[] {
  const createdAt = new Date(0).toISOString();
  return BUILT_IN_PRODUCT_DEFINITIONS.map((definition) => ({
    ...definition,
    builtIn: true,
    createdAt,
  }));
}

function isProduct(value: unknown): value is Product {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.code === "string" &&
    typeof record.name === "string" &&
    typeof record.builtIn === "boolean" &&
    typeof record.createdAt === "string"
  );
}

function parseStoredProducts(raw: string | null): Product[] {
  if (!raw) return builtInProducts();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return builtInProducts();
    const stored = parsed.filter(isProduct).map((product) => ({
      ...product,
      code: product.code.trim().toLowerCase(),
    }));
    // Built-in products always exist with their canonical names and are never
    // deletable, even if the stored copy predates this definition.
    const builtIns = BUILT_IN_PRODUCT_DEFINITIONS.map((definition) => {
      const existing = stored.find((product) => product.code === definition.code);
      return {
        code: definition.code,
        name: definition.name,
        builtIn: true,
        createdAt: existing?.createdAt ?? new Date(0).toISOString(),
      };
    });
    const custom = stored.filter(
      (product) =>
        !BUILT_IN_PRODUCT_DEFINITIONS.some(
          (definition) => definition.code === product.code,
        ),
    );
    return [...builtIns, ...custom];
  } catch {
    return builtInProducts();
  }
}

/**
 * Only nodes that completed the new pairing flow are accepted. Records from the
 * old token/JWT flow cannot be migrated (they have no node/device key), so they
 * are dropped and must be re-paired by scanning a fresh QR code.
 */
function isSavedNode(value: unknown): value is SavedNode {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.baseUrl === "string" &&
    typeof record.productCode === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.nodeId === "string" &&
    record.nodeId.trim().length > 0 &&
    typeof record.nodeKey === "string" &&
    typeof record.keyId === "string" &&
    typeof record.deviceId === "string"
  );
}

function normalizeTransport(value: unknown, baseUrl: string): NodeTransport {
  if (value === "public" || value === "lan") return value;
  return transportForBaseUrl(baseUrl);
}

function parseStoredNodes(raw: string | null): SavedNode[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedNode).map((node) => {
      const baseUrl = normalizeBaseUrl(node.baseUrl);
      return {
        ...node,
        baseUrl,
        transport: normalizeTransport((node as { transport?: unknown }).transport, baseUrl),
        methods: Array.isArray(node.methods)
          ? node.methods.filter(
              (method): method is string => typeof method === "string",
            )
          : [],
        platform: typeof node.platform === "string" ? node.platform : null,
        version: typeof node.version === "string" ? node.version : null,
        online: null,
        lastConnectedAt:
          typeof node.lastConnectedAt === "string" ? node.lastConnectedAt : null,
      };
    });
  } catch {
    return [];
  }
}

function normalizeProductCode(value: string): string {
  return value.trim().toLowerCase();
}

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>(() => builtInProducts());
  const [nodes, setNodes] = useState<SavedNode[]>([]);
  const [currentProductCode, setCurrentProductCode] = useState<string | null>(
    null,
  );
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [probing, setProbing] = useState(false);

  const productsRef = useRef<Product[]>(builtInProducts());
  const nodesRef = useRef<SavedNode[]>([]);
  const currentNodeIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const probingRef = useRef(false);
  const networkRef = useRef<{
    connected: boolean;
    kind: TunnelNetworkKind;
  } | null>(null);
  const networkChangedRef = useRef(false);

  /**
   * Keeps the tunnel pool aware of the access network: LAN candidates cannot
   * work on cellular and must be re-evaluated after a handover. Returns true
   * when this is an actual transition rather than the initial state. Transient
   * UNKNOWN states are ignored so they cannot tear down a working tunnel.
   */
  const applyNetworkState = useCallback((state: NetworkState): boolean => {
    const connected = state.isConnected === true;
    const kind: TunnelNetworkKind = !connected
      ? "unknown"
      : state.type === NetworkStateType.CELLULAR
        ? "cellular"
        : "lan-capable";
    setTunnelNetworkKind(kind);
    const previous = networkRef.current;
    const changed =
      previous !== null &&
      (previous.connected !== connected ||
        (previous.kind !== "unknown" &&
          kind !== "unknown" &&
          previous.kind !== kind));
    networkRef.current = { connected, kind };
    return changed;
  }, []);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    currentNodeIdRef.current = currentNodeId;
  }, [currentNodeId]);

  // Online probe goes through the encrypted tunnel only (`ping`), never HTTP.
  const probeNodes = useCallback(async (list: SavedNode[]) => {
    if (!list.length) return;
    if (probingRef.current) return;
    probingRef.current = true;
    setProbing(true);
    try {
      const outcomes = await Promise.all(
        list.map(async (node) => {
          const endpoint = await tunnels.probeNode(node, 1_200);
          return { id: node.id, endpoint };
        }),
      );
      const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
      setNodes((previous) => {
        const next = previous.map((node) => {
          const outcome = outcomeById.get(node.id);
          if (!outcome) return node;
          return {
            ...node,
            online: outcome.endpoint !== null,
            baseUrl: outcome.endpoint?.baseUrl ?? node.baseUrl,
            transport: outcome.endpoint?.transport ?? node.transport,
          };
        });
        nodesRef.current = next;
        return next;
      });
    } finally {
      probingRef.current = false;
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [newProducts, newNodes] = await Promise.all([
          AsyncStorage.getItem(PRODUCTS_KEY),
          AsyncStorage.getItem(NODES_KEY),
        ]);
        if (cancelled) return;
        // Products were stored under the old app name; nodes are not migrated.
        const rawProducts =
          newProducts ?? (await AsyncStorage.getItem(LEGACY_PRODUCTS_KEY));
        if (cancelled) return;

        const storedProducts = parseStoredProducts(rawProducts);
        const storedNodes = parseStoredNodes(newNodes);
        productsRef.current = storedProducts;
        nodesRef.current = storedNodes;
        setProducts(storedProducts);
        setNodes(storedNodes);
        try {
          // Resolve the network kind before screens start loading so a cellular
          // phone does not spend the LAN connect timeout first.
          applyNetworkState(await getNetworkStateAsync());
        } catch {
          // Keep the unknown network kind; LAN is tried before public.
        }
        if (cancelled) return;
        hydratedRef.current = true;
        setReady(true);
        void probeNodes(storedNodes);
      } catch {
        if (!cancelled) {
          hydratedRef.current = true;
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyNetworkState, probeNodes]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void AsyncStorage.setItem(PRODUCTS_KEY, JSON.stringify(products)).catch(
      () => undefined,
    );
  }, [products]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const serializable = nodes.map((node) => ({ ...node, online: null }));
    void AsyncStorage.setItem(NODES_KEY, JSON.stringify(serializable)).catch(
      () => undefined,
    );
  }, [nodes]);

  const selectProduct = useCallback(
    (productCode: string) => {
      const normalized = normalizeProductCode(productCode);
      const exists = productsRef.current.some(
        (product) => product.code === normalized,
      );
      if (!exists) return;
      setCurrentProductCode(normalized);
      // Leaving the node list resets the active node (and its in-memory session).
      setCurrentNodeId(null);
    },
    [],
  );

  const addProduct = useCallback(
    (input: { code: string; name: string }): Product => {
      const code = normalizeProductCode(input.code);
      const name = input.name.trim();
      if (!code) throw new Error(translate("请输入产品编码"));
      if (!PRODUCT_CODE_PATTERN.test(code)) {
        throw new Error(
          translate("产品编码只能包含小写字母、数字、点和连字符"),
        );
      }
      if (!name) throw new Error(translate("请输入产品显示名"));
      if (name.length > 60)
        throw new Error(translate("产品显示名不能超过 60 个字符"));
      if (productsRef.current.some((product) => product.code === code)) {
        throw new Error(translate("该产品编码已存在"));
      }
      const product: Product = {
        code,
        name,
        builtIn: false,
        createdAt: new Date().toISOString(),
      };
      const next = [...productsRef.current, product];
      productsRef.current = next;
      setProducts(next);
      return product;
    },
    [],
  );

  const removeProduct = useCallback(async (productCode: string) => {
    const normalized = normalizeProductCode(productCode);
    const targetProduct = productsRef.current.find(
      (product) => product.code === normalized,
    );
    if (targetProduct?.builtIn) {
      throw new Error(translate("内置产品不能删除"));
    }
    const affected = nodesRef.current.filter(
      (node) => node.productCode === normalized,
    );
    await Promise.all(
      affected.map((node) =>
        Promise.all([deleteDeviceKey(node.nodeId), Promise.resolve(tunnels.closeNode(node))]),
      ),
    ).catch(() => undefined);

    const nextNodes = nodesRef.current.filter(
      (node) => node.productCode !== normalized,
    );
    nodesRef.current = nextNodes;
    setNodes(nextNodes);

    const nextProducts = productsRef.current.filter(
      (product) => product.code !== normalized,
    );
    productsRef.current = nextProducts;
    setProducts(nextProducts);

    setCurrentProductCode((previous) =>
      previous === normalized ? null : previous,
    );
    setCurrentNodeId((previous) => {
      if (!previous) return previous;
      return nextNodes.some((node) => node.id === previous) ? previous : null;
    });
  }, []);

  const selectNode = useCallback((node: SavedNode) => {
    const exists = nodesRef.current.some((item) => item.id === node.id);
    if (!exists) return;
    setCurrentProductCode(node.productCode);
    setCurrentNodeId(node.id);
  }, []);

  const existingLanBaseUrl = (input: SaveNodeInput): string | null => {
    const existing = nodesRef.current.find(
      (node) =>
        node.productCode === normalizeProductCode(input.productCode) &&
        node.nodeId === input.nodeId.trim(),
    );
    return existing?.lanBaseUrl ?? null;
  };
  const existingPublicBaseUrl = (input: SaveNodeInput): string | null => {
    const existing = nodesRef.current.find(
      (node) =>
        node.productCode === normalizeProductCode(input.productCode) &&
        node.nodeId === input.nodeId.trim(),
    );
    return existing?.publicBaseUrl ?? null;
  };

  const saveNode = useCallback(
    async (input: SaveNodeInput): Promise<SavedNode> => {
      const productCode = normalizeProductCode(input.productCode);
      if (
        !productsRef.current.some((product) => product.code === productCode)
      ) {
        throw new Error(translate("目标产品不存在"));
      }
      const baseUrl = normalizeBaseUrl(input.baseUrl);
      const transport = transportForBaseUrl(baseUrl);
      const lanBaseUrl = input.lanBaseUrl?.trim()
        ? normalizeBaseUrl(input.lanBaseUrl)
        : existingLanBaseUrl(input);
      const publicBaseUrl = input.publicBaseUrl?.trim()
        ? normalizeBaseUrl(input.publicBaseUrl)
        : existingPublicBaseUrl(input);
      if (!input.nodeId.trim()) throw new Error(translate("缺少节点 ID"));
      if (!input.nodeKey.trim()) throw new Error(translate("缺少节点公钥"));
      if (!input.keyId.trim()) throw new Error(translate("缺少节点公钥指纹"));
      if (!input.deviceId.trim()) throw new Error(translate("缺少设备标识"));

      const existing = nodesRef.current.find(
        (node) =>
          node.productCode === productCode && node.nodeId === input.nodeId,
      );
      const now = new Date().toISOString();
      const id = existing?.id ?? createId("node");
      const node: SavedNode = {
        id,
        productCode,
        nodeId: input.nodeId.trim(),
        name: input.name.trim() || existing?.name || translate("Tron 电脑"),
        baseUrl,
        transport,
        lanBaseUrl,
        publicBaseUrl,
        nodeKey: input.nodeKey.trim(),
        keyId: input.keyId.trim(),
        deviceId: input.deviceId.trim(),
        methods: input.methods.filter(
          (method): method is string => typeof method === "string",
        ),
        platform: input.platform ?? existing?.platform ?? null,
        version: input.version ?? existing?.version ?? null,
        online: true,
        lastConnectedAt: now,
        createdAt: existing?.createdAt ?? now,
      };

      const next = existing
        ? nodesRef.current.map((item) => (item.id === id ? node : item))
        : [...nodesRef.current, node];
      nodesRef.current = next;
      setNodes(next);
      return node;
    },
    [],
  );

  const updateNodeSession = useCallback(
    (nodeId: string, patch: { deviceId?: string; methods?: string[]; baseUrl?: string; transport?: NodeTransport }) => {
      setNodes((previous) => {
        let changed = false;
        const next = previous.map((node) => {
          if (node.id !== nodeId) return node;
          const deviceId = patch.deviceId?.trim() || node.deviceId;
          const methods = patch.methods ?? node.methods;
          const baseUrl = patch.baseUrl?.trim() || node.baseUrl;
          const transport = patch.transport ?? node.transport;
          if (
            deviceId === node.deviceId &&
            methods === node.methods &&
            baseUrl === node.baseUrl &&
            transport === node.transport
          ) {
            return node;
          }
          changed = true;
          return { ...node, deviceId, methods, baseUrl, transport };
        });
        if (!changed) return previous;
        nodesRef.current = next;
        return next;
      });
    },
    [],
  );

  const removeNode = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (node) {
      tunnels.closeNode(node);
      await deleteDeviceKey(node.nodeId).catch(() => undefined);
    }
    const next = nodesRef.current.filter((item) => item.id !== nodeId);
    nodesRef.current = next;
    setNodes(next);
    if (currentNodeIdRef.current === nodeId) {
      currentNodeIdRef.current = null;
      setCurrentNodeId(null);
    }
  }, []);

  const refreshNodeStatuses = useCallback(async () => {
    await probeNodes(nodesRef.current);
  }, [probeNodes]);

  const markNodeOnline = useCallback((nodeId: string) => {
    const now = new Date().toISOString();
    setNodes((previous) => {
      const next = previous.map((node) =>
        node.id === nodeId
          ? { ...node, online: true, lastConnectedAt: now }
          : node,
      );
      nodesRef.current = next;
      return next;
    });
  }, []);

  const markNodeOffline = useCallback((nodeId: string) => {
    setNodes((previous) => {
      const next = previous.map((node) =>
        node.id === nodeId ? { ...node, online: false } : node,
      );
      nodesRef.current = next;
      return next;
    });
  }, []);


  // Wi-Fi <-> cellular transitions should re-evaluate LAN first. Debounce the
  // native event because iOS can emit several state changes during a handover.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const subscription = addNetworkStateListener((state) => {
      if (disposed) return;
      if (applyNetworkState(state)) networkChangedRef.current = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!hydratedRef.current) return;
        const changed = networkChangedRef.current;
        networkChangedRef.current = false;
        if (!state.isConnected) {
          for (const node of nodesRef.current) markNodeOffline(node.id);
          return;
        }
        if (changed) {
          // The old sockets belong to the previous network. Drop them so the
          // re-probe can pick LAN (Wi-Fi) instead of reusing a public tunnel.
          tunnels.closeAll();
          tunnels.clearEndpointHints();
        }
        void probeNodes(nodesRef.current);
      }, 600);
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [applyNetworkState, markNodeOffline, probeNodes]);

  const currentNode = useMemo(
    () => nodes.find((node) => node.id === currentNodeId) ?? null,
    [currentNodeId, nodes],
  );

  const value = useMemo<ConnectionsContextValue>(
    () => ({
      ready,
      products,
      nodes,
      currentProductCode,
      currentNode,
      selectProduct,
      addProduct,
      removeProduct,
      selectNode,
      saveNode,
      removeNode,
      updateNodeSession,
      refreshNodeStatuses,
      probing,
      markNodeOnline,
      markNodeOffline,
    }),
    [
      addProduct,
      currentNode,
      currentProductCode,
      markNodeOffline,
      markNodeOnline,
      nodes,
      probing,
      products,
      ready,
      refreshNodeStatuses,
      removeNode,
      removeProduct,
      saveNode,
      selectNode,
      selectProduct,
      updateNodeSession,
    ],
  );

  return (
    <ConnectionsContext.Provider value={value}>
      {children}
    </ConnectionsContext.Provider>
  );
}

export function useConnections(): ConnectionsContextValue {
  const context = useContext(ConnectionsContext);
  if (!context) {
    throw new Error("useConnections must be used inside ConnectionsProvider");
  }
  return context;
}