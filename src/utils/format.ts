import { ApiError } from "../api/client";
import { formatMessage, translate } from "../i18n";

const pad = (value: number) => String(value).padStart(2, "0");

/** Accepts ISO strings, epoch milliseconds and epoch-second strings from the API. */
export function parseTimestamp(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value < 1_000_000_000_000 ? value * 1_000 : value);
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatRelativeTime(value: string | number | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return "—";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 45_000) return translate("刚刚");
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return formatMessage("{count} 分钟前", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatMessage("{count} 小时前", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return formatMessage("{count} 天前", { count: days });
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatNodeCount(count: number): string {
  if (count === 1) return translate("1 个节点");
  return formatMessage("{count} 个节点", { count });
}

export function formatDateTime(value: string | number | null | undefined): string {
  const date = parseTimestamp(value);
  if (!date) return translate("尚未连接");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof ApiError && error.code === "ABORTED") return true;
  return (
    error.name === "AbortError" ||
    /aborted|cancelled|canceled|请求已取消|已停止接收回复/i.test(error.message)
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return translate(error.message || "连接超时，请检查电脑地址和网络");
    }
    if (error.name === "ApiError") {
      return translate(error.message || "请求失败，请稍后重试");
    }
    if (
      /network request failed|failed to fetch|network error|load failed/i.test(
        error.message,
      )
    ) {
      return translate(
        "无法连接电脑，请确认地址正确、电脑在线且与手机在同一网络",
      );
    }
    return translate(error.message || "发生未知错误");
  }
  return translate("发生未知错误");
}

export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}${"•".repeat(8)}${token.slice(-4)}`;
}