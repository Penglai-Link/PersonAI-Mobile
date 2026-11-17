/**
 * WebSocket + Noise + RPC multiplexer (Tron Remote Protocol client).
 *
 * One tunnel speaks Noise_IK_25519_ChaChaPoly_SHA256 over a `wss://` (public) or
 * `ws://` (LAN) socket at `/remote/secure`. Every binary frame is one Noise
 * transport message; its plaintext is one JSON RPC envelope. Requests are
 * multiplexed by numeric id, so streaming calls, calls and heartbeats share the
 * same connection.
 */
import { Platform } from "react-native";

import {
  ApiError,
  TimeoutError,
  isRecord,
  remoteErrorStatus,
  transportForBaseUrl,
  wsUrlForBaseUrl,
  type NodeTransport,
} from "./client";
import {
  FragmentAssembler,
  MAX_IN_FLIGHT,
  MAX_PLAINTEXT_BYTES,
  REMOTE_PROTOCOL,
  decodeRpcEnvelopeBytes,
  encodeRpcEnvelope,
  utf8Encode,
  type RpcEnvelope,
  type RpcFragmentEnvelope,
  type RpcReadyEnvelope,
} from "../crypto/framing";
import {
  NoiseError,
  NoiseInitiatorHandshake,
  NOISE_MAX_HANDSHAKE_MESSAGE,
  buildPrologue,
  type CipherState,
} from "../crypto/noise";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  ensureDeviceKey,
  loadDeviceKey,
  randomBytes,
  type DeviceKey,
} from "../crypto/keys";
import { translate } from "../i18n";

const CONNECT_TIMEOUT_MS = 10_000;
/** LAN candidates fail fast; a local socket either opens quickly or is absent. */
const LAN_CONNECT_TIMEOUT_MS = 4_000;
/** Do not retry an endpoint that just failed until the network changes. */
const ENDPOINT_RETRY_MS = 30_000;
const AUTH_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;
const STREAM_IDLE_TIMEOUT_MS = 180_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 65_000;
const IDLE_CLOSE_MS = 60_000;
const SWEEP_INTERVAL_MS = 15_000;
const MAX_INCOMING_FRAME_BYTES = MAX_PLAINTEXT_BYTES + 64;

const EMPTY = new Uint8Array(0);

/** Node fields the tunnel needs; structurally satisfied by `SavedNode`. */
export interface TunnelTarget {
  /** Currently selected endpoint; candidates override it when present. */
  baseUrl: string;
  transport: NodeTransport;
  nodeId: string;
  productCode: string;
  /** base64url-encoded node static public key. */
  nodeKey: string;
  keyId: string;
  deviceId?: string | null;
  /** LAN endpoint from the pairing QR, used first when reachable. */
  lanBaseUrl?: string | null;
  /** Public endpoint from the pairing QR, used when LAN is unreachable. */
  publicBaseUrl?: string | null;
}

export interface TunnelEndpoint {
  baseUrl: string;
  transport: NodeTransport;
}

/** A verified tunnel plus the heartbeat round trip that proved it alive. */
interface VerifiedTunnel {
  tunnel: SecureTunnel;
  latencyMs: number;
}

/** Ordered candidates: LAN first, then public, then the stored active URL. */
export function tunnelEndpoints(target: TunnelTarget): TunnelEndpoint[] {
  const urls = [
    target.lanBaseUrl?.trim(),
    target.publicBaseUrl?.trim(),
    target.baseUrl?.trim(),
  ].filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  const endpoints: TunnelEndpoint[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    endpoints.push({ baseUrl: url, transport: transportForBaseUrl(url) });
  }
  return endpoints;
}

/**
 * Current access network. On cellular a LAN address cannot work, so probing it
 * only burns the connect timeout; the pool drops LAN candidates in that case.
 */
export type TunnelNetworkKind = "lan-capable" | "cellular" | "unknown";

let networkKind: TunnelNetworkKind = "unknown";

export function setTunnelNetworkKind(kind: TunnelNetworkKind): void {
  networkKind = kind;
}

export interface TunnelProduct {
  productCode: string;
  productName: string;
  nodeId: string;
  version: string;
  platform: string;
}

export interface TunnelReady {
  deviceId: string;
  sessionId: string;
  expiresIn: number | null;
  methods: string[];
  product: TunnelProduct;
  events: string;
  features: string[];
}

export interface TunnelConnectOptions {
  /** One-time pairing ticket; omit on later connections. */
  ticket?: string | null;
  deviceName?: string;
  handshakeTimeoutMs?: number;
  authTimeoutMs?: number;
  onClose?: (error: ApiError | null) => void;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Optional event callback for call-style methods that also emit events. */
  onEvent?: (data: unknown) => void;
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** Idle timeout between events (defaults to 180s). */
  timeoutMs?: number;
}

export interface StreamHandle<R, T> {
  id: number;
  /** Resolves with the method result (`rpc_result`), if the server sends one. */
  result: Promise<R>;
  /** Yields each `rpc_event.data` unchanged (AG-UI events for session.*). */
  events: AsyncIterable<T>;
  cancel: () => void;
}

/* ------------------------------------------------------------------ */
/* Socket helpers                                                      */
/* ------------------------------------------------------------------ */

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

async function frameBytes(data: unknown): Promise<Uint8Array | null> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    const buffer = await data.arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (typeof data === "string") return utf8Encode(data);
  return null;
}

function socketOpen(socket: WebSocket): boolean {
  return socket.readyState === 1;
}

function tunnelError(code: string, message: string): ApiError {
  return new ApiError(message, { code, status: remoteErrorStatus(code) });
}

/**
 * Name this phone registers on the node. It identifies the client device in
 * the desktop's paired-device list; it is not the computer's name.
 */
