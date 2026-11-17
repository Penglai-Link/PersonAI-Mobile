/**
 * Tron product RPC wrappers.
 *
 * `session.*` is the framework-defined generic chat contract (implemented in
 * `rpc.ts`); `tron.*` covers the Tron-specific catalog (workspaces, Dudes,
 * projects, directories, session groups, skins). Both travel over the same
 * encrypted tunnel — this module never performs HTTP requests.
 */
import {
  ApiError,
  isRecord,
  requestTronJson,
} from "./client";
import {
  SessionRpc,
  aguiRunError,
  aguiTextDelta,
  isRunFinished,
  type AgUiEvent,
  type SessionSummary,
} from "./rpc";
import type { SecureTunnel } from "./tunnel";
import { translate } from "../i18n";

export const TRON_PRODUCT_CODE = "tron";
export const TRON_PRODUCT_NAME = "Tron Harness";

/** Product-namespace RPC methods registered by `tron-remote-pack`. */
export const TRON_RPC_METHODS = {
  skinsList: "tron.skins.list",
  skinsActive: "tron.skins.active",
  dudesList: "tron.dudes.list",
  dudesMainSession: "tron.dudes.mainSession",
  dudesCreateSession: "tron.dudes.createSession",
  workspacesList: "tron.workspaces.list",
  projectsList: "tron.projects.list",
  directoriesList: "tron.directories.list",
  sessionGroups: "tron.session.groups",
  chatProtocolEvents: "tron.chat.protocolEvents",
  chatSteer: "tron.chat.steer",
  navigationMenus: "tron.navigation.menus",
} as const;

