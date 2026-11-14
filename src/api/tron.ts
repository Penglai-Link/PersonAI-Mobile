import { fetch as expoFetch } from "expo/fetch";

import {
  ApiError,
  StreamUnsupportedError,
  TimeoutError,
  buildTronHeaders,
  buildTronUrl,
  isRecord,
  readStreamError,
  requestTronJson,
} from "./client";
import { extractSseFrames, parseSseFrame, type SseFrame } from "./sse";

export const TRON_PRODUCT_CODE = "tron";
export const TRON_PRODUCT_NAME = "Tron";

export interface RemoteProfile {
  username: string;
  displayName: string;
}

/**
 * Remote node identity. Protocol v2 adds product/node metadata; v1 servers only
 * send the machine fields, so those are normalized with Tron defaults.
 */
export interface RemoteIdentity {
  protocolVersion: number;
  productCode: string;
  productName: string;
  nodeId: string | null;
  machineName: string;
  version: string;
  platform: string;
  baseUrl: string;
  profile: RemoteProfile | null;
}

export interface RemoteSessionResult {
  accessToken: string;
  expiresIn: number;
  identity: RemoteIdentity;
}

export interface SkinResources {
  background?: string | null;
  font?: string | null;
  css?: string | null;
}

export interface SkinVariants {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** Mirrors the backend `SkinVo` shape (`camelCase` JSON). */
export interface Skin {
  id: string;
  name: string;
  version: number;
  variants: SkinVariants;
  layout: Record<string, string>;
  resources: SkinResources;
}

export interface HealthInfo {
  status: string;
  service: string;
  version: string;
}

export interface Dude {
  dudeCode: string;
  agentCode: string;
  name: string;
  description: string;
  avatarId?: string | null;
  kind: string;
  enabled: boolean;
  isMain: boolean;
  heartbeatMinutes: number;
  updatedAt: number | string;
}

export interface WorkspaceOption {
  workspaceCode: string;
  label: string;
  name: string;
  description: string | null;
  parentWorkspaceCode: string | null;
  depth: number;
  status: string;
}

export interface ProjectRecord {
  projectCode: string;
  workspaceCode: string;
  name: string;
  updatedAt: string;
}

export type ChatMessageRole = "USER" | "ASSISTANT" | string;

export interface ChatSession {
  id: number | string;
  sessionCode: string;
  workspaceCode: string | null;
  projectCode?: string | null;
  directoryCode?: string | null;
  title: string;
  status: string;
  sourceType?: string | null;
  sourceCode?: string | null;
  agentCode?: string | null;
  lastRunCode?: string | null;
  lastRunStatus?: string | null;
  createdAt: string | number;
  updatedAt: string | number;
}

export interface ChatSessionGroup {
  taskCode?: string | null;
  taskTitle: string;
  sourceType?: string | null;
  sourceCode?: string | null;
  sessions: ChatSession[];
}

export interface ChatMessage {
  id: number | string;
  messageCode: string;
  sessionCode: string;
  runCode?: string | null;
  role: ChatMessageRole;
  channel: string;
  actor: string;
  content: string;
  attachments?: unknown[];
  createdAt: string | number;
}

export interface ChatSendResult {
  session?: ChatSession;
  messages: ChatMessage[];
  run?: Record<string, unknown>;
}

export interface TronConnection {
  /** HTTPS base URL of the remote node. */
  baseUrl: string;
  /** Short-lived JWT access token. */
  token: string;
}

interface ApiParams extends TronConnection {
  signal?: AbortSignal;
  dudeCode?: string | null;
  workspaceCode?: string | null;
}

function workspaceQuery(
  workspaceCode: string | null | undefined,
): { workspaceCode: string } | undefined {
  const trimmed = workspaceCode?.trim();
  return trimmed ? { workspaceCode: trimmed } : undefined;
}

function normalizeMessageList(value: unknown): ChatMessage[] {
  if (Array.isArray(value)) return value as ChatMessage[];
  if (isRecord(value) && Array.isArray(value.messages)) {
    return value.messages as ChatMessage[];
  }
  return [];
}

function requireChatSession(value: unknown, fallbackMessage: string): ChatSession {
  if (!isRecord(value) || typeof value.sessionCode !== "string") {
    throw new Error(fallbackMessage);
  }
  return value as unknown as ChatSession;
}

function normalizeChatSendResult(value: unknown): ChatSendResult {
  if (!isRecord(value)) return { messages: [] };
  return {
    session: isRecord(value.session)
      ? (value.session as unknown as ChatSession)
      : undefined,
    messages: Array.isArray(value.messages)
      ? (value.messages as ChatMessage[])
      : [],
    run: isRecord(value.run) ? value.run : undefined,
  };
}

function normalizeRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

function normalizeSkin(value: unknown): Skin | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }
  if (typeof value.name !== "string" || !value.name.trim()) return null;
  const variants = isRecord(value.variants) ? value.variants : {};
  const resources = isRecord(value.resources) ? value.resources : {};
  const resourcePath = (entry: unknown) =>
    typeof entry === "string" ? entry : null;
  return {
    id: value.id,
    name: value.name,
    version: typeof value.version === "number" ? value.version : 0,
    variants: {
      light: normalizeRecord(variants.light),
      dark: normalizeRecord(variants.dark),
    },
    layout: normalizeRecord(value.layout),
    resources: {
      background: resourcePath(resources.background),
      font: resourcePath(resources.font),
      css: resourcePath(resources.css),
    },
  };
}

