/**
 * Shared transport helpers for the Tron Remote Protocol.
 *
 * All business traffic goes through the Noise tunnel (`requestRaw` below);
 * there is no HTTP business path and therefore no fetch/XHR shortcut. The only
 * unauthenticated HTTP endpoint the protocol keeps is `/remote/identity`, which
 * the mobile client does not need because pairing carries the node identity.
 */
import type { SecureTunnel } from "./tunnel";
import { REMOTE_SECURE_PATH } from "../crypto/framing";
import { formatMessage, translate } from "../i18n";

/** `https` -> public (WSS), `http` -> LAN (WS). */
export type NodeTransport = "public" | "lan";

export class ApiError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly data?: unknown;

  constructor(
    message: string,
    options: { code?: string; status?: number; data?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.data = options.data;
  }
}

export class TimeoutError extends Error {
  constructor(message = translate("连接超时，请检查电脑地址和网络")) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalizes the node base URL:
 * - trims whitespace
 * - assumes `https://` when no scheme is present
 * - only accepts http/https
 * - removes trailing slashes (keeping a reverse-proxy path prefix intact)
 */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error(translate("请输入节点地址"));

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
  const withScheme = hasScheme ? raw : `https://${raw}`;

  if (!/^https?:\/\//i.test(withScheme)) {
    throw new Error(
      translate("仅支持 https://（公网）或 http://（局域网）地址"),
    );
  }

  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)$/i.exec(withScheme);
  if (!match) {
    throw new Error(translate("地址格式不正确，例如 https://tron.example.com"));
  }

  const [, scheme, host, path] = match;
  if (!host || host.includes("@")) {
    throw new Error(translate("地址格式不正确，例如 https://192.168.1.10:3000"));
  }
  if (path.includes("?") || path.includes("#")) {
    throw new Error(translate("节点地址不能包含查询参数或锚点"));
  }

  return `${scheme.toLowerCase()}://${host}${path}`.replace(/\/+$/, "");
}

/** True when the address uses the HTTPS scheme (public transport). */
export function isPublicBaseUrl(baseUrl: string): boolean {
  return /^https:\/\//i.test(baseUrl.trim());
}

export function transportForBaseUrl(baseUrl: string): NodeTransport {
  return isPublicBaseUrl(baseUrl) ? "public" : "lan";
}

/** Maps a node base URL to its secure WebSocket URL (`/remote/secure`). */
export function wsUrlForBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)$/i.exec(normalized);
  if (!match) {
    throw new Error(translate("地址格式不正确，例如 https://tron.example.com"));
  }
  const [, scheme, host, path] = match;
  const socketScheme = scheme.toLowerCase() === "https" ? "wss" : "ws";
  const prefix = path && path !== "/" ? path.replace(/\/+$/, "") : "";
  return `${socketScheme}://${host}${prefix}${REMOTE_SECURE_PATH}`;
}

export function isSuccessCode(code: string): boolean {
  // RPC results are unwrapped directly; this only tolerates legacy envelopes.
  return code === "SUCCESS" || code === "0";
}

/** HTTP-equivalent status for protocol error codes (used for 401/403 UI paths). */
export function remoteErrorStatus(code: string | undefined): number | undefined {
  switch (code) {
    case "REMOTE_HANDSHAKE_FAILED":
    case "REMOTE_PAIRING_TICKET_INVALID":
    case "REMOTE_PAIRING_TICKET_EXPIRED":
      return 401;
    case "REMOTE_E2EE_REQUIRED":
      return 426;
    case "REMOTE_DEVICE_UNKNOWN":
    case "REMOTE_DEVICE_REVOKED":
    case "RPC_FORBIDDEN":
      return 403;
    case "RPC_METHOD_NOT_FOUND":
      return 404;
    case "RPC_INVALID_PARAMS":
      return 400;
    case "RPC_UNSUPPORTED":
      return 501;
    case "REMOTE_FRAME_TOO_LARGE":
      return 413;
    case "REMOTE_BUSY":
      return 429;
    case "RPC_INTERNAL":
      return 500;
    default:
      return undefined;
  }
}