function defaultDeviceName(): string {
  const platform =
    Platform.OS === "ios"
      ? "iOS"
      : Platform.OS === "android"
        ? "Android"
        : Platform.OS;
  return `PersonAI Mobile (${platform})`;
}

function abortError(): ApiError {
  return new ApiError(translate("请求已取消"), { code: "ABORTED" });
}

function timeoutError(message: string): TimeoutError {
  return new TimeoutError(message);
}

/** Extracts the negotiated protocol state from a `ready` frame. */
function parseReady(envelope: RpcReadyEnvelope, target: TunnelTarget): TunnelReady {
  if (typeof envelope.deviceId !== "string" || !envelope.deviceId) {
    throw tunnelError(
      "REMOTE_HANDSHAKE_FAILED",
      translate("电脑没有返回有效的设备标识"),
    );
  }
  if (typeof envelope.sessionId !== "string" || !envelope.sessionId) {
    throw tunnelError(
      "REMOTE_HANDSHAKE_FAILED",
      translate("电脑没有返回有效的会话标识"),
    );
  }
  const methods = Array.isArray(envelope.methods)
    ? envelope.methods.filter(
        (method): method is string => typeof method === "string",
      )
    : [];
  const productSource = isRecord(envelope.product) ? envelope.product : {};
  const product: TunnelProduct = {
    productCode:
      typeof productSource.productCode === "string" && productSource.productCode
        ? productSource.productCode
        : target.productCode,
    productName:
      typeof productSource.productName === "string" && productSource.productName
        ? productSource.productName
        : target.productCode,
    nodeId:
      typeof productSource.nodeId === "string" && productSource.nodeId
        ? productSource.nodeId
        : target.nodeId,
    version:
      typeof productSource.version === "string" ? productSource.version : "",
    platform:
      typeof productSource.platform === "string" ? productSource.platform : "",
  };
  return {
    deviceId: envelope.deviceId,
    sessionId: envelope.sessionId,
    expiresIn:
      typeof envelope.expiresIn === "number" && envelope.expiresIn > 0
        ? envelope.expiresIn
        : null,
    methods,
    product,
    events: typeof envelope.events === "string" ? envelope.events : "agui",
    features: Array.isArray(envelope.features)
      ? envelope.features.filter(
          (feature): feature is string => typeof feature === "string",
        )
      : [],
  };
}

/* ------------------------------------------------------------------ */
/* Pending RPC state                                                   */
/* ------------------------------------------------------------------ */

type TimerHandle = ReturnType<typeof setTimeout> | null;

interface PendingBase {
  id: number;
  timer: TimerHandle;
  timeoutMs: number;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface PendingCall extends PendingBase {
  kind: "call";
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onEvent?: (data: unknown) => void;
}

interface PendingStream extends PendingBase {
  kind: "stream";
  queue: unknown[];
  done: boolean;
  failure: unknown;
  wake: (() => void) | null;
  settleResult: (outcome: { value?: unknown; error?: unknown }) => void;
  resultSettled: boolean;
}

type Pending = PendingCall | PendingStream;

interface FrameWaiter {
  resolve: (elapsedMs: number) => void;
  reject: (error: unknown) => void;
  startedAt: number;
  timer: TimerHandle;
}

/* ------------------------------------------------------------------ */
/* SecureTunnel                                                        */
/* ------------------------------------------------------------------ */

export class SecureTunnel {
  private readonly socket: WebSocket;
  private readonly target: TunnelTarget;
  private readonly sendCipher: CipherState;
  private readonly recvCipher: CipherState;
  private readonly fragments = new FragmentAssembler();
  private readonly pending = new Map<number, Pending>();
  private readonly frameWaiters = new Set<FrameWaiter>();
  private readonly onCloseHandler?: (error: ApiError | null) => void;

  private readyState: TunnelReady;
  private nextId = 1;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastFrameAt = Date.now();
  private closed = false;
  private closeError: ApiError | null = null;
  /** Control frames are routed here while authenticating. */
  private controlWaiter: ((envelope: RpcEnvelope) => boolean) | null = null;
  /** Rejects the pending auth exchange when the channel dies mid-handshake. */
  private controlFail: ((error: unknown) => void) | null = null;

  private constructor(
    socket: WebSocket,
    target: TunnelTarget,
    sendCipher: CipherState,
    recvCipher: CipherState,
    ready: TunnelReady,
    onClose?: (error: ApiError | null) => void,
  ) {
    this.socket = socket;
    this.target = target;
    this.sendCipher = sendCipher;
    this.recvCipher = recvCipher;
    this.readyState = ready;
    this.onCloseHandler = onClose;
  }

  get ready(): TunnelReady {
    return this.readyState;
  }

  get methods(): string[] {
    return this.readyState.methods;
  }

  get baseUrl(): string {
    return this.target.baseUrl;
  }