/** A chat sidebar widget defined by the product's navigation menu. */
export interface NavigationMenu {
  menuCode: string;
  label: string;
  /** `chat.projects`, `chat.directories`, `chat.recents`, ... */
  pageCode: string;
  icon: string | null;
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

export interface DirectoryRecord {
  directoryCode: string;
  workspaceCode: string;
  executionHost: string;
  path: string;
  name: string;
  parentDirectoryCode: string | null;
  available: boolean;
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
  /** A2UI envelopes, when the node presents a surface in this message. */
  a2ui?: { messages: unknown[]; surfaceIds?: string[] };
  createdAt: string | number;
}

export interface ChatSendResult {
  session?: ChatSession;
  messages: ChatMessage[];
  run?: Record<string, unknown>;
}

/** Business calls only need the secure tunnel; there is no token/URL pair. */
export interface TronConnection {
  tunnel: SecureTunnel;
}

interface ApiParams extends TronConnection {
  signal?: AbortSignal;
  dudeCode?: string | null;
  workspaceCode?: string | null;
}

function workspaceParam(
  workspaceCode: string | null | undefined,
): { workspaceCode: string } | undefined {
  const trimmed = workspaceCode?.trim();
  return trimmed ? { workspaceCode: trimmed } : undefined;
}

function scopeParam(
  params: ApiParams,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...workspaceParam(params.workspaceCode),
    ...(params.dudeCode?.trim() ? { dudeCode: params.dudeCode.trim() } : {}),
    ...extra,
  };
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readScalar(record: Record<string, unknown>, key: string): string | number | null {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function metadataOf(value: Record<string, unknown>): Record<string, unknown> {
  return isRecord(value.metadata) ? value.metadata : {};
}

/**
 * Normalizes a generic `SessionSummary` (protocol fields) into the Tron-shaped
 * `ChatSession` used by the screens. Tron packs may include extra fields either
 * directly or under `metadata`; generic packs only need `id/title/status`.
 */
export function normalizeChatSession(
  value: unknown,
  fallbackMessage: string,
): ChatSession {
  if (!isRecord(value)) {
    throw new ApiError(fallbackMessage, { code: "INVALID_SESSION" });
  }
  const metadata = metadataOf(value);
  const sessionCode = readString(value, "sessionCode") ?? readString(value, "id");
  if (!sessionCode) {
    throw new ApiError(fallbackMessage, { code: "INVALID_SESSION" });
  }
  const workspaceCode =
    readString(value, "workspaceCode") ??
    readString(metadata, "workspaceCode") ??
    readString(value, "workspace");
  const now = new Date().toISOString();
  return {
    id: readScalar(value, "id") ?? sessionCode,
    sessionCode,
    workspaceCode,
    projectCode: readString(value, "projectCode") ?? readString(metadata, "projectCode"),
    directoryCode:
      readString(value, "directoryCode") ?? readString(metadata, "directoryCode"),
    title: readString(value, "title") ?? "",
    status: readString(value, "status") ?? "",
    sourceType: readString(value, "sourceType") ?? readString(metadata, "sourceType"),
    sourceCode: readString(value, "sourceCode") ?? readString(metadata, "sourceCode"),
    agentCode: readString(value, "agentCode") ?? readString(metadata, "agentCode"),
    lastRunCode:
      readString(value, "lastRunCode") ?? readString(metadata, "lastRunCode"),
    lastRunStatus:
      readString(value, "lastRunStatus") ?? readString(metadata, "lastRunStatus"),
    createdAt: readScalar(value, "createdAt") ?? now,
    updatedAt: readScalar(value, "updatedAt") ?? now,
  };
}

function normalizeSessionMessage(
  value: unknown,
  sessionCode: string,
): ChatMessage | null {
  if (!isRecord(value)) return null;
  const id = readScalar(value, "id") ?? readString(value, "messageCode");
  if (id === null) return null;
  const metadata = metadataOf(value);
  const role = (readString(value, "role") ?? "USER").toUpperCase();
  return {
    id,
    messageCode:
      readString(value, "messageCode") ??
      readString(metadata, "messageCode") ??
      String(id),
    sessionCode:
      readString(value, "sessionCode") ??
      readString(metadata, "sessionCode") ??
      sessionCode,
    runCode:
      readString(value, "runCode") ??
      readString(value, "runId") ??
      readString(metadata, "runCode"),
    role,
    channel: readString(value, "channel") ?? "MAIN_AGENT",
    actor: readString(value, "actor") ?? (role === "USER" ? "user" : "assistant"),
    content: typeof value.content === "string" ? value.content : "",
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    createdAt: readScalar(value, "createdAt") ?? new Date().toISOString(),
  };
}

function messageListFrom(value: unknown, sessionCode: string): ChatMessage[] {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : [];
  return source
    .map((entry) => normalizeSessionMessage(entry, sessionCode))
    .filter((entry): entry is ChatMessage => entry !== null);
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

function normalizeDirectory(value: unknown): DirectoryRecord | null {
  if (!isRecord(value) || typeof value.directoryCode !== "string") return null;
  return {
    directoryCode: value.directoryCode,
    workspaceCode:
      typeof value.workspaceCode === "string" ? value.workspaceCode : "",
    executionHost:
      typeof value.executionHost === "string" ? value.executionHost : "",
    path: typeof value.path === "string" ? value.path : "",
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name
        : value.directoryCode,
    parentDirectoryCode:
      typeof value.parentDirectoryCode === "string"
        ? value.parentDirectoryCode
        : null,
    available: value.available !== false,
  };
}

function normalizeGroup(value: unknown): ChatSessionGroup | null {
  if (!isRecord(value)) return null;
  const sessions = Array.isArray(value.sessions)
    ? value.sessions
        .map((entry) => {
          try {
            return normalizeChatSession(entry, translate("会话数据无效"));
          } catch {
            return null;
          }
        })
        .filter((entry): entry is ChatSession => entry !== null)
    : [];
  return {
    taskCode: typeof value.taskCode === "string" ? value.taskCode : null,
    taskTitle:
      typeof value.taskTitle === "string" && value.taskTitle.trim()
        ? value.taskTitle
        : translate("会话"),
    sourceType: typeof value.sourceType === "string" ? value.sourceType : null,
    sourceCode: typeof value.sourceCode === "string" ? value.sourceCode : null,
    sessions,
  };
}

/* ------------------------------------------------------------------ */
/* Tron product methods                                                */
/* ------------------------------------------------------------------ */

async function callTron<T>(
  params: ApiParams,
  method: string,
  rpcParams?: unknown,
  timeoutMs = 20_000,
): Promise<T> {
  return requestTronJson<T>({
    tunnel: params.tunnel,
    method,
    params: rpcParams,
    signal: params.signal,
    timeoutMs,
  });
}

/**
 * `tron.navigation.menus` — the product's chat sidebar widgets. The client
 * renders these labels in order instead of hard-coding section names.
 */
export async function listNavigationMenus(
  params: ApiParams,
): Promise<NavigationMenu[]> {
  const data = await callTron<unknown>(
    params,
    TRON_RPC_METHODS.navigationMenus,
    workspaceParam(params.workspaceCode),
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((entry): NavigationMenu | null => {
      if (!isRecord(entry)) return null;
      const menuCode = readString(entry, "menuCode");
      const label = readString(entry, "label");
      const pageCode = readString(entry, "pageCode");
      if (!label || !pageCode) return null;
      return {
        menuCode: menuCode ?? pageCode,
        label,
        pageCode,
        icon: readString(entry, "icon"),
      };
    })
    .filter((menu): menu is NavigationMenu => menu !== null);
}

/** `tron.skins.list` — read-only skins installed on the node. */
export async function listSkins(
  params: ApiParams & { timeoutMs?: number },
): Promise<Skin[]> {
  const data = await requestTronJson<unknown>({
    tunnel: params.tunnel,
    method: TRON_RPC_METHODS.skinsList,
    params: workspaceParam(params.workspaceCode),
    timeoutMs: params.timeoutMs ?? 12_000,
    signal: params.signal,
  });
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => normalizeSkin(entry))
    .filter((skin): skin is Skin => skin !== null);
}

/** `tron.skins.active` — the node's currently active skin (read only). */
export async function getActiveSkin(
  params: ApiParams & { timeoutMs?: number },
): Promise<{ skin: Skin } | null> {
  const data = await requestTronJson<unknown>({
    tunnel: params.tunnel,
    method: TRON_RPC_METHODS.skinsActive,
    params: workspaceParam(params.workspaceCode),
    timeoutMs: params.timeoutMs ?? 12_000,
    signal: params.signal,
  });
  if (!isRecord(data)) return null;
  const skin = normalizeSkin(data.skin);
  return skin ? { skin } : null;
}

/** `tron.dudes.list` — Dudes available in the workspace. */
export async function listDudes(params: ApiParams): Promise<Dude[]> {
  const data = await callTron<Dude[]>(
    params,
    TRON_RPC_METHODS.dudesList,
    workspaceParam(params.workspaceCode),
  );
  return Array.isArray(data) ? data : [];
}

/** `tron.dudes.mainSession` — creates a session with the main Dude. */
export async function createMainDudeSession(
  params: ApiParams,
): Promise<ChatSession> {
  const data = await callTron<unknown>(
    params,
    TRON_RPC_METHODS.dudesMainSession,
    workspaceParam(params.workspaceCode),
    45_000,
  );
  return normalizeChatSession(data, translate("电脑没有返回有效的 Dude 会话"));
}

/** `tron.dudes.createSession` — creates a session for a specific Dude. */
export async function createDudeSession(
  params: ApiParams & { dudeCode: string },
): Promise<ChatSession> {
  const data = await callTron<unknown>(
    params,
    TRON_RPC_METHODS.dudesCreateSession,
    { dudeCode: params.dudeCode, ...workspaceParam(params.workspaceCode) },
    45_000,
  );
  return normalizeChatSession(data, translate("电脑没有返回有效的 Dude 会话"));
}

/** `tron.workspaces.list` — workspace options. */
export async function listWorkspaceOptions(
  params: ApiParams,
): Promise<WorkspaceOption[]> {
  const data = await callTron<WorkspaceOption[]>(
    params,
    TRON_RPC_METHODS.workspacesList,
    workspaceParam(params.workspaceCode),
  );
  return Array.isArray(data) ? data : [];
}

/** `tron.projects.list` — projects in a workspace. */
export async function listProjects(
  params: ApiParams & { workspaceCode: string },
): Promise<ProjectRecord[]> {
  const data = await callTron<ProjectRecord[]>(
    params,
    TRON_RPC_METHODS.projectsList,
    { workspaceCode: params.workspaceCode },
  );
  return Array.isArray(data) ? data : [];
}

/** `tron.directories.list` — registered directories in a workspace. */
export async function listDirectories(
  params: ApiParams & { workspaceCode: string },
): Promise<DirectoryRecord[]> {
  const data = await callTron<unknown>(
    params,
    TRON_RPC_METHODS.directoriesList,
    { workspaceCode: params.workspaceCode },
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => normalizeDirectory(entry))
    .filter((entry): entry is DirectoryRecord => entry !== null);
}

/** `tron.session.groups` — Tron's topic/directory/chats grouping. */
export async function listSessionGroups(
  params: ApiParams & { workspaceCode: string },
): Promise<ChatSessionGroup[]> {
  const data = await callTron<unknown>(
    params,
    TRON_RPC_METHODS.sessionGroups,
    { workspaceCode: params.workspaceCode },
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => normalizeGroup(entry))
    .filter((entry): entry is ChatSessionGroup => entry !== null);
}

/** `tron.chat.protocolEvents` — replay of AG-UI events for one session. */
export async function listChatProtocolEvents(
  params: ApiParams & { sessionCode: string },
): Promise<AgUiEvent[]> {
  const data = await callTron<unknown>(
    params,
    TRON_RPC_METHODS.chatProtocolEvents,
    scopeParam(params, { sessionCode: params.sessionCode }),
    20_000,
  );
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => entry as AgUiEvent);
}

/** `tron.chat.steer` — inserts guidance into the active run. */
export async function steerChatMessage(
  params: ApiParams & { sessionCode: string; runId: string; content: string },
): Promise<ChatMessage | null> {
  const data = await callTron<unknown>(
    params,
    TRON_RPC_METHODS.chatSteer,
    scopeParam(params, {
      sessionCode: params.sessionCode,
      runId: params.runId,
      content: params.content,
    }),
    20_000,
  );
  if (!isRecord(data)) return null;
  return normalizeSessionMessage(data.message, params.sessionCode);
}

/* ------------------------------------------------------------------ */
/* Generic session.* methods (used by the chat screen)                 */
/* ------------------------------------------------------------------ */

/** `session.create` — starts a new chat session. */
export async function createChatSession(
  params: ApiParams & { workspaceCode: string },
): Promise<ChatSession> {
  const rpc = new SessionRpc(params.tunnel);
  const summary: SessionSummary = await rpc.create(
    {
      workspace: params.workspaceCode,
      metadata: { workspaceCode: params.workspaceCode },
    },
    { signal: params.signal, timeoutMs: 20_000 },
  );
  return normalizeChatSession(summary, translate("电脑没有返回有效的新会话"));
}

/** `session.history` — messages of one session. */
export async function listChatMessages(
  params: ApiParams & { sessionCode: string; workspaceCode?: string },
): Promise<ChatMessage[]> {
  const rpc = new SessionRpc(params.tunnel);
  const result = await rpc.history(
    {
      sessionId: params.sessionCode,
      limit: 200,
      metadata: params.dudeCode ? { dudeCode: params.dudeCode } : undefined,
    },
    { signal: params.signal, timeoutMs: 20_000 },
  );
  const source = isRecord(result) ? result.messages : result;
  return messageListFrom(source, params.sessionCode);
}

/** `session.stopRun` — cancels the active run (optionally one specific run). */
export async function stopChatRun(
  params: ApiParams & { sessionCode: string; runId?: string | null },
): Promise<boolean> {
  const rpc = new SessionRpc(params.tunnel);
  const result = await rpc.stopRun(
    {
      sessionId: params.sessionCode,
      runId: params.runId ?? null,
      metadata: params.dudeCode ? { dudeCode: params.dudeCode } : undefined,
    },
    { signal: params.signal, timeoutMs: 15_000 },
  );
  return result?.cancelled === true;
}

export interface StreamChatParams extends ApiParams {
  sessionCode: string;
  workspaceCode?: string;
  content: string;
  onDelta?: (delta: string) => void;
  /** Every AG-UI event of the run, including tool and reasoning events. */
  onEvent?: (event: AgUiEvent) => void;
}

/**
 * `session.sendMessage` — starts a run and streams AG-UI events back through the
 * tunnel. The `rpc_event.data` payload is already an AG-UI event, so the
 * existing event handling is reused as-is.
 */
export async function sendChatMessageStream(
  params: StreamChatParams,
): Promise<ChatSendResult> {
  if (params.signal?.aborted) {
    throw new ApiError(translate("请求已取消"), { code: "ABORTED" });
  }
  const rpc = new SessionRpc(params.tunnel);
  const stream = rpc.sendMessage(
    {
      sessionId: params.sessionCode,
      content: params.content,
      clientCapabilities: { userInputRequests: false },
      metadata: {
        workspaceCode: params.workspaceCode ?? null,
        dudeCode: params.dudeCode ?? null,
      },
    },
    { signal: params.signal, timeoutMs: 180_000 },
  );

  let result: ChatSendResult = { messages: [] };
  try {
    for await (const event of stream.events) {
      params.onEvent?.(event);
      const delta = aguiTextDelta(event);
      if (delta !== null) {
        params.onDelta?.(delta);
        continue;
      }
      const runError = aguiRunError(event);
      if (runError) {
        stream.cancel();
        throw new ApiError(runError.message, { code: runError.code });
      }
      if (isRunFinished(event)) {
        const finished = event as AgUiEvent & { result?: unknown };
        result = normalizeChatSendResult(finished.result);
      }
    }
  } finally {
    // The result promise settles with the run id; it is not needed here because
    // the chat screen reloads history after RUN_FINISHED.
    void stream.runId.catch(() => undefined);
  }
  return result;
}

/** Exposed for the generic session RPC (`session.list`) consumers. */
export function sessionRpcFor(tunnel: SecureTunnel): SessionRpc {
  return new SessionRpc(tunnel);
}