/**
 * Normalizes the identity object from `POST /remote/session` or
 * `GET /remote/identity`. V1 nodes omit product/node metadata; those default to
 * the built-in Tron product and a null node id.
 */
export function normalizeIdentity(value: unknown): RemoteIdentity {
  if (!isRecord(value)) {
    throw new ApiError("电脑返回的 identity 信息不完整", {
      code: "INVALID_IDENTITY",
    });
  }
  const machineName =
    typeof value.machineName === "string" ? value.machineName.trim() : "";
  const nodeId = typeof value.nodeId === "string" && value.nodeId.trim()
    ? value.nodeId.trim()
    : null;
  if (!machineName && !nodeId) {
    throw new ApiError("电脑返回的 identity 信息不完整", {
      code: "INVALID_IDENTITY",
    });
  }
  const productCode =
    typeof value.productCode === "string" && value.productCode.trim()
      ? value.productCode.trim().toLowerCase()
      : TRON_PRODUCT_CODE;
  const productName =
    typeof value.productName === "string" && value.productName.trim()
      ? value.productName.trim()
      : productCode === TRON_PRODUCT_CODE
        ? TRON_PRODUCT_NAME
        : productCode;
  const profile = isRecord(value.profile)
    ? {
        username:
          typeof value.profile.username === "string"
            ? value.profile.username
            : "",
        displayName:
          typeof value.profile.displayName === "string"
            ? value.profile.displayName
            : "",
      }
    : null;

  return {
    protocolVersion:
      typeof value.protocolVersion === "number" ? value.protocolVersion : 1,
    productCode,
    productName,
    nodeId,
    machineName: machineName || nodeId || "Tron",
    version: typeof value.version === "string" ? value.version : "",
    platform: typeof value.platform === "string" ? value.platform : "",
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
    profile,
  };
}

/**
 * `POST /api/v1/remote/session` — exchanges the long-lived pairing token for a
 * short-lived JWT. The pairing token is only ever sent to this endpoint.
 */
export async function createRemoteSession(params: {
  baseUrl: string;
  pairingToken: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RemoteSessionResult> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.pairingToken,
    path: "/api/v1/remote/session",
    method: "POST",
    timeoutMs: params.timeoutMs ?? 12_000,
    signal: params.signal,
  });
  if (!isRecord(data)) {
    throw new ApiError("电脑没有返回有效的访问令牌", {
      code: "INVALID_SESSION",
    });
  }
  const accessToken =
    typeof data.accessToken === "string" ? data.accessToken.trim() : "";
  if (!accessToken) {
    throw new ApiError("电脑没有返回有效的访问令牌", {
      code: "INVALID_SESSION",
    });
  }
  const expiresIn =
    typeof data.expiresIn === "number" && data.expiresIn > 0
      ? data.expiresIn
      : 12 * 60 * 60;
  const identitySource = isRecord(data.identity) ? data.identity : data;
  return {
    accessToken,
    expiresIn,
    identity: normalizeIdentity(identitySource),
  };
}

/** `GET /api/v1/remote/identity` — requires a JWT access token. */
export async function fetchIdentity(
  params: ApiParams & { timeoutMs?: number },
): Promise<RemoteIdentity> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/remote/identity",
    timeoutMs: params.timeoutMs ?? 8_000,
    signal: params.signal,
  });
  return normalizeIdentity(data);
}

/** `GET /api/v1/health` — unauthenticated online probe. */
export async function checkHealth(params: {
  baseUrl: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HealthInfo> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    path: "/api/v1/health",
    timeoutMs: params.timeoutMs ?? 5_000,
    signal: params.signal,
  });
  if (!isRecord(data) || typeof data.status !== "string") {
    throw new ApiError("健康检查响应无效", { code: "INVALID_HEALTH" });
  }
  return {
    status: data.status,
    service: typeof data.service === "string" ? data.service : "tron-backend",
    version: typeof data.version === "string" ? data.version : "",
  };
}

