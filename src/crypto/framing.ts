/**
 * Tron Remote Protocol framing helpers.
 *
 * One WebSocket binary frame is one Noise transport message. Its plaintext is a
 * single UTF-8 JSON envelope. This module owns that JSON shape, the UTF-8
 * helpers used by the Noise layer, and fragment reassembly for oversized
 * results.
 */

/** A single Noise plaintext may not exceed 48 KiB (protocol limit). */
export const MAX_PLAINTEXT_BYTES = 48 * 1024;
/** One reassembled RPC result may not exceed 4 MiB. */
export const MAX_RESULT_BYTES = 4 * 1024 * 1024;
/** Max in-flight RPC calls before the server answers `REMOTE_BUSY`. */
export const MAX_IN_FLIGHT = 16;

export const REMOTE_PROTOCOL = "tron-remote";
export const REMOTE_SECURE_PATH = "/remote/secure";

export interface RpcCallEnvelope {
  type: "rpc";
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcResultEnvelope {
  type: "rpc_result";
  id: number;
  result?: unknown;
}

export interface RpcErrorEnvelope {
  type: "rpc_error";
  id: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface RpcEventEnvelope {
  type: "rpc_event";
  id: number;
  /** The AG-UI event itself; never re-named or wrapped. */
  data: unknown;
  seq?: number;
}

export interface RpcEndEnvelope {
  type: "rpc_end";
  id: number;
}

export interface RpcCancelEnvelope {
  type: "cancel";
  id: number;
}

export interface RpcFragmentEnvelope {
  type: "fragment";
  id: number;
  seq: number;
  total: number;
  data: string;
}

export interface RpcPingEnvelope {
  type: "ping" | "pong";
  ts: number;
}

/** Session-level control frames carried inside the encrypted channel. */
export interface RpcAuthEnvelope {
  type: "auth";
  ticket?: string;
  deviceId?: string;
  device: {
    name: string;
    platform: string;
    publicKey: string;
    keyId: string;
  };
}

export interface RpcReadyEnvelope {
  type: "ready";
  deviceId: string;
  sessionId: string;
  expiresIn?: number;
  methods: string[];
  product?: {
    productCode?: string;
    productName?: string;
    nodeId?: string;
    version?: string;
    platform?: string;
  };
  events?: string;
  features?: string[];
}

export interface RpcFailureEnvelope {
  type: "error";
  code: string;
  message: string;
  details?: unknown;
}

export type RpcEnvelope =
  | RpcCallEnvelope
  | RpcResultEnvelope
  | RpcErrorEnvelope
  | RpcEventEnvelope
  | RpcEndEnvelope
  | RpcCancelEnvelope
  | RpcFragmentEnvelope
  | RpcPingEnvelope
  | RpcAuthEnvelope
  | RpcReadyEnvelope
  | RpcFailureEnvelope;

const RPC_ENVELOPE_TYPES = new Set<string>([
  "rpc",
  "rpc_result",
  "rpc_error",
  "rpc_event",
  "rpc_end",
  "cancel",
  "fragment",
  "ping",
  "pong",
  "auth",
  "ready",
  "error",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `value` looks like an RPC envelope (only checks the discriminant). */
export function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  return (
    isPlainObject(value) &&
    typeof value.type === "string" &&
    RPC_ENVELOPE_TYPES.has(value.type)
  );
}

export function decodeRpcEnvelope(value: unknown): RpcEnvelope {
  if (!isRpcEnvelope(value)) {
    throw new Error("unexpected remote frame");
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* UTF-8                                                               */
/* ------------------------------------------------------------------ */

/**
 * Hermes does not guarantee a global TextEncoder on every runtime, and the
 * Noise layer needs the exact bytes for prologue/hash inputs, so UTF-8 is
 * implemented here without platform globals.
 */
export function utf8Encode(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index];
    let code: number;
    let extra: number;
    if (first < 0x80) {
      code = first;
      extra = 0;
    } else if ((first & 0xe0) === 0xc0) {
      code = first & 0x1f;
      extra = 1;
    } else if ((first & 0xf0) === 0xe0) {
      code = first & 0x0f;
      extra = 2;
    } else if ((first & 0xf8) === 0xf0) {
      code = first & 0x07;
      extra = 3;
    } else {
      result += "\uFFFD";
      index += 1;
      continue;
    }
    if (index + extra >= bytes.length) {
      result += "\uFFFD";
      break;
    }
    let valid = true;
    for (let offset = 1; offset <= extra; offset += 1) {
      const next = bytes[index + offset];
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (next & 0x3f);
    }
    if (!valid) {
      result += "\uFFFD";
      index += 1;
      continue;
    }
    index += extra + 1;
    if (code <= 0xffff) {
      result += String.fromCharCode(code);
    } else {
      const adjusted = code - 0x10000;
      result += String.fromCharCode(
        0xd800 + (adjusted >> 10),
        0xdc00 + (adjusted & 0x3ff),
      );
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Envelope codec                                                      */
/* ------------------------------------------------------------------ */

export function encodeRpcEnvelope(envelope: RpcEnvelope): Uint8Array {
  const bytes = utf8Encode(JSON.stringify(envelope));
  if (bytes.length > MAX_PLAINTEXT_BYTES) {
    throw new Error("remote frame too large");
  }
  return bytes;
}

export function decodeRpcEnvelopeBytes(bytes: Uint8Array): RpcEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(bytes));
  } catch {
    throw new Error("remote frame is not valid JSON");
  }
  return decodeRpcEnvelope(parsed);
}

/* ------------------------------------------------------------------ */
/* Fragments                                                           */
/* ------------------------------------------------------------------ */

interface FragmentState {
  total: number;
  nextSeq: number;
  chunks: string[];
  size: number;
}

/**
 * Reassembles `fragment` envelopes. Chunks are plain JSON string slices; the
 * concatenation is parsed back into the original envelope and dispatched as if
 * it had arrived in one frame.
 */
export class FragmentAssembler {
  private readonly states = new Map<number, FragmentState>();

  push(fragment: RpcFragmentEnvelope): RpcEnvelope | null {
    const { id, seq, total, data } = fragment;
    if (!Number.isInteger(total) || total <= 0 || total > 4096) {
      throw new Error("invalid remote fragment count");
    }
    if (!Number.isInteger(seq) || seq < 0 || seq >= total) {
      throw new Error("invalid remote fragment index");
    }
    if (typeof data !== "string") throw new Error("invalid remote fragment payload");

    let state = this.states.get(id);
    if (!state) {
      if (seq !== 0) throw new Error("remote fragment sequence started late");
      state = { total, nextSeq: 0, chunks: [], size: 0 };
      this.states.set(id, state);
    }
    if (state.total !== total || state.nextSeq !== seq) {
      this.states.delete(id);
      throw new Error("remote fragment sequence mismatch");
    }
    state.chunks.push(data);
    state.size += data.length;
    state.nextSeq += 1;
    if (state.size > MAX_RESULT_BYTES) {
      this.states.delete(id);
      throw new Error("remote fragment result too large");
    }
    if (state.nextSeq < state.total) return null;

    this.states.delete(id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(state.chunks.join(""));
    } catch {
      throw new Error("remote fragment is not valid JSON");
    }
    return decodeRpcEnvelope(parsed);
  }

  reset(id?: number): void {
    if (id === undefined) this.states.clear();
    else this.states.delete(id);
  }
}