  get transport(): NodeTransport {
    return transportForBaseUrl(this.target.baseUrl);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get lastError(): ApiError | null {
    return this.closeError;
  }

  /* -------------------------------------------------------------- */
  /* Handshake / connect                                            */
  /* -------------------------------------------------------------- */

  static async connect(
    target: TunnelTarget,
    deviceKey: DeviceKey,
    options: TunnelConnectOptions = {},
  ): Promise<SecureTunnel> {
    const handshakeTimeout = options.handshakeTimeoutMs ?? CONNECT_TIMEOUT_MS;
    const authTimeout = options.authTimeoutMs ?? AUTH_TIMEOUT_MS;
    const transport = transportForBaseUrl(target.baseUrl);

    let nodeKey: Uint8Array;
    try {
      nodeKey = base64UrlToBytes(target.nodeKey);
    } catch {
      throw tunnelError("REMOTE_HANDSHAKE_FAILED", translate("节点公钥格式无效"));
    }
    if (nodeKey.length !== 32) {
      throw tunnelError("REMOTE_HANDSHAKE_FAILED", translate("节点公钥长度无效"));
    }

    const url = wsUrlForBaseUrl(target.baseUrl);
    const socket = new WebSocket(url, REMOTE_PROTOCOL);
    socket.binaryType = "arraybuffer";

    const inbox: Uint8Array[] = [];
    let inboxWaiter: ((bytes: Uint8Array) => void) | null = null;

    const deliver = (bytes: Uint8Array) => {
      if (inboxWaiter) {
        const waiter = inboxWaiter;
        inboxWaiter = null;
        waiter(bytes);
        return;
      }
      inbox.push(bytes);
    };

    const nextMessage = (timeoutMs: number): Promise<Uint8Array> => {
      if (inbox.length) return Promise.resolve(inbox.shift() as Uint8Array);
      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          inboxWaiter = null;
          reject(
            timeoutError(translate("安全握手超时，请检查电脑地址和网络")),
          );
        }, timeoutMs);
        inboxWaiter = (bytes) => {
          clearTimeout(timer);
          resolve(bytes);
        };
      });
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            timeoutError(translate("无法连接到节点，请检查电脑在线且网络可达")),
          );
        }, handshakeTimeout);
        socket.onopen = () => {
                clearTimeout(timer);
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(tunnelError("SOCKET_ERROR", translate("无法连接到节点，请检查网络")));
        };
        socket.onclose = (event) => {
          clearTimeout(timer);
          reject(tunnelError("TUNNEL_CLOSED", translate("节点关闭了连接")));
        };
      });

      socket.onmessage = (event: MessageEvent) => {
        void (async () => {
          const bytes = await frameBytes(event.data);
          if (!bytes) return;
          if (bytes.length > NOISE_MAX_HANDSHAKE_MESSAGE) {
            try {
              socket.close();
            } catch {
              // ignore
            }
            return;
          }
          deliver(bytes);
        })();
      };

      const handshake = new NoiseInitiatorHandshake({
        remoteStaticPublic: nodeKey,
        localStaticPrivate: deviceKey.privateKey,
        prologue: buildPrologue({
          nodeId: target.nodeId,
          productCode: target.productCode,
          transport,
        }),
        randomBytes,
      });

      socket.send(toArrayBuffer(handshake.writeMessage1()));
        const message2 = await nextMessage(handshakeTimeout);
        handshake.readMessage2(message2);
      const ciphers = handshake.split();

      const tunnel = new SecureTunnel(
        socket,
        target,
        ciphers.send,
        ciphers.recv,
        {
          deviceId: "",
          sessionId: "",
          expiresIn: null,
          methods: [],
          product: {
            productCode: target.productCode,
            productName: target.productCode,
            nodeId: target.nodeId,
            version: "",
            platform: "",
          },
          events: "agui",
          features: [],
        },
        options.onClose,
      );

      socket.onmessage = (event: MessageEvent) => {
        void tunnel.handleSocketMessage(event.data);
      };
      socket.onclose = () => {
        tunnel.close(tunnelError("TUNNEL_CLOSED", translate("与节点的连接已断开")));
      };
      socket.onerror = () => {
        tunnel.close(tunnelError("SOCKET_ERROR", translate("与节点的连接发生错误")));
      };

      // Anything the responder sent while the handshake was finishing.
      for (const queued of inbox.splice(0)) {
        void tunnel.handleIncoming(queued);
      }

        await tunnel.authenticate(deviceKey, authTimeout, options);
        tunnel.startHeartbeat();
      return tunnel;
    } catch (error) {
      try {
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      } catch {
        // ignore
      }
      if (error instanceof NoiseError) {
        throw tunnelError(
          "REMOTE_HANDSHAKE_FAILED",
          translate("安全握手失败，节点公钥可能已变化"),
        );
      }
      throw error;
    }
  }

  private async authenticate(
    deviceKey: DeviceKey,
    timeoutMs: number,
    options: TunnelConnectOptions,
  ): Promise<void> {
    const response = new Promise<RpcEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.controlWaiter = null;
        this.controlFail = null;
        reject(timeoutError(translate("节点没有完成设备认证")));
      }, timeoutMs);
      this.controlFail = (error) => {
        clearTimeout(timer);
        this.controlWaiter = null;
        this.controlFail = null;
        reject(error);
      };
      this.controlWaiter = (envelope) => {
        if (
          envelope.type !== "ready" &&
          envelope.type !== "error" &&
          envelope.type !== "rpc_error"
        ) {
          return false;
        }
        clearTimeout(timer);
        this.controlWaiter = null;
        this.controlFail = null;
        resolve(envelope);
        return true;
      };
    });
    // The auth promise is only awaited after the frame is sent; keep an early
    // channel failure from surfacing as an unhandled rejection.
    response.catch(() => undefined);

    const ticket = options.ticket?.trim();
    try {
      this.sendEnvelope({
        type: "auth",
        ...(ticket ? { ticket } : {}),
        ...(this.target.deviceId ? { deviceId: this.target.deviceId } : {}),
        device: {
          name: options.deviceName?.trim() || defaultDeviceName(),
          platform: Platform.OS,
          publicKey: bytesToBase64Url(deviceKey.publicKey),
          keyId: deviceKey.keyId,
        },
      });
    } catch (error) {
      this.controlWaiter = null;
      this.close();
      throw error;
    }

    const envelope = await response;
    if (envelope.type === "error" || envelope.type === "rpc_error") {
      throw new ApiError(envelope.message || envelope.code, {
        code: envelope.code,
        status: remoteErrorStatus(envelope.code),
        data: envelope.details,
      });
    }
    if (envelope.type !== "ready") {
      throw tunnelError("REMOTE_HANDSHAKE_FAILED", translate("节点没有返回就绪状态"));
    }
    this.readyState = parseReady(envelope, this.target);
  }

  /* -------------------------------------------------------------- */
  /* RPC                                                             */
  /* -------------------------------------------------------------- */

  /** Calls one RPC method and resolves with its `rpc_result`. */
  call<T>(
    method: string,
    params?: unknown,
    options: CallOptions = {},
  ): Promise<T> {
    try {
      this.ensureOpen();
    } catch (error) {
      return Promise.reject(error);
    }
    if (options.signal?.aborted) return Promise.reject(abortError());
    if (this.pending.size >= MAX_IN_FLIGHT) {
      return Promise.reject(
        tunnelError("REMOTE_BUSY", translate("请求过多，请稍后重试")),
      );
    }

    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      const pending: PendingCall = {
        id,
        kind: "call",
        timer: null,
        timeoutMs,
        resolve: (value) => resolve(value as T),
        reject,
        onEvent: options.onEvent,
      };
      this.pending.set(id, pending);
      this.attachSignal(pending, options.signal);
      this.armTimer(pending);
      try {
        this.sendEnvelope({ type: "rpc", id, method, params });
      } catch (error) {
        this.fail(id, error);
      }
    });
  }

  /** Runs one streaming RPC, yielding each `rpc_event.data` unchanged. */
  stream<T>(
    method: string,
    params?: unknown,
    options: StreamOptions = {},
  ): AsyncIterable<T> {
    return this.streamWithResult<unknown, T>(method, params, options).events;
  }

  /**
   * Streaming RPC that exposes both the `rpc_result` (e.g. `{runId}` or
   * `{subscriptionId}`) and the event iterable.
   */
  streamWithResult<R, T>(
    method: string,
    params?: unknown,
    options: StreamOptions = {},
  ): StreamHandle<R, T> {
    this.ensureOpen();
    if (options.signal?.aborted) throw abortError();
    if (this.pending.size >= MAX_IN_FLIGHT) {
      throw tunnelError("REMOTE_BUSY", translate("请求过多，请稍后重试"));
    }

    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = options.timeoutMs ?? STREAM_IDLE_TIMEOUT_MS;

    const queue: unknown[] = [];
    let settleResult: (outcome: { value?: unknown; error?: unknown }) => void =
      () => undefined;
    const result = new Promise<R>((resolve, reject) => {
      settleResult = (outcome) => {
        if (outcome.error !== undefined) reject(outcome.error);
        else resolve(outcome.value as R);
      };
    });
    // Consumers usually observe failures through the event iterator first.
    result.catch(() => undefined);

    const pending: PendingStream = {
      id,
      kind: "stream",
      timer: null,
      timeoutMs,
      queue,
      done: false,
      failure: null,
      wake: null,
      settleResult,
      resultSettled: false,
    };
    this.pending.set(id, pending);
    this.attachSignal(pending, options.signal);
    this.armTimer(pending);
    try {
      this.sendEnvelope({ type: "rpc", id, method, params });
    } catch (error) {
      this.fail(id, error);
    }

    const events: AsyncIterable<T> = (async function* iterate() {
      for (;;) {
        if (pending.queue.length) {
          yield pending.queue.shift() as T;
          continue;
        }
        if (pending.failure !== null) throw pending.failure;
        if (pending.done) return;
        await new Promise<void>((resolve) => {
          pending.wake = resolve;
          if (
            pending.queue.length ||
            pending.done ||
            pending.failure !== null
          ) {
            pending.wake = null;
            resolve();
          }
        });
      }
    })();

    return {
      id,
      result,
      events,
      cancel: () => {
        const current = this.pending.get(id);
        if (!current) return;
        this.sendCancelFrame(id);
        this.fail(id, abortError());
      },
    };
  }

  /** Sends a `cancel` frame for one in-flight call/subscription. */
  cancel(id: number): void {
    this.sendCancelFrame(id);
  }

  /** Round-trips a heartbeat; also used as the online probe. */
  ping(timeoutMs = 5_000): Promise<number> {
    this.ensureOpen();
    return new Promise<number>((resolve, reject) => {
      const waiter: FrameWaiter = {
        startedAt: Date.now(),
        resolve,
        reject,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        this.frameWaiters.delete(waiter);
        reject(timeoutError(translate("节点没有响应心跳")));
      }, timeoutMs);
      waiter.resolve = (elapsed) => {
        if (waiter.timer) clearTimeout(waiter.timer);
        resolve(elapsed);
      };
      this.frameWaiters.add(waiter);
      try {
        this.sendEnvelope({ type: "ping", ts: Date.now() });
      } catch (error) {
        if (waiter.timer) clearTimeout(waiter.timer);
        this.frameWaiters.delete(waiter);
        reject(error);
      }
    });
  }

  close(error?: ApiError): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError =
      error ?? tunnelError("TUNNEL_CLOSED", translate("安全通道已关闭"));

    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const id of [...this.pending.keys()]) {
      this.fail(id, this.closeError);
    }
    for (const waiter of [...this.frameWaiters]) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(this.closeError);
    }
    this.frameWaiters.clear();
    this.fragments.reset();
    this.controlWaiter = null;
    if (this.controlFail) {
      const fail = this.controlFail;
      this.controlFail = null;
      fail(this.closeError);
    }

    try {
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
    } catch {
      // ignore
    }
    this.onCloseHandler?.(error ?? null);
  }

  /* -------------------------------------------------------------- */
  /* Internals                                                       */
  /* -------------------------------------------------------------- */

  private ensureOpen(): void {
    if (this.closed) {
      throw (
        this.closeError ??
        tunnelError("TUNNEL_CLOSED", translate("安全通道已关闭"))
      );
    }
    if (!socketOpen(this.socket)) {
      this.close(tunnelError("TUNNEL_CLOSED", translate("与节点的连接已断开")));
      throw (
        this.closeError ??
        tunnelError("TUNNEL_CLOSED", translate("与节点的连接已断开"))
      );
    }
  }

  private sendEnvelope(envelope: RpcEnvelope): void {
    this.ensureOpen();
    let plaintext: Uint8Array;
    try {
      plaintext = encodeRpcEnvelope(envelope);
    } catch {
      throw tunnelError(
        "REMOTE_FRAME_TOO_LARGE",
        translate("请求数据过大，无法发送"),
      );
    }
    if (plaintext.length > MAX_PLAINTEXT_BYTES) {
      throw tunnelError(
        "REMOTE_FRAME_TOO_LARGE",
        translate("请求数据过大，无法发送"),
      );
    }
    const sealed = this.sendCipher.encrypt(EMPTY, plaintext);
    this.socket.send(toArrayBuffer(sealed));
  }

  private sendCancelFrame(id: number): void {
    if (this.closed) return;
    try {
      this.sendEnvelope({ type: "cancel", id });
    } catch {
      // The channel is already unusable; the pending call will fail with the
      // channel error instead.
    }
  }

  private armTimer(pending: Pending): void {
    if (pending.timer) clearTimeout(pending.timer);
    const timeoutMs = pending.timeoutMs;
    pending.timer = setTimeout(() => {
      const error =
        pending.kind === "call"
          ? timeoutError(translate("请求超时，请稍后重试"))
          : timeoutError(translate("安全通道长时间没有响应"));
      this.fail(pending.id, error);
    }, timeoutMs);
  }

  private attachSignal(pending: Pending, signal?: AbortSignal): void {
    if (!signal) return;
    const onAbort = () => {
      this.sendCancelFrame(pending.id);
      this.fail(pending.id, abortError());
    };
    pending.signal = signal;
    pending.onAbort = onAbort;
    signal.addEventListener("abort", onAbort);
  }

  private releaseSignal(pending: Pending): void {
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    pending.signal = undefined;
    pending.onAbort = undefined;
  }

  private fail(id: number, error: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    this.releaseSignal(pending);

    if (pending.kind === "call") {
      pending.reject(error);
      return;
    }
    if (!pending.resultSettled) {
      pending.resultSettled = true;
      pending.settleResult({ error });
    }
    pending.failure = error;
    pending.done = true;
    this.wake(pending);
  }

  private finishStream(id: number, result: unknown): void {
    const pending = this.pending.get(id);
    if (!pending || pending.kind !== "stream") return;
    this.pending.delete(id);
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    this.releaseSignal(pending);

    if (!pending.resultSettled) {
      pending.resultSettled = true;
      pending.settleResult({ value: result });
    }
    pending.done = true;
    this.wake(pending);
  }

  private wake(pending: PendingStream): void {
    const wake = pending.wake;
    pending.wake = null;
    wake?.();
  }

  private touch(pending: Pending): void {
    if (pending.timer) clearTimeout(pending.timer);
    this.armTimer(pending);
  }

  /**
   * Extends every stream's idle timer. Called on `pong`, so the idle timeout
   * only measures "the node stopped answering" rather than "this run has not
   * emitted an event yet".
   */
  private keepStreamsAlive(): void {
    for (const pending of this.pending.values()) {
      if (pending.kind === "stream") this.touch(pending);
    }
  }

  private notifyFrameWaiters(): void {
    const now = Date.now();
    for (const waiter of [...this.frameWaiters]) {
      this.frameWaiters.delete(waiter);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(now - waiter.startedAt);
    }
  }

  private async handleSocketMessage(data: unknown): Promise<void> {
    const bytes = await frameBytes(data);
    if (!bytes) return;
    await this.handleIncoming(bytes);
  }

  private async handleIncoming(bytes: Uint8Array): Promise<void> {
    if (this.closed) return;
    if (bytes.length > MAX_INCOMING_FRAME_BYTES) {
      this.close(
        tunnelError("REMOTE_FRAME_TOO_LARGE", translate("节点返回的数据过大")),
      );
      return;
    }
    let plaintext: Uint8Array;
    try {
      plaintext = this.recvCipher.decrypt(EMPTY, bytes);
    } catch {
      this.close(
        tunnelError("REMOTE_HANDSHAKE_FAILED", translate("安全通道校验失败，连接已关闭")),
      );
      return;
    }
    if (plaintext.length > MAX_PLAINTEXT_BYTES) {
      this.close(
        tunnelError("REMOTE_FRAME_TOO_LARGE", translate("节点返回的数据过大")),
      );
      return;
    }
    let envelope: RpcEnvelope;
    try {
      envelope = decodeRpcEnvelopeBytes(plaintext);
    } catch {
      this.close(
        tunnelError("REMOTE_HANDSHAKE_FAILED", translate("收到无法解析的远程帧")),
      );
      return;
    }
    this.lastFrameAt = Date.now();
    this.notifyFrameWaiters();
    this.handleEnvelope(envelope);
  }

  private handleEnvelope(envelope: RpcEnvelope): void {
    if (this.controlWaiter && this.controlWaiter(envelope)) return;

    switch (envelope.type) {
      case "ping":
        try {
          this.sendEnvelope({ type: "pong", ts: envelope.ts });
        } catch {
          // The channel handles its own failure.
        }
        return;
      case "pong":
        // A heartbeat reply proves the channel is alive even when a stream is
        // waiting on a silent run (long tool step, slow model). Without this a
        // quiet-but-healthy run would hit the stream idle timeout and look
        // exactly like a dropped connection.
        this.keepStreamsAlive();
        return;
      case "fragment":
        this.handleFragment(envelope);
        return;
      case "rpc_result": {
        const pending = this.pending.get(envelope.id);
        if (!pending) return;
        if (pending.kind === "call") {
          this.pending.delete(envelope.id);
          this.clearPendingTimers(pending);
          pending.resolve(envelope.result);
          return;
        }
        if (!pending.resultSettled) {
          pending.resultSettled = true;
          pending.settleResult({ value: envelope.result });
        }
        this.touch(pending);
        return;
      }
      case "rpc_error": {
        this.fail(
          envelope.id,
          new ApiError(envelope.message || envelope.code, {
            code: envelope.code,
            status: remoteErrorStatus(envelope.code),
            data: envelope.details,
          }),
        );
        return;
      }
      case "rpc_event": {
        const pending = this.pending.get(envelope.id);
        if (!pending) return;
        if (pending.kind === "call") {
          pending.onEvent?.(envelope.data);
          return;
        }
        if (pending.queue.length >= MAX_IN_FLIGHT * 512) {
          this.fail(
            envelope.id,
            tunnelError("REMOTE_BUSY", translate("事件队列溢出，已停止接收")),
          );
          return;
        }
        pending.queue.push(envelope.data);
        this.touch(pending);
        this.wake(pending);
        return;
      }
      case "rpc_end": {
        const pending = this.pending.get(envelope.id);
        if (!pending || pending.kind !== "stream") return;
        this.finishStream(envelope.id, undefined);
        return;
      }
      case "ready":
      case "auth":
        // Unexpected at this point.
        return;
      case "error":
        this.close(
          new ApiError(envelope.message || envelope.code, {
            code: envelope.code,
            status: remoteErrorStatus(envelope.code),
            data: envelope.details,
          }),
        );
        return;
      default:
        return;
    }
  }

  private handleFragment(envelope: RpcFragmentEnvelope): void {
    try {
      const assembled = this.fragments.push(envelope);
      if (assembled) this.handleEnvelope(assembled);
    } catch {
      this.fragments.reset(envelope.id);
      this.fail(
        envelope.id,
        tunnelError("REMOTE_FRAME_TOO_LARGE", translate("分片结果无法重组")),
      );
    }
  }

  private clearPendingTimers(pending: Pending): void {
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    this.releaseSignal(pending);
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.closed) return;
      if (Date.now() - this.lastFrameAt > HEARTBEAT_TIMEOUT_MS) {
        this.close(
          tunnelError("TUNNEL_HEARTBEAT_TIMEOUT", translate("安全通道心跳超时")),
        );
        return;
      }
      try {
        this.sendEnvelope({ type: "ping", ts: Date.now() });
      } catch {
        // close() has already been triggered by sendEnvelope/ensureOpen.
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
}

