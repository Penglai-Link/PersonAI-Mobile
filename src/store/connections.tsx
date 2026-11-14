import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
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
import { Platform } from "react-native";

import { checkHealth, TRON_PRODUCT_CODE, TRON_PRODUCT_NAME } from "../api/tron";
import { isSecureBaseUrl, normalizeBaseUrl } from "../api/client";

const PRODUCTS_KEY = "@personai/products/v1";
const NODES_KEY = "@personai/nodes/v1";
const LEGACY_PRODUCTS_KEY = "@tron/products/v1";
const LEGACY_NODES_KEY = "@tron/nodes/v1";
const LEGACY_COMPUTERS_KEY = "@tron/connections/v1";
const LEGACY_CURRENT_KEY = "@tron/connections/current";
const TOKEN_PREFIX = "personai.token.";
const LEGACY_TOKEN_PREFIX = "tron.token.";
const WEB_TOKEN_PREFIX = "@personai/secure-token/";
const LEGACY_WEB_TOKEN_PREFIX = "@tron/secure-token/";

const PRODUCT_CODE_PATTERN = /^[a-z0-9.-]+$/;

export { TRON_PRODUCT_CODE, TRON_PRODUCT_NAME };

/** A product installed in the mobile client (built-in or user-added). */
export interface Product {
  code: string;
  name: string;
  builtIn: boolean;
  createdAt: string;
}

/** A remote node (a computer running one product) saved under a product. */
export interface SavedNode {
  id: string;
  productCode: string;
  /** `identity.nodeId` reported by the node; null for v1 nodes. */
  nodeId: string | null;
  name: string;
  baseUrl: string;
  /** Explicit insecure-debug confirmation for this node (http:// only). */
  allowInsecure: boolean;
  platform: string | null;
  version: string | null;
  username: string | null;
  displayName: string | null;
  /** null while the status probe is still running. */
  online: boolean | null;
  lastConnectedAt: string | null;
  createdAt: string;
}

export interface SaveNodeInput {
  productCode: string;
  name: string;
  baseUrl: string;
  pairingToken: string;
  allowInsecure: boolean;
  nodeId: string | null;
  platform?: string | null;
  version?: string | null;
  username?: string | null;
  displayName?: string | null;
}

interface NodeStatusOutcome {
  id: string;
  online: boolean;
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
  refreshNodeStatuses: () => Promise<void>;
  probing: boolean;
  markNodeOnline: (nodeId: string) => void;
  markNodeOffline: (nodeId: string) => void;
  getPairingToken: (nodeId: string) => Promise<string | null>;
}

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null);

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function storedTokenKey(nodeId: string): string {
  return `${TOKEN_PREFIX}${nodeId}`;
}

async function writeStoredToken(nodeId: string, token: string): Promise<void> {
  if (Platform.OS === "web") {
    // SecureStore has no web implementation. The web build is a preview target
    // only; keep functionality by falling back to AsyncStorage.
    await AsyncStorage.setItem(`${WEB_TOKEN_PREFIX}${nodeId}`, token);
    return;
  }
  await SecureStore.setItemAsync(storedTokenKey(nodeId), token);
}

export async function readStoredToken(nodeId: string): Promise<string | null> {
  if (Platform.OS === "web") {
    const value = await AsyncStorage.getItem(`${WEB_TOKEN_PREFIX}${nodeId}`);
    if (value) return value;
    const legacy = await AsyncStorage.getItem(`${LEGACY_WEB_TOKEN_PREFIX}${nodeId}`);
    if (legacy) {
      await AsyncStorage.setItem(`${WEB_TOKEN_PREFIX}${nodeId}`, legacy).catch(
        () => undefined,
      );
    }
    return legacy;
  }
  const value = await SecureStore.getItemAsync(storedTokenKey(nodeId));
  if (value) return value;
  const legacy = await SecureStore.getItemAsync(`${LEGACY_TOKEN_PREFIX}${nodeId}`);
  if (legacy) {
    await writeStoredToken(nodeId, legacy).catch(() => undefined);
  }
  return legacy;
}

async function deleteStoredToken(nodeId: string): Promise<void> {
  if (Platform.OS === "web") {
    await Promise.all([
      AsyncStorage.removeItem(`${WEB_TOKEN_PREFIX}${nodeId}`),
      AsyncStorage.removeItem(`${LEGACY_WEB_TOKEN_PREFIX}${nodeId}`),
    ]);
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(storedTokenKey(nodeId)),
    SecureStore.deleteItemAsync(`${LEGACY_TOKEN_PREFIX}${nodeId}`),
  ]);
}

