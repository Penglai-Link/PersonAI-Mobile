/**
 * Noise_IK_25519_ChaChaPoly_SHA256 — fixed subset used by the Tron Remote
 * Protocol.
 *
 * Only the initiator side is implemented: the phone always initiates against a
 * desktop responder whose static public key was pinned from the pairing QR
 * code. There is no cipher-suite negotiation and no protocol version field.
 *
 * This is a pure JavaScript port built on `@noble/curves`, `@noble/ciphers` and
 * `@noble/hashes`, so it runs in Hermes and in the browser without native
 * crypto. Randomness is injected by the caller (`expo-crypto`).
 */
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { utf8Encode } from "./framing";

export const NOISE_PROTOCOL_NAME = "Noise_IK_25519_ChaChaPoly_SHA256";
export const NOISE_HASHLEN = 32;
export const NOISE_KEY_LEN = 32;
export const NOISE_TAG_LEN = 16;
export const NOISE_MAX_HANDSHAKE_MESSAGE = 4096;

const EMPTY = new Uint8Array(0);

export class NoiseError extends Error {
  readonly code: string;

  constructor(message: string, code = "REMOTE_HANDSHAKE_FAILED") {
    super(message);
    this.name = "NoiseError";
    this.code = code;
  }
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function nonceBytes(counter: number): Uint8Array {
  // 96-bit nonce: 8-byte little-endian counter followed by four zero bytes.
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  const high = Math.floor(counter / 0x1_0000_0000);
  const low = counter % 0x1_0000_0000;
  // Noise encodes the 64-bit counter as 8 little-endian bytes starting at
  // offset 4 of the 12-byte AEAD nonce (the first 4 bytes stay zero).
  view.setUint32(4, low, true);
  view.setUint32(8, high, true);
  return nonce;
}

/** One direction of the transport (or handshake) cipher. */
export class CipherState {
  private key: Uint8Array | null;
  private nonce = 0;

  constructor(key: Uint8Array | null) {
    this.key = key;
  }

  get hasKey(): boolean {
    return this.key !== null;
  }

  encrypt(associatedData: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (!this.key) return plaintext;
    if (this.nonce >= Number.MAX_SAFE_INTEGER) {
      throw new NoiseError("secure channel nonce exhausted");
    }
    const nonce = nonceBytes(this.nonce);
    this.nonce += 1;
    return chacha20poly1305(this.key, nonce, associatedData).encrypt(plaintext);
  }

  decrypt(associatedData: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (!this.key) return ciphertext;
    if (ciphertext.length < NOISE_TAG_LEN) {
      throw new NoiseError("secure channel message is too short");
    }
    const nonce = nonceBytes(this.nonce);
    this.nonce += 1;
    try {
      return chacha20poly1305(this.key, nonce, associatedData).decrypt(ciphertext);
    } catch {
      throw new NoiseError("secure channel authentication failed");
    }
  }
}

class SymmetricState {
  chainingKey: Uint8Array;
  handshakeHash: Uint8Array;
  cipher: CipherState;

  constructor(protocolName: string) {
    const name = utf8Encode(protocolName);
    this.handshakeHash =
      name.length <= NOISE_HASHLEN
        ? (() => {
            const padded = new Uint8Array(NOISE_HASHLEN);
            padded.set(name, 0);
            return padded;
          })()
        : sha256(name);
    this.chainingKey = this.handshakeHash.slice();
    // Until the first MixKey the handshake uses plaintext (no key set).
    this.cipher = new CipherState(null);
  }

  mixHash(data: Uint8Array): void {
    this.handshakeHash = sha256(concatBytes(this.handshakeHash, data));
  }