/* ------------------------------------------------------------------ */
/* Pool                                                                */
/* ------------------------------------------------------------------ */

export class SecureTunnelPool {
  private readonly entries = new Map<
    string,
    { tunnel: SecureTunnel; lastUsedAt: number }
  >();
  private readonly connecting = new Map<string, Promise<SecureTunnel>>();
  /** Last endpoint that completed a handshake, per node. */
  private readonly preferredBaseUrls = new Map<string, string>();
  /** Endpoints that failed recently, per node + URL; skipped until expiry. */
  private readonly endpointFailures = new Map<string, number>();
  private sweep: ReturnType<typeof setInterval> | null = null;
  /**
   * Incremented by `closeAll` (app background / node switch). A connection that
   * completes after a reset is closed instead of being cached, so no tunnel
   * survives a background transition.
   */
  private generation = 0;

  static keyFor(target: TunnelTarget): string {
    return `${target.nodeId || ""}|${target.baseUrl}`;
  }

  async acquire(target: TunnelTarget): Promise<SecureTunnel> {
    // A live tunnel is always the fastest path. Re-walking the endpoint list
    // here used to re-open (and time out on) an unreachable LAN address for
    // every single RPC batch, turning each screen load into a 10s wait.
    const cached = this.liveTunnelFor(target);
    if (cached) return cached;

    let lastError: unknown = null;
    for (const endpoint of this.endpointOrder(target)) {
      try {
        const tunnel = await this.acquireOne(
          { ...target, ...endpoint },
          endpoint.transport === "lan" ? LAN_CONNECT_TIMEOUT_MS : undefined,
        );
        this.noteEndpointSuccess(target, endpoint);
        return tunnel;
      } catch (error) {
        this.noteEndpointFailure(target, endpoint);
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    throw tunnelError("TUNNEL_CLOSED", translate("节点没有可用地址"));
  }

  /**
   * Returns a live cached tunnel for the node regardless of which endpoint it
   * uses. The pool is keyed by endpoint, but to the caller a node is one node.
   */
  private liveTunnelFor(target: TunnelTarget): SecureTunnel | null {
    const prefix = `${target.nodeId || ""}|`;
    let best: { tunnel: SecureTunnel; lastUsedAt: number } | null = null;
    for (const [key, entry] of [...this.entries.entries()]) {
      if (!key.startsWith(prefix)) continue;
      if (entry.tunnel.isClosed) {
        this.entries.delete(key);
        continue;
      }
      if (!best || entry.lastUsedAt > best.lastUsedAt) best = entry;
    }
    if (!best) return null;
    best.lastUsedAt = Date.now();
    return best.tunnel;
  }

  private endpointKey(target: TunnelTarget, endpoint: TunnelEndpoint): string {
    return `${target.nodeId || ""}|${endpoint.baseUrl}`;
  }

  private noteEndpointSuccess(
    target: TunnelTarget,
    endpoint: TunnelEndpoint,
  ): void {
    this.preferredBaseUrls.set(target.nodeId || "", endpoint.baseUrl);
    this.endpointFailures.delete(this.endpointKey(target, endpoint));
  }

  private noteEndpointFailure(
    target: TunnelTarget,
    endpoint: TunnelEndpoint,
  ): void {
    this.endpointFailures.set(
      this.endpointKey(target, endpoint),
      Date.now() + ENDPOINT_RETRY_MS,
    );
  }

  /**
   * Network-aware, health-aware candidate order: keep the documented
   * LAN -> public -> active order but try the last good endpoint first, skip
   * LAN on cellular, and temporarily skip endpoints that just failed. If every
   * candidate is cooling down, all of them are retried rather than failing.
   */
  private endpointOrder(target: TunnelTarget): TunnelEndpoint[] {
    let endpoints = tunnelEndpoints(target);
    if (networkKind === "cellular") {
      const external = endpoints.filter((endpoint) => endpoint.transport !== "lan");
      if (external.length) endpoints = external;
    }

    const preferred = this.preferredBaseUrls.get(target.nodeId || "");
    const ranked = [...endpoints];
    if (preferred) {
      ranked.sort((left, right) => {
        const leftRank = left.baseUrl === preferred ? 0 : 1;
        const rightRank = right.baseUrl === preferred ? 0 : 1;
        return leftRank - rightRank;
      });
    }

    const now = Date.now();
    const healthy = ranked.filter((endpoint) => {
      const retryAt = this.endpointFailures.get(
        this.endpointKey(target, endpoint),
      );
      return retryAt === undefined || retryAt <= now;
    });
    return healthy.length ? healthy : ranked;
  }

  /** Drops a tunnel from the cache without touching preferred/failure hints. */
  private dropTunnel(tunnel: SecureTunnel): void {
    for (const [key, entry] of [...this.entries.entries()]) {
      if (entry.tunnel === tunnel) this.entries.delete(key);
    }
  }

  private async acquireOne(
    target: TunnelTarget,
    handshakeTimeoutMs?: number,
  ): Promise<SecureTunnel> {
    const key = SecureTunnelPool.keyFor(target);
    const existing = this.entries.get(key);
    if (existing && !existing.tunnel.isClosed) {
      existing.lastUsedAt = Date.now();
      return existing.tunnel;
    }
    const pending = this.connecting.get(key);
    if (pending) return pending;

    const generation = this.generation;
    const promise = this.open(target, generation, handshakeTimeoutMs).finally(() => {
      this.connecting.delete(key);
    });
    this.connecting.set(key, promise);
    return promise;
  }

  /** Opens a fresh tunnel, optionally with a one-time pairing ticket. */
  async connectOnce(
    target: TunnelTarget,
    options: TunnelConnectOptions = {},
  ): Promise<SecureTunnel> {
    const deviceKey = await ensureDeviceKey(target.nodeId);
    const tunnel = await SecureTunnel.connect(target, deviceKey, options);
    const key = SecureTunnelPool.keyFor(target);
    const previous = this.entries.get(key);
    if (previous && previous.tunnel !== tunnel && !previous.tunnel.isClosed) {
      previous.tunnel.close();
    }
    this.entries.set(key, { tunnel, lastUsedAt: Date.now() });
    this.ensureSweeper();
    return tunnel;
  }

  /**
   * First pairing tries LAN before public. A network failure can safely move to
   * the next candidate; an auth/ticket failure stops because the ticket is
   * single-use once the server has consumed it.
   */
  async connectOnceBest(
    target: TunnelTarget,
    options: TunnelConnectOptions = {},
  ): Promise<SecureTunnel> {
    let lastError: unknown = null;
    for (const endpoint of this.endpointOrder(target)) {
      try {
        const tunnel = await this.connectOnce(
          { ...target, ...endpoint },
          options,
        );
        this.noteEndpointSuccess(target, endpoint);
        return tunnel;
      } catch (error) {
        lastError = error;
        if (
          error instanceof ApiError &&
          (error.code === "REMOTE_PAIRING_TICKET_INVALID" ||
            error.code === "REMOTE_PAIRING_TICKET_EXPIRED" ||
            error.code === "REMOTE_DEVICE_UNKNOWN" ||
            error.code === "REMOTE_DEVICE_REVOKED")
        ) {
          throw error;
        }
        this.noteEndpointFailure(target, endpoint);
      }
    }
    if (lastError) throw lastError;
    throw tunnelError("TUNNEL_CLOSED", translate("节点没有可用地址"));
  }

  /**
   * Reuses a live tunnel when one exists, otherwise walks the candidate order
   * until a tunnel answers a heartbeat. Failed candidates are cooled down so a
   * stale LAN address is not re-probed on every refresh.
   */
  private async connectVerified(
    target: TunnelTarget,
    timeoutMs: number,
    handshakeTimeoutFor: (endpoint: TunnelEndpoint) => number,
  ): Promise<VerifiedTunnel> {
    const cached = this.liveTunnelFor(target);
    if (cached) {
      // One missed heartbeat is not proof the channel is dead (slow link, busy
      // JS thread). Retry once before dropping a tunnel that still works.
      const first = await this.pingTunnel(cached, timeoutMs);
      if (first.ok) return { tunnel: cached, latencyMs: first.latencyMs };
      const second = await this.pingTunnel(cached, timeoutMs);
      if (second.ok) return { tunnel: cached, latencyMs: second.latencyMs };
      cached.close();
      this.dropTunnel(cached);
    }

    let lastError: unknown = null;
    for (const endpoint of this.endpointOrder(target)) {
      try {
        // `acquireOne` shares an in-flight handshake with `acquire`, so a
        // status probe and a screen load cannot open two sockets for the same
        // endpoint and orphan one of them.
        const tunnel = await this.acquireOne(
          { ...target, ...endpoint },
          handshakeTimeoutFor(endpoint),
        );
        const verified = await this.pingTunnel(tunnel, timeoutMs);
        if (!verified.ok) {
          tunnel.close();
          this.dropTunnel(tunnel);
          throw tunnelError("TUNNEL_HEARTBEAT_TIMEOUT", translate("节点没有响应心跳"));
        }
        this.noteEndpointSuccess(target, endpoint);
        return { tunnel, latencyMs: verified.latencyMs };
      } catch (error) {
        this.noteEndpointFailure(target, endpoint);
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    throw tunnelError("TUNNEL_CLOSED", translate("节点没有可用地址"));
  }

  /** One heartbeat round trip; failures are values, not exceptions. */
  private async pingTunnel(
    tunnel: SecureTunnel,
    timeoutMs: number,
  ): Promise<{ ok: boolean; latencyMs: number }> {
    try {
      return { ok: true, latencyMs: await tunnel.ping(timeoutMs) };
    } catch {
      return { ok: false, latencyMs: 0 };
    }
  }

  /** Probes candidates and returns the first reachable endpoint. */
  async probeNode(
    target: TunnelTarget,
    timeoutMs = 3_000,
  ): Promise<TunnelEndpoint | null> {
    try {
      const { tunnel } = await this.connectVerified(
        target,
        timeoutMs,
        (endpoint) => this.handshakeTimeoutFor(endpoint, 6_000, timeoutMs),
      );
      return { baseUrl: tunnel.baseUrl, transport: tunnel.transport };
    } catch {
      return null;
    }
  }

  async probe(target: TunnelTarget, timeoutMs = 5_000): Promise<boolean> {
    return (await this.probeNode(target, Math.min(timeoutMs, 3_000))) !== null;
  }

  /** Acquires a tunnel and verifies it with a heartbeat round trip. */
  async connectAndPing(
    target: TunnelTarget,
    timeoutMs = 5_000,
  ): Promise<SecureTunnel> {
    const { tunnel } = await this.connectVerified(
      target,
      timeoutMs,
      (endpoint) => this.handshakeTimeoutFor(endpoint, 8_000, timeoutMs),
    );
    return tunnel;
  }

  /**
   * Measures one heartbeat round trip against a node, reusing a live tunnel
   * when one exists. A fresh handshake is not included in the returned number,
   * so the value reflects the network path rather than pairing latency.
   */
  async measureLatency(
    target: TunnelTarget,
    timeoutMs = 4_000,
  ): Promise<number> {
    const { latencyMs } = await this.connectVerified(
      target,
      timeoutMs,
      (endpoint) => this.handshakeTimeoutFor(endpoint, 8_000, timeoutMs),
    );
    return latencyMs;
  }

  private handshakeTimeoutFor(
    endpoint: TunnelEndpoint,
    publicMinimumMs: number,
    extraMs: number,
  ): number {
    return endpoint.transport === "lan"
      ? LAN_CONNECT_TIMEOUT_MS
      : Math.max(publicMinimumMs, extraMs);
  }

  closeNode(target: TunnelTarget): void {
    const prefix = `${target.nodeId || ""}|`;
    for (const [key, entry] of [...this.entries.entries()]) {
      if (key === SecureTunnelPool.keyFor(target) || key.startsWith(prefix)) {
        this.entries.delete(key);
        entry.tunnel.close();
      }
    }
    this.preferredBaseUrls.delete(target.nodeId || "");
    for (const key of [...this.endpointFailures.keys()]) {
      if (key.startsWith(prefix)) this.endpointFailures.delete(key);
    }
  }

  closeAll(): void {
    this.generation += 1;
    const tunnels = [...this.entries.values()].map((entry) => entry.tunnel);
    this.entries.clear();
    this.connecting.clear();
    for (const tunnel of tunnels) tunnel.close();
  }

  /**
   * Called when the access network changes (Wi-Fi <-> cellular). It lets the
   * next attempt re-evaluate LAN from scratch instead of trusting a cached
   * public/LAN preference from the previous network.
   */
  clearEndpointHints(): void {
    this.preferredBaseUrls.clear();
    this.endpointFailures.clear();
  }

  private async open(
    target: TunnelTarget,
    generation: number,
    handshakeTimeoutMs?: number,
  ): Promise<SecureTunnel> {
    const deviceKey = await loadDeviceKey(target.nodeId);
    if (!deviceKey) {
      throw new ApiError(
        translate("这台节点的设备密钥已丢失，请删除后重新配对"),
        { code: "DEVICE_KEY_MISSING" },
      );
    }
    const key = SecureTunnelPool.keyFor(target);
    const tunnel = await SecureTunnel.connect(target, deviceKey, {
      handshakeTimeoutMs,
      onClose: () => {
        const entry = this.entries.get(key);
        if (entry && entry.tunnel === tunnel) this.entries.delete(key);
      },
    });
    if (generation !== this.generation) {
      // The app went to background (or the node changed) while handshaking.
      tunnel.close();
      throw tunnelError(
        "TUNNEL_CLOSED",
        translate("安全通道已关闭"),
      );
    }
    this.entries.set(key, { tunnel, lastUsedAt: Date.now() });
    this.ensureSweeper();
    return tunnel;
  }

  private ensureSweeper(): void {
    if (this.sweep) return;
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries) {
        if (entry.tunnel.isClosed || now - entry.lastUsedAt > IDLE_CLOSE_MS) {
          this.entries.delete(key);
          entry.tunnel.close();
        }
      }
      if (!this.entries.size && !this.connecting.size && this.sweep) {
        clearInterval(this.sweep);
        this.sweep = null;
      }
    }, SWEEP_INTERVAL_MS);
  }
}

export const tunnels = new SecureTunnelPool();