/** `GET /api/v1/system/skins` — skins installed on the node. */
export async function listSkins(
  params: ApiParams & { timeoutMs?: number },
): Promise<Skin[]> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/system/skins",
    timeoutMs: params.timeoutMs ?? 12_000,
    signal: params.signal,
  });
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => normalizeSkin(entry))
    .filter((skin): skin is Skin => skin !== null);
}

/** `GET /api/v1/system/skins/active` — the node's currently active skin (read only). */
export async function getActiveSkin(
  params: ApiParams & { timeoutMs?: number },
): Promise<{ skin: Skin } | null> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/system/skins/active",
    timeoutMs: params.timeoutMs ?? 12_000,
    signal: params.signal,
  });
  if (!isRecord(data)) return null;
  const skin = normalizeSkin(data.skin);
  return skin ? { skin } : null;
}

export async function listDudes(
  params: ApiParams,
): Promise<Dude[]> {
  const data = await requestTronJson<Dude[]>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/dudes",
    query: workspaceQuery(params.workspaceCode),
    timeoutMs: 20_000,
    signal: params.signal,
  });
  return Array.isArray(data) ? data : [];
}

export async function createMainDudeSession(
  params: ApiParams,
): Promise<ChatSession> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/dudes/main/session",
    method: "POST",
    query: workspaceQuery(params.workspaceCode),
    body: {},
    timeoutMs: 45_000,
    signal: params.signal,
  });
  return requireChatSession(data, "电脑没有返回有效的 Dude 会话");
}

export async function createDudeSession(
  params: ApiParams & { dudeCode: string },
): Promise<ChatSession> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: `/api/v1/dudes/${encodeURIComponent(params.dudeCode)}/sessions`,
    method: "POST",
    query: workspaceQuery(params.workspaceCode),
    timeoutMs: 45_000,
    signal: params.signal,
  });
  return requireChatSession(data, "电脑没有返回有效的 Dude 会话");
}

export async function listWorkspaceOptions(
  params: ApiParams,
): Promise<WorkspaceOption[]> {
  const data = await requestTronJson<WorkspaceOption[]>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/admin/workspaces/options",
    query: workspaceQuery(params.workspaceCode),
    timeoutMs: 20_000,
    signal: params.signal,
  });
  return Array.isArray(data) ? data : [];
}

export async function listProjects(
  params: ApiParams & { workspaceCode: string },
): Promise<ProjectRecord[]> {
  const data = await requestTronJson<ProjectRecord[]>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/projects/list",
    method: "POST",
    query: workspaceQuery(params.workspaceCode),
    body: { workspaceCode: params.workspaceCode },
    timeoutMs: 20_000,
    signal: params.signal,
  });
  return Array.isArray(data) ? data : [];
}

export async function listSessionGroups(
  params: ApiParams & { workspaceCode: string },
): Promise<ChatSessionGroup[]> {
  const data = await requestTronJson<ChatSessionGroup[]>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/chats/session-groups",
    query: { workspaceCode: params.workspaceCode },
    timeoutMs: 20_000,
    signal: params.signal,
  });
  return Array.isArray(data) ? data : [];
}

export async function createChatSession(
  params: ApiParams & { workspaceCode: string },
): Promise<ChatSession> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: "/api/v1/chats/sessions",
    method: "POST",
    query: { workspaceCode: params.workspaceCode },
    body: { workspaceCode: params.workspaceCode },
    timeoutMs: 20_000,
    signal: params.signal,
  });
  return requireChatSession(data, "电脑没有返回有效的新会话");
}

export async function listChatMessages(
  params: ApiParams & { sessionCode: string; workspaceCode: string },
): Promise<ChatMessage[]> {
  const data = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: `/api/v1/chats/sessions/${encodeURIComponent(params.sessionCode)}/messages`,
    query: { workspaceCode: params.workspaceCode },
    dudeCode: params.dudeCode,
    timeoutMs: 20_000,
    signal: params.signal,
  });
  return normalizeMessageList(data);
}

function sendBody(
  content: string,
  workspaceCode: string,
): Record<string, unknown> {
  return {
    content,
    workspaceCode,
    agentCode: null,
    clientCapabilities: { userInputRequests: false },
  };
}

/** Non-streaming fallback: `POST /messages`. */
export async function sendChatMessage(
  params: ApiParams & {
    sessionCode: string;
    workspaceCode: string;
    content: string;
    dudeCode?: string | null;
  },
): Promise<ChatSendResult> {
  const raw = await requestTronJson<unknown>({
    baseUrl: params.baseUrl,
    token: params.token,
    path: `/api/v1/chats/sessions/${encodeURIComponent(params.sessionCode)}/messages`,
    method: "POST",
    query: { workspaceCode: params.workspaceCode },
    body: sendBody(params.content, params.workspaceCode),
    dudeCode: params.dudeCode,
    timeoutMs: 180_000,
    signal: params.signal,
  });
  return normalizeChatSendResult(raw);
}