  mixKey(input: Uint8Array): void {
    const derived = hkdf(
      sha256,
      input,
      this.chainingKey,
      EMPTY,
      NOISE_HASHLEN * 2,
    );
    this.chainingKey = derived.slice(0, NOISE_HASHLEN);
    this.cipher = new CipherState(derived.slice(NOISE_HASHLEN));
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipher.encrypt(this.handshakeHash, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipher.decrypt(this.handshakeHash, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  split(): { send: CipherState; recv: CipherState } {
    const derived = hkdf(
      sha256,
      EMPTY,
      this.chainingKey,
      EMPTY,
      NOISE_HASHLEN * 2,
    );
    return {
      send: new CipherState(derived.slice(0, NOISE_HASHLEN)),
      recv: new CipherState(derived.slice(NOISE_HASHLEN)),
    };
  }
}

export interface NoiseHandshakeParams {
  /** Pinned desktop static public key (32 bytes). */
  remoteStaticPublic: Uint8Array;
  /** This device's static private key (32 bytes). */
  localStaticPrivate: Uint8Array;
  /** UTF-8 prologue; see `buildPrologue`. */
  prologue: Uint8Array;
  /** Cryptographic randomness from `expo-crypto`. */
  randomBytes: (length: number) => Uint8Array;
}

/**
 * Fixed IK initiator handshake:
 *
 *   -> e, es, s, ss
 *   <- e, ee, se
 *
 * The first message is produced immediately after construction; the second one
 * is verified with the pinned remote static key, and a successful `readMessage2`
 * yields the transport cipher states.
 */
export class NoiseInitiatorHandshake {
  private readonly symmetric: SymmetricState;
  private readonly localStaticPrivate: Uint8Array;
  private readonly localStaticPublic: Uint8Array;
  private readonly remoteStaticPublic: Uint8Array;
  private readonly ephemeralPrivate: Uint8Array;
  private readonly ephemeralPublic: Uint8Array;
  private readonly randomBytes: (length: number) => Uint8Array;
  private state: "fresh" | "wrote" | "read" | "failed" = "fresh";

  constructor(params: NoiseHandshakeParams) {
    if (params.remoteStaticPublic.length !== NOISE_KEY_LEN) {
      throw new NoiseError("pinned node public key has an invalid length");
    }
    if (params.localStaticPrivate.length !== NOISE_KEY_LEN) {
      throw new NoiseError("device private key has an invalid length");
    }
    this.localStaticPrivate = params.localStaticPrivate;
    this.remoteStaticPublic = params.remoteStaticPublic;
    this.localStaticPublic = x25519.getPublicKey(params.localStaticPrivate);
    this.randomBytes = params.randomBytes;

    this.symmetric = new SymmetricState(NOISE_PROTOCOL_NAME);
    this.symmetric.mixHash(params.prologue);
    this.symmetric.mixHash(this.remoteStaticPublic);

    this.ephemeralPrivate = this.randomBytes(NOISE_KEY_LEN);
    this.ephemeralPublic = x25519.getPublicKey(this.ephemeralPrivate);
  }

  /** Builds handshake message 1 (`-> e, es, s, ss`). */
  writeMessage1(payload: Uint8Array = EMPTY): Uint8Array {
    if (this.state !== "fresh") {
      throw new NoiseError("Noise handshake is already in progress");
    }
    this.state = "wrote";

    const symmetric = this.symmetric;
    symmetric.mixHash(this.ephemeralPublic);
    const es = x25519.getSharedSecret(this.ephemeralPrivate, this.remoteStaticPublic);
    symmetric.mixKey(es);
    const encryptedStatic = symmetric.encryptAndHash(this.localStaticPublic);
    const ss = x25519.getSharedSecret(this.localStaticPrivate, this.remoteStaticPublic);
    symmetric.mixKey(ss);
    const encryptedPayload = symmetric.encryptAndHash(payload);

    return concatBytes(this.ephemeralPublic, encryptedStatic, encryptedPayload);
  }

  /** Verifies handshake message 2 (`<- e, ee, se`) and returns its payload. */
  readMessage2(message: Uint8Array): Uint8Array {
    if (this.state !== "wrote") {
      throw new NoiseError("Noise handshake message order is invalid");
    }
    if (message.length > NOISE_MAX_HANDSHAKE_MESSAGE) {
      throw new NoiseError("Noise handshake message exceeds 4096 bytes");
    }
    // 32-byte ephemeral + 16-byte payload tag (the payload itself may be empty).
    if (message.length < NOISE_KEY_LEN + NOISE_TAG_LEN) {
      throw new NoiseError("Noise handshake message is truncated");
    }

    const symmetric = this.symmetric;
    const remoteEphemeral = message.slice(0, NOISE_KEY_LEN);
    symmetric.mixHash(remoteEphemeral);
    const ee = x25519.getSharedSecret(this.ephemeralPrivate, remoteEphemeral);
    symmetric.mixKey(ee);
    const se = x25519.getSharedSecret(this.localStaticPrivate, remoteEphemeral);
    symmetric.mixKey(se);
    const payload = symmetric.decryptAndHash(
      message.slice(NOISE_KEY_LEN),
    );
    this.state = "read";
    return payload;
  }

  /** Returns the two transport cipher states; the initiator sends first. */
  split(): { send: CipherState; recv: CipherState } {
    if (this.state !== "read") {
      throw new NoiseError("Noise handshake did not complete");
    }
    return this.symmetric.split();
  }
}

/**
 * Prologue bytes: `"tron-remote" || 0x00 || nodeId || 0x00 || productCode ||
 * 0x00 || transport`.
 */
export function buildPrologue(parts: {
  nodeId: string;
  productCode: string;
  transport: string;
}): Uint8Array {
  const separator = Uint8Array.from([0x00]);
  return concatBytes(
    utf8Encode("tron-remote"),
    separator,
    utf8Encode(parts.nodeId),
    separator,
    utf8Encode(parts.productCode),
    separator,
    utf8Encode(parts.transport),
  );
}

/** Exposed for key/fingerprint helpers that need a plain SHA-256. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return equalBytes(left, right);
}