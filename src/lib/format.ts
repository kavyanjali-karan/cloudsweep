/**
 * Shared display formatters — single source of truth for how bytes, dollars,
 * dates and ages are rendered across the app (and exercised by unit tests).
 */

/** 1024-based human-readable sizes: B / KB / MB / GB / TB / PB. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/** USD with 4 decimals for sub-dollar values, 2 otherwise. */
export function formatUsd(value: number): string {
  const subDollar = value > 0 && value < 1;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: subDollar ? 4 : 2,
    maximumFractionDigits: subDollar ? 4 : 2,
  }).format(value);
}

/** e.g. "Jan 5, 2024" */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Relative age, e.g. "today", "12 days ago", "3 mo ago", "2 yrs ago". */
export function formatAge(ms: number, now: number = Date.now()): string {
  const days = Math.floor((now - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days > 730) return `${Math.floor(days / 365)} yrs ago`;
  if (days > 60) return `${Math.floor(days / 30)} mo ago`;
  return `${days} days ago`;
}