function builtInTronProduct(): Product {
  return {
    code: TRON_PRODUCT_CODE,
    name: TRON_PRODUCT_NAME,
    builtIn: true,
    createdAt: new Date(0).toISOString(),
  };
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
  if (!raw) return [builtInTronProduct()];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const stored = parsed.filter(isProduct).map((product) => ({
      ...product,
      code: product.code.trim().toLowerCase(),
    }));
    // The built-in Tron product always exists and is never deletable.
    if (!stored.some((product) => product.code === TRON_PRODUCT_CODE)) {
      return [builtInTronProduct(), ...stored];
    }
    return stored.map((product) =>
      product.code === TRON_PRODUCT_CODE
        ? { ...product, builtIn: true, name: TRON_PRODUCT_NAME }
        : product,
    );
  } catch {
    return [builtInTronProduct()];
  }
}

function isSavedNode(value: unknown): value is SavedNode {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.baseUrl === "string" &&
    typeof record.productCode === "string" &&
    typeof record.createdAt === "string"
  );
}

function parseStoredNodes(raw: string | null): SavedNode[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedNode).map((node) => ({
      ...node,
      productCode: node.productCode.trim().toLowerCase(),
      nodeId: typeof node.nodeId === "string" ? node.nodeId : null,
      allowInsecure: node.allowInsecure === true,
      platform: typeof node.platform === "string" ? node.platform : null,
      version: typeof node.version === "string" ? node.version : null,
      username: typeof node.username === "string" ? node.username : null,
      displayName: typeof node.displayName === "string" ? node.displayName : null,
      lastConnectedAt:
        typeof node.lastConnectedAt === "string" ? node.lastConnectedAt : null,
      online: null,
    }));
  } catch {
    return [];
  }
}

interface LegacyComputer {
  id: string;
  name: string;
  baseUrl: string;
  platform: string | null;
  version: string | null;
  username: string | null;
  displayName: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
}

