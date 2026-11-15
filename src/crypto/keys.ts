/**
 * Device key material and key fingerprints.
 *
 * Each phone keeps one X25519 static key per paired node, generated on first
 * pairing and stored in SecureStore under `personai.devicekey.<nodeId>`. The
 * desktop only ever learns the public half; the private key never leaves the
 * device.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { x25519 } from "@noble/curves/ed25519.js";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { utf8Encode } from "./framing";
import { sha256Bytes } from "./noise";

export const DEVICE_KEY_PREFIX = "personai.devicekey.";
const WEB_DEVICE_KEY_PREFIX = "@personai/secure-devicekey/";
const DEVICE_KEY_LABEL = "personai-device-key";
const NODE_KEY_LABEL = "tron-node-key";

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface DeviceKey {
  /** Node this key belongs to (`nodeId` from the pairing QR code). */
  nodeId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  /** `sha256:<16 hex chars>` fingerprint of the device public key. */
  keyId: string;
  /** False when SecureStore was unavailable and the key only lives in memory. */
  persisted: boolean;
  /** True on the web preview where SecureStore is emulated by AsyncStorage. */
  insecure: boolean;
}

/** Cross-platform CSPRNG; `expo-crypto` uses the platform's secure RNG. */
export function randomBytes(length: number): Uint8Array {
  return getRandomBytes(length);
}

export function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase().replace(/^0x/, "");
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/.test(normalized)) {
    throw new Error("invalid hex key");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : -1;
    const third = index + 2 < bytes.length ? bytes[index + 2] : -1;
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | (second >= 0 ? second >> 4 : 0)];
    if (second >= 0) {
      output +=
        BASE64_ALPHABET[((second & 0x0f) << 2) | (third >= 0 ? third >> 6 : 0)];
    }
    if (third >= 0) output += BASE64_ALPHABET[third & 0x3f];
  }
  return output.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("invalid base64url value");
  }
  const bits: number[] = [];
  for (const char of normalized) {
    if (char === "=") break;
    const position = BASE64_ALPHABET.indexOf(char);
    if (position < 0) throw new Error("invalid base64url value");
    for (let offset = 5; offset >= 0; offset -= 1) {
      bits.push((position >> offset) & 1);
    }
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | bits[index + offset];
    }
    bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

function fingerprint(label: string, publicKey: Uint8Array): string {
  const prefix = utf8Encode(label);
  const prefixed = new Uint8Array(prefix.length + publicKey.length);
  prefixed.set(prefix, 0);
  prefixed.set(publicKey, prefix.length);
  const digest = sha256Bytes(prefixed);
  return `sha256:${bytesToHex(digest).slice(0, 16)}`;
}

/** `kid = "sha256:" + lowercase_hex(SHA-256("tron-node-key" || publicKey))[0:16]`. */
export function nodeKeyId(publicKey: Uint8Array): string {
  return fingerprint(NODE_KEY_LABEL, publicKey);
}

/** Stable fingerprint for this device's public key (registered on the node). */
export function deviceKeyId(publicKey: Uint8Array): string {
  return fingerprint(DEVICE_KEY_LABEL, publicKey);
}

/** Case-insensitive comparison of two `sha256:...` fingerprints. */
export function keyIdsMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function isValidKeyId(value: string): boolean {
  return /^sha256:[0-9a-f]{16,128}$/i.test(value.trim());
}

function storageKey(nodeId: string): string {
  return `${DEVICE_KEY_PREFIX}${nodeId}`;
}

interface StoredDeviceKey {
  privateKey: string;
  publicKey: string;
  keyId: string;
  createdAt: string;
}

function parseStoredDeviceKey(nodeId: string, raw: string): DeviceKey | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDeviceKey>;
    if (typeof parsed.privateKey !== "string" || typeof parsed.publicKey !== "string") {
      return null;
    }
    const privateKey = base64UrlToBytes(parsed.privateKey);
    const publicKey = base64UrlToBytes(parsed.publicKey);
    if (privateKey.length !== 32 || publicKey.length !== 32) return null;
    return {
      nodeId,
      privateKey,
      publicKey,
      keyId:
        typeof parsed.keyId === "string" && parsed.keyId
          ? parsed.keyId
          : deviceKeyId(publicKey),
      persisted: true,
      insecure: Platform.OS === "web",
    };
  } catch {
    return null;
  }
}

async function readRaw(nodeId: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(`${WEB_DEVICE_KEY_PREFIX}${nodeId}`);
  }
  return SecureStore.getItemAsync(storageKey(nodeId));
}

async function writeRaw(nodeId: string, value: string): Promise<boolean> {
  if (Platform.OS === "web") {
    // SecureStore has no web implementation. The web build is a preview target
    // only; the key is kept in memory if storage is unavailable.
    try {
      await AsyncStorage.setItem(`${WEB_DEVICE_KEY_PREFIX}${nodeId}`, value);
      return true;
    } catch {
      return false;
    }
  }
  await SecureStore.setItemAsync(storageKey(nodeId), value);
  return true;
}

export async function loadDeviceKey(nodeId: string): Promise<DeviceKey | null> {
  try {
    const raw = await readRaw(nodeId);
    if (!raw) return null;
    return parseStoredDeviceKey(nodeId, raw);
  } catch {
    return null;
  }
}

const memoryKeys = new Map<string, DeviceKey>();

/**
 * Loads the device key for a node, generating and persisting one on first use.
 * Storage failures degrade to an in-memory key; the caller can expose the
 * `persisted`/`insecure` flags in the UI.
 */
export async function ensureDeviceKey(nodeId: string): Promise<DeviceKey> {
  const cached = memoryKeys.get(nodeId);
  if (cached) return cached;
  const stored = await loadDeviceKey(nodeId);
  if (stored) {
    memoryKeys.set(nodeId, stored);
    return stored;
  }

  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);
  const key: DeviceKey = {
    nodeId,
    privateKey,
    publicKey,
    keyId: deviceKeyId(publicKey),
    persisted: false,
    insecure: Platform.OS === "web",
  };
  const payload: StoredDeviceKey = {
    privateKey: bytesToBase64Url(privateKey),
    publicKey: bytesToBase64Url(publicKey),
    keyId: key.keyId,
    createdAt: new Date().toISOString(),
  };
  try {
    key.persisted = await writeRaw(nodeId, JSON.stringify(payload));
  } catch {
    key.persisted = false;
  }
  memoryKeys.set(nodeId, key);
  return key;
}

export async function deleteDeviceKey(nodeId: string): Promise<void> {
  memoryKeys.delete(nodeId);
  try {
    if (Platform.OS === "web") {
      await AsyncStorage.removeItem(`${WEB_DEVICE_KEY_PREFIX}${nodeId}`);
      return;
    }
    await SecureStore.deleteItemAsync(storageKey(nodeId));
  } catch {
    // Removal is best effort; a stale key is unusable without a valid node.
  }
}