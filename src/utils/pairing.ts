/**
 * Desktop pairing QR parsing.
 *
 * One URI, no version field, no token:
 *
 *   tron://pair?url=<baseUrl>&name=<machineName>&product=tron&productName=Tron
 *     &node=<nodeId>&key=<base64url node public key>&kid=<fingerprint>
 *     &ticket=<short-lived ticket>
 *
 * The node public key is pinned here and verified against `kid`; the ticket is
 * only passed to the first Noise `auth` frame and is never persisted.
 */
import { normalizeBaseUrl, transportForBaseUrl, type NodeTransport } from "../api/client";
import { TRON_PRODUCT_CODE, TRON_PRODUCT_NAME } from "../api/tron";
import {
  base64UrlToBytes,
  isValidKeyId,
  keyIdsMatch,
  nodeKeyId,
} from "../crypto/keys";
import { formatMessage, translate } from "../i18n";

export interface PairingInfo {
  /** Preferred endpoint; LAN when present, otherwise public. */
  baseUrl: string;
  /** LAN endpoint from the QR (`lan` field or an http `url`). */
  lanBaseUrl?: string;
  /** Public endpoint from the QR (`public` field or an https `url`). */
  publicBaseUrl?: string;
  /** `https` -> public (WSS), `http` -> LAN (WS). */
  transport: NodeTransport;
  machineName?: string;
  productCode: string;
  productName: string;
  nodeId: string;
  /** base64url-encoded node static X25519 public key. */
  nodeKey: string;
  /** `sha256:<16 hex>` fingerprint computed from the node key. */
  keyId: string;
  /** One-time pairing ticket (300s TTL on the desktop). */
  ticket: string;
}

const PRODUCT_CODE_PATTERN = /^[a-z0-9.-]+$/;

/** Matches both the protocol URI (`tron://pair`) and the app scheme alias. */
const PAIRING_URI_PATTERN = /^(?:tron|personai):\/\/pair(?:[/?]|$)/i;

export function isValidProductCode(value: string): boolean {
  return PRODUCT_CODE_PATTERN.test(value);
}

function decodeQueryPart(value: string): string {
  // The desktop pairing URI is generated with form-style query encoding,
  // where a literal '+' represents a space.
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    throw new Error(translate("二维码中的参数编码无效"));
  }
}

function parseQuery(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!query) return params;
  for (const part of query.split("&")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    const rawKey = separator >= 0 ? part.slice(0, separator) : part;
    const rawValue = separator >= 0 ? part.slice(separator + 1) : "";
    if (!rawKey) continue;
    params[decodeQueryPart(rawKey)] = decodeQueryPart(rawValue);
  }
  return params;
}

/** True when the scanned/pasted text looks like a pairing URI. */
export function isPairingUri(raw: string): boolean {
  return PAIRING_URI_PATTERN.test(raw.trim());
}

/**
 * Parses the desktop pairing QR code.
 *
 * Both transports require a node public key: the Noise tunnel pins it and the
 * `kid` fingerprint must match, otherwise pairing is rejected.
 */
export function parsePairingUri(raw: string): PairingInfo {
  const value = raw.trim();
  if (!PAIRING_URI_PATTERN.test(value)) {
    throw new Error(translate("这不是 Tron 的配对二维码"));
  }

  const queryStart = value.indexOf("?");
  const query = queryStart >= 0 ? value.slice(queryStart + 1) : "";
  const params = parseQuery(query.split("#")[0] ?? "");

  if (!params.url) throw new Error(translate("二维码缺少节点地址"));
  if (!params.node) throw new Error(translate("二维码缺少节点 ID"));
  if (!params.key) throw new Error(translate("二维码缺少节点公钥"));
  if (!params.kid) throw new Error(translate("二维码缺少节点公钥指纹"));
  if (!params.ticket) throw new Error(translate("二维码缺少一次性配对票据"));

  const primaryUrl = normalizeBaseUrl(params.url);
  const lanBaseUrl = params.lan
    ? normalizeBaseUrl(params.lan)
    : /^http:\/\//i.test(primaryUrl)
      ? primaryUrl
      : undefined;
  const publicBaseUrl = params.public
    ? normalizeBaseUrl(params.public)
    : /^https:\/\//i.test(primaryUrl)
      ? primaryUrl
      : undefined;
  if (lanBaseUrl && !/^http:\/\//i.test(lanBaseUrl)) {
    throw new Error(translate("二维码中的局域网地址无效"));
  }
  if (publicBaseUrl && !/^https:\/\//i.test(publicBaseUrl)) {
    throw new Error(translate("二维码中的公网地址无效"));
  }
  const baseUrl = lanBaseUrl ?? publicBaseUrl ?? primaryUrl;
  const transport = transportForBaseUrl(baseUrl);

  let nodeKeyBytes: Uint8Array;
  try {
    nodeKeyBytes = base64UrlToBytes(params.key);
  } catch {
    throw new Error(translate("二维码中的节点公钥格式无效"));
  }
  if (nodeKeyBytes.length !== 32) {
    throw new Error(translate("二维码中的节点公钥长度无效"));
  }
  const computedKeyId = nodeKeyId(nodeKeyBytes);
  if (!isValidKeyId(params.kid) || !keyIdsMatch(params.kid, computedKeyId)) {
    throw new Error(
      formatMessage("节点公钥指纹不匹配：二维码声明 {expected}，实际 {actual}", {
        expected: params.kid,
        actual: computedKeyId,
      }),
    );
  }

  const productCode = (params.product || TRON_PRODUCT_CODE)
    .trim()
    .toLowerCase();
  if (!isValidProductCode(productCode)) {
    throw new Error(translate("二维码中的产品编码无效"));
  }
  const productName =
    params.productName?.trim() ||
    (productCode === TRON_PRODUCT_CODE ? TRON_PRODUCT_NAME : productCode);

  return {
    baseUrl,
    lanBaseUrl,
    publicBaseUrl,
    transport,
    machineName: params.name?.trim() || undefined,
    productCode,
    productName,
    nodeId: params.node.trim(),
    nodeKey: params.key.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    keyId: params.kid.trim().toLowerCase(),
    ticket: params.ticket.trim(),
  };
}