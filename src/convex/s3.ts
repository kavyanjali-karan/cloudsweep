import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  classify,
  mulberry32,
  savingsForPrice,
  STORAGE_USD_PER_GB_MONTH,
  type S3Object,
} from "./waste";

/**
 * CloudSweep demo bucket scan — a deterministic mock S3 bucket (150 objects)
 * so the product can be explored without AWS keys. Classification and cost
 * math are identical to real-bucket scans (see ./waste.ts).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_NAME = "cloudsweep-demo-bucket";

type DemoFile = S3Object;

function generateDemoFiles(now: number): DemoFile[] {
  const rand = mulberry32(1337);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const gb = (n: number) => Math.round(n * 1e9);
  const mb = (n: number) => Math.round(n * 1e6);
  const daysAgo = (min: number, max: number) => Math.floor(min + rand() * (max - min));
  const files: DemoFile[] = [];

  const push = (name: string, size: number, ageDays: number) =>
    files.push({ name, size, lastModified: now - ageDays * DAY_MS });

  // 25 logs — some zero-byte (failed log ship), many stale
  for (let i = 0; i < 25; i++) {
    const name = pick([
      `logs/app-2024-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}.log`,
      `logs/error-worker-${i}.log`,
      `logs/nginx-access-${i}.gz`,
    ]);
    push(name, i % 9 === 0 ? 0 : gb(0.05 + rand() * 2.5), daysAgo(30, 700));
  }

  // 30 backups — large and frequently ancient
  for (let i = 0; i < 30; i++) {
    const name = pick([
      `backups/db-full-202${3 + Math.floor(rand() * 2)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}.bak`,
      `backups/s3-sync-${i}.tar.gz`,
      `backups/etl-${i}.snapshot`,
    ]);
    push(name, i % 15 === 0 ? 0 : gb(2 + rand() * 38), daysAgo(200, 900));
  }

  // 20 tmp — classic never-cleaned temp junk, incl. failed multipart uploads
  for (let i = 0; i < 20; i++) {
    const name = pick([
      `tmp/upload_${Math.floor(rand() * 1e6)}.tmp`,
      `tmp/cache-${i}.bin`,
      `tmp/part-${i}.part`,
    ]);
    push(name, i % 6 === 0 ? 0 : gb(0.1 + rand() * 8), daysAgo(1, 90));
  }

  // 45 data — the "real" files that should mostly survive
  for (let i = 0; i < 45; i++) {
    const name = pick([
      `data/events-${i}.parquet`,
      `data/orders-${i}.json.gz`,
      `data/customers-${i}.csv`,
    ]);
    push(name, i % 12 === 0 ? 0 : gb(0.2 + rand() * 6), daysAgo(5, 500));
  }

  // 20 media
  for (let i = 0; i < 20; i++) {
    const name = pick([
      `media/banner-${i}.png`,
      `media/clip-${i}.mp4`,
      `media/logo-${i}.svg`,
    ]);
    push(name, mb(1 + rand() * 200), daysAgo(10, 400));
  }

  // 10 misc root objects
  const misc = ["README.md", "deploy.sh", "config-prod.yaml", "notes.md", "schema.sql"];
  for (let i = 0; i < 10; i++) {
    push(misc[i % misc.length], mb(1 + rand() * 5), daysAgo(20, 600));
  }

  return files;
}

/** Scan the demo bucket and return waste findings + savings. */
export const scan = query({
  args: {},
  handler: () => {
    const now = Date.now();
    const files = generateDemoFiles(now);
    const { waste, byReason, bytesByReason, wastedBytes } = classify(files, now);
    const savingsUsd = savingsForPrice(wastedBytes, STORAGE_USD_PER_GB_MONTH);

    return {
      bucket: BUCKET_NAME,
      scannedAt: now,
      totalFiles: files.length,
      wastedFiles: waste.length,
      wastedBytes,
      savingsUsd,
      byReason,
      bytesByReason,
      priceUsdPerGbMonth: STORAGE_USD_PER_GB_MONTH,
      files: waste,
    };
  },
});

/**
 * S3 lifecycle configuration that would automatically clean the found waste.
 * Defaults to the demo bucket's findings; real scans pass their own summary.
 */
export const generateRules = query({
  args: {
    bucket: v.optional(v.string()),
    byReason: v.optional(
      v.object({ junk: v.number(), old: v.number(), temp: v.number() }),
    ),
    bytesByReason: v.optional(
      v.object({ junk: v.number(), old: v.number(), temp: v.number() }),
    ),
    wastedBytes: v.optional(v.number()),
  },
  handler: (ctx, args) => {
    const now = Date.now();
    let byReason = args.byReason;
    let bytesByReason = args.bytesByReason;
    let wastedBytes = args.wastedBytes;

    if (!byReason || !bytesByReason || wastedBytes === undefined) {
      const files: S3Object[] = generateDemoFiles(now);
      const c = classify(files, now);
      byReason = c.byReason;
      bytesByReason = c.bytesByReason;
      wastedBytes = c.wastedBytes;
    }
    const savingsUsd =
      savingsForPrice(wastedBytes, STORAGE_USD_PER_GB_MONTH);

    const lifecycle = {
      Rules: [
        {
          ID: "cloudsweep-expire-temp-files",
          Status: "Enabled",
          Priority: 1,
          Filter: { Prefix: "tmp/" },
          Expiration: { Days: 7 },
        },
        {
          ID: "cloudsweep-expire-stale-logs",
          Status: "Enabled",
          Priority: 2,
          Filter: { Prefix: "logs/" },
          Expiration: { Days: 365 },
        },
        {
          ID: "cloudsweep-expire-stale-backups",
          Status: "Enabled",
          Priority: 3,
          Filter: { Prefix: "backups/" },
          Expiration: { Days: 365 },
        },
        {
          ID: "cloudsweep-abort-incomplete-multipart",
          Status: "Enabled",
          Priority: 4,
          Filter: {},
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
      ],
    };

    return {
      bucket: args.bucket ?? BUCKET_NAME,
      generatedAt: now,
      estimatedMonthlySavingsUsd: savingsUsd,
      wasteSummary: {
        zeroByteJunk: { count: byReason.junk, bytes: bytesByReason.junk },
        oldBackupsLogs: { count: byReason.old, bytes: bytesByReason.old },
        tempFiles: { count: byReason.temp, bytes: bytesByReason.temp },
      },
      lifecycle,
    };
  },
});