export interface StreamChatParams extends ApiParams {
  sessionCode: string;
  workspaceCode: string;
  content: string;
  dudeCode?: string | null;
  onDelta?: (delta: string) => void;
}

/**
 * `POST /messages/stream` using expo/fetch's streaming body.
 * Parses AG-UI SSE frames and resolves with the RUN_FINISHED result.
 */
export async function sendChatMessageStream(
  params: StreamChatParams,
): Promise<ChatSendResult> {
  if (params.signal?.aborted) {
    throw new ApiError("请求已取消", { code: "ABORTED" });
  }
  const controller = new AbortController();
  let timedOut = false;
  let timedOutMessage = "回复超时，请稍后重试";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const armTimeout = (ms: number, message: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      timedOutMessage = message;
      controller.abort();
    }, ms);
  };

  const abortFromCaller = () => controller.abort();
  params.signal?.addEventListener("abort", abortFromCaller);
  armTimeout(60_000, "等待回复超时，请检查电脑连接");

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const url = buildTronUrl(
      params.baseUrl,
      `/api/v1/chats/sessions/${encodeURIComponent(params.sessionCode)}/messages/stream`,
      { workspaceCode: params.workspaceCode },
    );

    const response = await expoFetch(url, {
      method: "POST",
      headers: buildTronHeaders(params.token, {
        dudeCode: params.dudeCode,
        json: true,
      }),
      body: JSON.stringify(
        sendBody(params.content, params.workspaceCode),
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await readStreamError(response);
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new StreamUnsupportedError();
    }

    armTimeout(120_000, "流式回复长时间没有响应");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: ChatSendResult | null = null;

    const consumeFrame = (frame: SseFrame) => {
      let payload: unknown;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        return;
      }
      if (!isRecord(payload)) return;

      const type = (
        typeof payload.type === "string" ? payload.type : frame.event
      ).toUpperCase();

      if (type === "TEXT_MESSAGE_CONTENT") {
        if (typeof payload.delta === "string") {
          params.onDelta?.(payload.delta);
        }
        return;
      }
      if (type === "RUN_ERROR") {
        const message =
          typeof payload.message === "string" && payload.message.trim()
            ? payload.message
            : typeof payload.code === "string" && payload.code.trim()
              ? payload.code
              : "回复失败，请重试";
        throw new ApiError(message, {
          code:
            typeof payload.code === "string" ? payload.code : "RUN_ERROR",
        });
      }
      if (type === "RUN_FINISHED") {
        result = normalizeChatSendResult(payload.result);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        armTimeout(120_000, "流式回复长时间没有响应");
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = extractSseFrames(buffer);
        buffer = rest;
        frames.forEach(consumeFrame);
      }
    }

    buffer += decoder.decode();
    const tail = extractSseFrames(buffer);
    tail.frames.forEach(consumeFrame);
    const trailingFrame = parseSseFrame(tail.rest);
    if (trailingFrame) consumeFrame(trailingFrame);

    if (!result) {
      throw new Error("流式连接意外结束，请重试");
    }
    return result;
  } catch (error) {
    if (timedOut) throw new TimeoutError(timedOutMessage);
    if (params.signal?.aborted) {
      throw new ApiError("已停止接收回复", { code: "ABORTED" });
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    params.signal?.removeEventListener("abort", abortFromCaller);
    if (reader) {
      void reader.cancel().catch(() => undefined);
    }
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError("请求已取消", { code: "ABORTED" }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError("请求已取消", { code: "ABORTED" }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Polls the message list until an assistant reply appears after `afterCount`.
 * Used only by the non-streaming fallback path.
 */
export async function pollMessagesUntilAssistant(
  params: ApiParams & {
    sessionCode: string;
    workspaceCode: string;
    dudeCode?: string | null;
    afterCount: number;
    intervalMs?: number;
    timeoutMs?: number;
    onMessages?: (messages: ChatMessage[]) => void;
  },
): Promise<ChatMessage[]> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? 45_000;
  const intervalMs = params.intervalMs ?? 1_500;
  let latest: ChatMessage[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    await abortableDelay(intervalMs, params.signal);
    latest = await listChatMessages({
      baseUrl: params.baseUrl,
      token: params.token,
      sessionCode: params.sessionCode,
      workspaceCode: params.workspaceCode,
      dudeCode: params.dudeCode,
      signal: params.signal,
    });
    params.onMessages?.(latest);
    const hasReply = latest
      .slice(params.afterCount)
      .some(
        (message) =>
          message.role === "ASSISTANT" && message.content.trim().length > 0,
      );
    if (hasReply) return latest;
  }

  return latest;
}