const TRANSPORT_ERROR_CODES = new Set([
  "TUNNEL_CLOSED",
  "TUNNEL_HEARTBEAT_TIMEOUT",
  "REMOTE_HANDSHAKE_FAILED",
  "REMOTE_INSECURE_TRANSPORT",
  "SOCKET_ERROR",
  "OFFLINE",
  "REMOTE_HOST_MISMATCH",
]);

const AUTH_ERROR_CODES = new Set([
  "REMOTE_HANDSHAKE_FAILED",
  "REMOTE_DEVICE_UNKNOWN",
  "REMOTE_DEVICE_REVOKED",
  "REMOTE_PAIRING_TICKET_INVALID",
  "REMOTE_PAIRING_TICKET_EXPIRED",
  "REMOTE_E2EE_REQUIRED",
]);

export interface RawRequestParams {
  tunnel: SecureTunnel;
  /** RPC method name, e.g. `session.list`, `tron.dudes.list`. */
  method: string;
  params?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Single business entry point: dispatches one RPC over the encrypted tunnel.
 * Every product API wrapper in this app funnels through here.
 */
export async function requestRaw<T>(params: RawRequestParams): Promise<T> {
  if (params.signal?.aborted) {
    throw new ApiError(translate("请求已取消"), { code: "ABORTED" });
  }
  return params.tunnel.call<T>(params.method, params.params, {
    signal: params.signal,
    timeoutMs: params.timeoutMs,
  });
}

export interface TronRequestParams extends RawRequestParams {}

/**
 * RPC request that also tolerates the legacy `{code,message,data}` envelope so
 * a product pack that still wraps results keeps working.
 */
export async function requestTronJson<T>(
  params: TronRequestParams,
): Promise<T> {
  const result = await requestRaw<unknown>(params);
  if (isRecord(result) && typeof result.code === "string" && "data" in result) {
    const message =
      typeof result.message === "string" && result.message.trim()
        ? result.message
        : formatMessage("请求失败（{code}）", { code: result.code });
    if (!isSuccessCode(result.code)) {
      throw new ApiError(message, {
        code: result.code,
        data: result.data,
      });
    }
    return result.data as T;
  }
  return result as T;
}

/**
 * True when a failure looks like the node is unreachable or the secure channel
 * is down (timeout, refused socket, failed handshake). RPC errors mean the node
 * answered, so they do not mark the node offline.
 */
export function isTransportError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof ApiError) {
    if (error.code && TRANSPORT_ERROR_CODES.has(error.code)) return true;
    if (error.code && error.code.startsWith("REMOTE_") && !AUTH_ERROR_CODES.has(error.code)) {
      return true;
    }
    return false;
  }
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  return /network request failed|failed to fetch|network error|load failed|network connection was lost|internet connection appears to be offline|connection (?:refused|reset)|websocket|timed? ?out/i.test(
    error.message,
  );
}

/** True when authentication failed (device unknown/revoked, ticket rejected). */
export function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401 || error.status === 403) return true;
  return error.code ? AUTH_ERROR_CODES.has(error.code) : false;
}

/** True when the device record is gone or revoked and re-pairing is required. */
export function isDeviceAuthError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "REMOTE_DEVICE_UNKNOWN" ||
      error.code === "REMOTE_DEVICE_REVOKED")
  );
}

/** True when a pairing ticket was rejected or expired. */
export function isTicketError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "REMOTE_PAIRING_TICKET_INVALID" ||
      error.code === "REMOTE_PAIRING_TICKET_EXPIRED")
  );
}

/** True when the node's pinned key no longer matches (key rotation/reset). */
export function isNodeKeyChangedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "REMOTE_NODE_KEY_MISMATCH" ||
      error.code === "REMOTE_HANDSHAKE_FAILED")
  );
}

/** True for RPC-level failures the server answered with a protocol code. */
export function isRpcError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    typeof error.code === "string" &&
    (error.code.startsWith("RPC_") || error.code === "REMOTE_BUSY")
  );
}