import { fetch as expoFetch } from "expo/fetch";

import { formatMessage, translate } from "../i18n";

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
}

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

/**
 * Raised before any request when a non-HTTPS node is used without the explicit
 * insecure-debug confirmation.
 */
export class SecurityError extends Error {
  constructor(
    message = translate(
      "出于安全考虑，PersonAI 只允许通过 HTTPS 连接远程节点。如果这是可信局域网中的调试环境，请在添加节点时显式开启“不安全调试”。",
    ),
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Raised only when an HTTP 2xx stream response has no readable body.
 * The Chat screen turns this into the documented non-streaming fallback.
 */
export class StreamUnsupportedError extends Error {
  constructor(message = translate("当前环境不支持流式响应")) {
    super(message);
    this.name = "StreamUnsupportedError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalizes the base URL used by the desktop client:
 * - trims whitespace
 * - assumes http:// when no scheme is present
 * - only accepts http/https
 * - removes trailing slashes (keeping a reverse-proxy path prefix intact)
 *
 * A scheme-less address is treated as http:// — callers must still run the
 * HTTPS gate before making requests.
 */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error(translate("请输入节点地址"));

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
  const withScheme = hasScheme ? raw : `http://${raw}`;

  if (!/^https?:\/\//i.test(withScheme)) {
    throw new Error(
      translate("仅支持 https:// 地址；调试可信局域网时可显式允许 http://"),
    );
  }

  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)$/i.exec(withScheme);
  if (!match) {
    throw new Error(
      translate("地址格式不正确，例如 https://tron.example.com"),
    );
  }

  const [, scheme, host, path] = match;
  if (!host || host.includes("@")) {
    throw new Error(
      translate("地址格式不正确，例如 https://192.168.1.10:3000"),
    );
  }
  if (path.includes("?") || path.includes("#")) {
    throw new Error(translate("节点地址不能包含查询参数或锚点"));
  }

  return `${scheme.toLowerCase()}://${host}${path}`.replace(/\/+$/, "");
}

/** True when the address uses the HTTPS scheme. */
export function isSecureBaseUrl(baseUrl: string): boolean {
  return /^https:\/\//i.test(baseUrl.trim());
}

/**
 * Enforces the transport policy: non-HTTPS is rejected before any request
 * unless the node is explicitly marked `allowInsecure` by the user.
 */
export function assertTransportAllowed(
  baseUrl: string,
  allowInsecure: boolean,
): void {
  if (isSecureBaseUrl(baseUrl)) return;
  if (allowInsecure) return;
  throw new SecurityError();
}

export function buildTronUrl(
  baseUrl: string,
  path: string,
  query?: QueryParams,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const entries = Object.entries(query ?? {}).filter(
    (entry): entry is [string, string | number | boolean] =>
      entry[1] !== undefined && entry[1] !== null,
  );
  if (!entries.length) return `${baseUrl}${normalizedPath}`;
  const queryString = entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
  return `${baseUrl}${normalizedPath}?${queryString}`;
}

export function buildTronHeaders(
  token: string | null | undefined,
  options: {
    dudeCode?: string | null;
    json?: boolean;
    extra?: Record<string, string>;
  } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept-Language": "zh-CN",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.json) headers["Content-Type"] = "application/json";
  if (options.dudeCode) headers["X-Dude-Code"] = options.dudeCode;
  if (options.extra) Object.assign(headers, options.extra);
  return headers;
}

async function readEnvelope(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text();
    if (!text.trim()) return null;
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSuccessCode(code: string): boolean {
  // Most endpoints use SUCCESS; chat/Dude endpoints use the AG-UI protocol's "0".
  return code === "SUCCESS" || code === "0";
}

interface RawRequestParams {
  baseUrl: string;
  /** JWT access token for authenticated endpoints; omitted for health. */
  token?: string | null;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: QueryParams;
  body?: unknown;
  dudeCode?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

async function requestRaw(params: RawRequestParams): Promise<Response> {
  if (params.signal?.aborted) {
    throw new ApiError(translate("请求已取消"), { code: "ABORTED" });
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs ?? 15_000);
  const abortFromCaller = () => controller.abort();
  params.signal?.addEventListener("abort", abortFromCaller);

  try {
    const url = buildTronUrl(params.baseUrl, params.path, params.query);
    const hasBody = params.body !== undefined;
    return await expoFetch(url, {
      method: params.method ?? "GET",
      headers: buildTronHeaders(params.token, {
        dudeCode: params.dudeCode,
        json: hasBody,
        extra: params.extraHeaders,
      }),
      body: hasBody ? JSON.stringify(params.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new TimeoutError();
    if (params.signal?.aborted) {
      throw new ApiError(translate("请求已取消"), { code: "ABORTED" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export interface TronRequestParams
  extends Omit<RawRequestParams, "timeoutMs" | "extraHeaders"> {
  timeoutMs?: number;
}

/** Requests a JSON endpoint and unwraps `{ code, message, data }`. */
export async function requestTronJson<T>(
  params: TronRequestParams,
): Promise<T> {
  const response = await requestRaw(params);
  const envelope = await readEnvelope(response);

  const code =
    envelope && typeof envelope.code === "string" ? envelope.code : undefined;
  const serverMessage =
    envelope && typeof envelope.message === "string"
      ? envelope.message.trim()
      : "";
  const message =
    serverMessage ||
    formatMessage("请求失败（HTTP {status}）", { status: response.status });
  const data = envelope ? envelope.data : undefined;

  if (!response.ok) {
    throw new ApiError(message, {
      code,
      status: response.status,
      data,
    });
  }
  if (!envelope || !code) {
    throw new ApiError(translate("服务器返回了无法解析的响应"), {
      status: response.status,
    });
  }
  if (!isSuccessCode(code)) {
    throw new ApiError(message, {
      code,
      status: response.status,
      data,
    });
  }
  return data as T;
}

/** Reads an error envelope from a streaming response without consuming a success body. */
export async function readStreamError(response: Response): Promise<ApiError> {
  const envelope = await readEnvelope(response);
  const code =
    envelope && typeof envelope.code === "string" ? envelope.code : undefined;
  const message =
    envelope && typeof envelope.message === "string" && envelope.message.trim()
      ? envelope.message
      : formatMessage("请求失败（HTTP {status}）", {
          status: response.status,
        });
  return new ApiError(message, {
    code,
    status: response.status,
    data: envelope?.data,
  });
}

/**
 * True when a failure looks like the node is unreachable (timeout, DNS,
 * connection refused, native fetch network error). HTTP error responses mean the
 * node answered, so they are not transport failures.
 */
export function isTransportError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof ApiError) {
    // HTTP/protocol errors mean the node answered; only raw fetch failures and
    // timeouts count as "offline".
    return false;
  }
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  return /network request failed|failed to fetch|network error|load failed|network connection was lost|internet connection appears to be offline|connection (?:refused|reset)|timed? ?out/i.test(
    error.message,
  );
}

/** True when the API rejected the JWT (expired or revoked). */
export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}