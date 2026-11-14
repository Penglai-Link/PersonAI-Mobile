import { isSecureBaseUrl, normalizeBaseUrl } from "../api/client";
import { TRON_PRODUCT_CODE, TRON_PRODUCT_NAME } from "../api/tron";

export interface PairingInfo {
  /** Pairing protocol version encoded in the QR code. */
  version: 1 | 2;
  baseUrl: string;
  /** Long-lived pairing token; only used for the JWT exchange. */
  token: string;
  machineName?: string;
  productCode: string;
  productName: string;
  nodeId: string | null;
  /** Whether the desktop marked this pairing as HTTPS-only. */
  secure: boolean;
}

const PRODUCT_CODE_PATTERN = /^[a-z0-9.-]+$/;

export function isValidProductCode(value: string): boolean {
  return PRODUCT_CODE_PATTERN.test(value);
}

function decodeQueryPart(value: string): string {
  // The desktop pairing URI is generated with form-style query encoding,
  // where a literal '+' represents a space.
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    throw new Error("二维码中的参数编码无效");
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

function parseSecureFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "secure"].includes(normalized)) return true;
  if (["0", "false", "no", "insecure"].includes(normalized)) return false;
  return fallback;
}

/**
 * Parses the desktop pairing QR code.
 *
 * v2: `tron://pair?v=2&url=<baseUrl>&token=<token>&name=<machineName>&product=tron&productName=Tron&node=<nodeId>&secure=1`
 * v1: `tron://pair?v=1&url=<baseUrl>&token=<token>&name=<machineName>`
 *
 * v1 codes carry no product/node/secure fields: they are treated as Tron and
 * their security flag is inferred from the URL scheme.
 */
export function parsePairingUri(raw: string): PairingInfo {
  const value = raw.trim();
  if (!/^tron:\/\/pair(?:[/?]|$)/i.test(value)) {
    throw new Error("这不是 Tron 的配对二维码");
  }

  const queryStart = value.indexOf("?");
  const query = queryStart >= 0 ? value.slice(queryStart + 1) : "";
  const params = parseQuery(query.split("#")[0] ?? "");

  const version = params.v ? Number(params.v) : 1;
  if (version !== 1 && version !== 2) {
    throw new Error(`不支持的配对协议版本：${params.v}`);
  }
  if (!params.url) throw new Error("二维码缺少节点地址");
  if (!params.token) throw new Error("二维码缺少配对令牌");

  const baseUrl = normalizeBaseUrl(params.url);
  const productCode = (params.product || TRON_PRODUCT_CODE)
    .trim()
    .toLowerCase();
  if (!isValidProductCode(productCode)) {
    throw new Error("二维码中的产品编码无效");
  }
  const productName =
    params.productName?.trim() ||
    (productCode === TRON_PRODUCT_CODE ? TRON_PRODUCT_NAME : productCode);

  const urlIsSecure = isSecureBaseUrl(baseUrl);
  const secure =
    version === 2
      ? parseSecureFlag(params.secure, urlIsSecure)
      : urlIsSecure;

  return {
    version,
    baseUrl,
    token: params.token,
    machineName: params.name?.trim() || undefined,
    productCode,
    productName,
    nodeId: params.node?.trim() || null,
    secure,
  };
}