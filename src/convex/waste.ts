/**
 * CloudSweep core waste logic — shared by the demo scan (s3.ts) and real S3
 * scans (scanBucket.ts).
 *
 * Waste rules:
 *   - size === 0                          → "junk" (zero-byte junk file)
 *   - older than 365d AND /backup|log/i   → "old"  (>1 year old backup/log)
 *   - /tmp/i in the key                   → "temp" (temp file never cleaned)
 *
 * Cost math: $0.023 per GB per month (S3 Standard, us-east-1) on wasted bytes.
 */

export const STORAGE_USD_PER_GB_MONTH = 0.023;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type WasteReason = "junk" | "old" | "temp";

/** Minimal object shape both the mock generator and AWS results map into. */
export interface S3Object {
  name: string;
  size: number; // bytes
  lastModified: number; // epoch ms
}

export interface WasteFile {
  name: string;
  size: number;
  lastModified: number;
  reason: WasteReason;
  reasonLabel: string;
  wasteUsd: number;
}

export const REASON_LABELS: Record<WasteReason, string> = {
  junk: "0-byte junk file",
  old: "Backup/log >1yr old",
  temp: "Temp file never cleaned",
};

/**
 * The waste heuristics, in one place — the UI renders this metadata directly
 * ("How savings are calculated" section), so the docs can never drift from
 * the logic below in `classify()`.
 */
export const WASTE_RULES = [
  {
    reason: "junk" as const,
    title: "Zero-byte junk",
    rule: "size = 0 bytes",
    rationale:
      "Failed uploads, interrupted multipart transfers and empty logs. They pay request fees, mask real errors, and store nothing of value.",
  },
  {
    reason: "old" as const,
    title: "Stale backups & logs",
    rule: "last modified > 365 days AND name contains 'backup' or 'log'",
    rationale:
      "Most retention policies expire backups and logs within a year. Older than that, they are almost never restored — but still billed every month.",
  },
  {
    reason: "temp" as const,
    title: "Temp files",
    rule: "name contains 'tmp'",
    rationale:
      "Scratch files that were never cleaned up. The classic S3 bill filler — jobs crash, nobody sweeps the prefix, storage quietly accumulates.",
  },
];

export const REASON_ORDER: WasteReason[] = ["junk", "old", "temp"];

export interface Classification {
  waste: WasteFile[];
  byReason: Record<WasteReason, number>;
  bytesByReason: Record<WasteReason, number>;
  wastedBytes: number;
}

/** Tiny deterministic PRNG (mulberry32) — every demo scan returns the same 150 objects. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function classify(files: S3Object[], now: number): Classification {
  const waste: WasteFile[] = [];
  const byReason: Record<WasteReason, number> = { junk: 0, old: 0, temp: 0 };
  const bytesByReason: Record<WasteReason, number> = { junk: 0, old: 0, temp: 0 };
  let wastedBytes = 0;

  for (const f of files) {
    const ageDays = (now - f.lastModified) / DAY_MS;
    let reason: WasteReason | null = null;
    if (f.size === 0) reason = "junk";
    else if (ageDays > 365 && /backup|log/i.test(f.name)) reason = "old";
    else if (/tmp/i.test(f.name)) reason = "temp";
    if (reason === null) continue;

    const wasteUsd = Math.round((f.size / 1e9) * STORAGE_USD_PER_GB_MONTH * 1e6) / 1e6;
    waste.push({
      name: f.name,
      size: f.size,
      lastModified: f.lastModified,
      reason,
      reasonLabel: REASON_LABELS[reason],
      wasteUsd,
    });
    byReason[reason] += 1;
    bytesByReason[reason] += f.size;
    wastedBytes += f.size;
  }

  waste.sort((a, b) => b.wasteUsd - a.wasteUsd || b.size - a.size);
  return { waste, byReason, bytesByReason, wastedBytes };
}

/** Re-price a scan's savings for a different S3 storage-class price. */
export function savingsForPrice(wastedBytes: number, usdPerGbMonth: number): number {
  return (
    Math.round((wastedBytes / 1e9) * usdPerGbMonth * 1e4) / 1e4
  );
}