function parseLegacyComputers(raw: string | null): LegacyComputer[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => {
        return (
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Record<string, unknown>).id === "string" &&
          typeof (entry as Record<string, unknown>).name === "string" &&
          typeof (entry as Record<string, unknown>).baseUrl === "string"
        );
      })
      .map((entry) => ({
        id: entry.id as string,
        name: entry.name as string,
        baseUrl: entry.baseUrl as string,
        platform: typeof entry.platform === "string" ? entry.platform : null,
        version: typeof entry.version === "string" ? entry.version : null,
        username: typeof entry.username === "string" ? entry.username : null,
        displayName:
          typeof entry.displayName === "string" ? entry.displayName : null,
        lastConnectedAt:
          typeof entry.lastConnectedAt === "string"
            ? entry.lastConnectedAt
            : null,
        createdAt:
          typeof entry.createdAt === "string"
            ? entry.createdAt
            : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function normalizeProductCode(value: string): string {
  return value.trim().toLowerCase();
}

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([builtInTronProduct()]);
  const [nodes, setNodes] = useState<SavedNode[]>([]);
  const [currentProductCode, setCurrentProductCode] = useState<string | null>(
    null,
  );
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [probing, setProbing] = useState(false);

  const productsRef = useRef<Product[]>([builtInTronProduct()]);
  const nodesRef = useRef<SavedNode[]>([]);
  const currentNodeIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const probingRef = useRef(false);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    currentNodeIdRef.current = currentNodeId;
  }, [currentNodeId]);

  const probeNodes = useCallback(async (list: SavedNode[]) => {
    if (!list.length) return;
    if (probingRef.current) return;
    probingRef.current = true;
    setProbing(true);
    try {
      const outcomes = await Promise.all<NodeStatusOutcome>(
        list.map(async (node): Promise<NodeStatusOutcome> => {
          // Never send requests to a node that is not explicitly allowed over
          // plain HTTP; report it as offline instead.
          if (!isSecureBaseUrl(node.baseUrl) && !node.allowInsecure) {
            return { id: node.id, online: false };
          }
          try {
            await checkHealth({ baseUrl: node.baseUrl, timeoutMs: 4_000 });
            return { id: node.id, online: true };
          } catch {
            return { id: node.id, online: false };
          }
        }),
      );
      const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
      setNodes((previous) => {
        const next = previous.map((node) => {
          const outcome = outcomeById.get(node.id);
          return outcome ? { ...node, online: outcome.online } : node;
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
        // Migrate data written before the app was renamed to PersonAI Mobile.
        const rawProducts =
          newProducts ?? (await AsyncStorage.getItem(LEGACY_PRODUCTS_KEY));
        const rawNodes = newNodes ?? (await AsyncStorage.getItem(LEGACY_NODES_KEY));
        if (cancelled) return;

        if (!rawProducts && !rawNodes) {
          // Migrate the v1 single-list app (Tron-only computers) into nodes.
          const legacyRaw = await AsyncStorage.getItem(LEGACY_COMPUTERS_KEY);
          if (cancelled) return;
          const legacy = parseLegacyComputers(legacyRaw);
          if (legacy.length) {
            const migrated: SavedNode[] = legacy.map((computer) => ({
              id: computer.id,
              productCode: TRON_PRODUCT_CODE,
              nodeId: null,
              name: computer.name,
              baseUrl: computer.baseUrl,
              allowInsecure: !isSecureBaseUrl(computer.baseUrl),
              platform: computer.platform,
              version: computer.version,
              username: computer.username,
              displayName: computer.displayName,
              online: null,
              lastConnectedAt: computer.lastConnectedAt,
              createdAt: computer.createdAt,
            }));
            productsRef.current = [builtInTronProduct()];
            nodesRef.current = migrated;
            setProducts(productsRef.current);
            setNodes(migrated);
            hydratedRef.current = true;
            setReady(true);
            await Promise.all([
              AsyncStorage.setItem(
                PRODUCTS_KEY,
                JSON.stringify(productsRef.current),
              ),
              AsyncStorage.setItem(NODES_KEY, JSON.stringify(migrated)),
              AsyncStorage.removeItem(LEGACY_COMPUTERS_KEY),
              AsyncStorage.removeItem(LEGACY_CURRENT_KEY),
            ]).catch(() => undefined);
            void probeNodes(migrated);
            return;
          }
        }

        const storedProducts = parseStoredProducts(rawProducts);
        const storedNodes = parseStoredNodes(rawNodes);
        productsRef.current = storedProducts;
        nodesRef.current = storedNodes;
        setProducts(storedProducts);
        setNodes(storedNodes);
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
  }, [probeNodes]);

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
      if (!code) throw new Error("请输入产品编码");
      if (!PRODUCT_CODE_PATTERN.test(code)) {
        throw new Error("产品编码只能包含小写字母、数字、点和连字符");
      }
      if (!name) throw new Error("请输入产品显示名");
      if (name.length > 60) throw new Error("产品显示名不能超过 60 个字符");
      if (productsRef.current.some((product) => product.code === code)) {
        throw new Error("该产品编码已存在");
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
    if (normalized === TRON_PRODUCT_CODE) {
      throw new Error("内置 Tron 产品不能删除");
    }
    const affected = nodesRef.current.filter(
      (node) => node.productCode === normalized,
    );
    await Promise.all(affected.map((node) => deleteStoredToken(node.id))).catch(
      () => undefined,
    );

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

  const saveNode = useCallback(
    async (input: SaveNodeInput): Promise<SavedNode> => {
      const productCode = normalizeProductCode(input.productCode);
      if (
        !productsRef.current.some((product) => product.code === productCode)
      ) {
        throw new Error("目标产品不存在");
      }
      const baseUrl = normalizeBaseUrl(input.baseUrl);
      const pairingToken = input.pairingToken.trim();
      if (!pairingToken) throw new Error("配对令牌不能为空");
      if (!isSecureBaseUrl(baseUrl) && !input.allowInsecure) {
        throw new Error("非 HTTPS 地址需要显式开启不安全调试");
      }

      const existing = nodesRef.current.find(
        (node) =>
          node.productCode === productCode &&
          (input.nodeId
            ? node.nodeId === input.nodeId
            : node.baseUrl === baseUrl),
      );
      const now = new Date().toISOString();
      const id = existing?.id ?? createId("node");
      const node: SavedNode = {
        id,
        productCode,
        nodeId: input.nodeId ?? existing?.nodeId ?? null,
        name: input.name.trim() || existing?.name || "Tron 电脑",
        baseUrl,
        allowInsecure: input.allowInsecure,
        platform: input.platform ?? existing?.platform ?? null,
        version: input.version ?? existing?.version ?? null,
        username: input.username ?? existing?.username ?? null,
        displayName: input.displayName ?? existing?.displayName ?? null,
        online: true,
        lastConnectedAt: now,
        createdAt: existing?.createdAt ?? now,
      };

      await writeStoredToken(id, pairingToken);

      const next = existing
        ? nodesRef.current.map((item) => (item.id === id ? node : item))
        : [...nodesRef.current, node];
      nodesRef.current = next;
      setNodes(next);
      return node;
    },
    [],
  );

  const removeNode = useCallback(async (nodeId: string) => {
    await deleteStoredToken(nodeId).catch(() => undefined);
    const next = nodesRef.current.filter((node) => node.id !== nodeId);
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

  const getPairingToken = useCallback(async (nodeId: string) => {
    try {
      return await readStoredToken(nodeId);
    } catch {
      return null;
    }
  }, []);

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
      refreshNodeStatuses,
      probing,
      markNodeOnline,
      markNodeOffline,
      getPairingToken,
    }),
    [
      addProduct,
      currentNode,
      currentProductCode,
      getPairingToken,
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