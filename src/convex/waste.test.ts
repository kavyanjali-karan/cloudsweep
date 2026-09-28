import { describe, test, expect } from "bun:test";
import {
  classify,
  REASON_LABELS,
  savingsForPrice,
  STORAGE_USD_PER_GB_MONTH,
  WASTE_RULES,
  type S3Object,
} from "./waste";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // fixed epoch so tests are deterministic
const GB = 1e9;

function obj(partial: Partial<S3Object> & { name: string }): S3Object {
  return {
    size: 1024,
    lastModified: NOW - 30 * DAY,
    ...partial,
  };
}

describe("classify — waste rules", () => {
  test("zero-size files are junk, regardless of name or age", () => {
    const { waste } = classify(
      [obj({ name: "tmp/empty.tmp", size: 0 }), obj({ name: "backups/new.bak", size: 0 })],
      NOW,
    );
    expect(waste.map((w) => w.reason)).toEqual(["junk", "junk"]);
  });

  test("backups and logs older than 365 days are flagged", () => {
    const { waste } = classify(
      [
        obj({ name: "backups/db.bak", lastModified: NOW - 366 * DAY }),
        obj({ name: "logs/app.log", lastModified: NOW - 400 * DAY }),
      ],
      NOW,
    );
    expect(waste.map((w) => w.reason)).toEqual(["old", "old"]);
  });

  test("recent backups/logs are NOT flagged (365-day boundary)", () => {
    const { waste } = classify(
      [
        obj({ name: "backups/db.bak", lastModified: NOW - 364 * DAY }),
        obj({ name: "logs/app.log", lastModified: NOW - 100 * DAY }),
      ],
      NOW,
    );
    expect(waste).toHaveLength(0);
  });

  test("temp files are flagged by name at any age", () => {
    const { waste } = classify(
      [
        obj({ name: "tmp/cache.tmp", lastModified: NOW - 1 * DAY }),
        obj({ name: "tmp/old.bin", lastModified: NOW - 900 * DAY }),
      ],
      NOW,
    );
    expect(waste.map((w) => w.reason)).toEqual(["temp", "temp"]);
  });

  test("old non-backup files are NOT flagged (no keyword match)", () => {
    const { waste } = classify(
      [obj({ name: "data/events.parquet", lastModified: NOW - 800 * DAY })],
      NOW,
    );
    expect(waste).toHaveLength(0);
  });

  test("keyword matching is case-insensitive", () => {
    const { waste } = classify(
      [
        obj({ name: "Backups/DB.BAK", lastModified: NOW - 400 * DAY }),
        obj({ name: "TMP/x.TMP", lastModified: NOW - 5 * DAY }),
      ],
      NOW,
    );
    expect(waste.map((w) => w.reason)).toEqual(["old", "temp"]);
  });

  test("zero-byte takes precedence over other rules", () => {
    const { waste } = classify(
      [obj({ name: "tmp/empty.tmp", size: 0 })],
      NOW,
    );
    expect(waste[0].reason).toBe("junk");
    expect(waste[0].reasonLabel).toBe(REASON_LABELS.junk);
  });
});

describe("classify — cost math", () => {
  test("wasteUsd = GB x $0.023 per GB-month", () => {
    const { waste } = classify(
      [obj({ name: "backups/big.bak", size: 2.5 * GB, lastModified: NOW - 400 * DAY })],
      NOW,
    );
    expect(waste[0].wasteUsd).toBeCloseTo(2.5 * STORAGE_USD_PER_GB_MONTH, 6);
  });

  test("results are sorted by waste cost, descending", () => {
    const { waste } = classify(
      [
        obj({ name: "tmp/small.tmp", size: 0.1 * GB, lastModified: NOW - 1 * DAY }),
        obj({ name: "backups/huge.bak", size: 10 * GB, lastModified: NOW - 400 * DAY }),
        obj({ name: "logs/mid.log", size: 1 * GB, lastModified: NOW - 500 * DAY }),
      ],
      NOW,
    );
    const costs = waste.map((w) => w.wasteUsd);
    expect([...costs].sort((a, b) => b - a)).toEqual(costs);
  });

  test("totals aggregate counts and bytes per reason", () => {
    const { byReason, bytesByReason, wastedBytes, waste } = classify(
      [
        obj({ name: "tmp/a.tmp", size: 1 * GB }),
        obj({ name: "tmp/b.tmp", size: 2 * GB }),
        obj({ name: "backups/c.bak", size: 3 * GB, lastModified: NOW - 400 * DAY }),
        obj({ name: "data/keep.csv", size: 100 * GB }),
      ],
      NOW,
    );
    expect(waste).toHaveLength(3);
    expect(byReason).toEqual({ junk: 0, old: 1, temp: 2 });
    expect(bytesByReason.temp).toBe(3 * GB);
    expect(wastedBytes).toBe(6 * GB);
  });

  test("empty bucket produces zeroed totals", () => {
    const { waste, byReason, wastedBytes } = classify([], NOW);
    expect(waste).toHaveLength(0);
    expect(byReason).toEqual({ junk: 0, old: 0, temp: 0 });
    expect(wastedBytes).toBe(0);
  });
});

describe("savingsForPrice — storage-class re-pricing", () => {
  test("S3 Standard price", () => {
    expect(savingsForPrice(GB, 0.023)).toBe(0.023);
  });

  test("Deep Archive price (results are quoted to 4 decimal places)", () => {
    expect(savingsForPrice(10 * GB, 0.00099)).toBe(0.0099);
    expect(savingsForPrice(GB, 0.00099)).toBe(0.001); // rounds 0.00099 → 4dp
  });

  test("zero waste is free", () => {
    expect(savingsForPrice(0, 0.023)).toBe(0);
  });
});

describe("WASTE_RULES metadata (rendered in the UI)", () => {
  test("covers exactly the three reasons the classifier emits", () => {
    expect(WASTE_RULES.map((r) => r.reason).sort()).toEqual([
      "junk",
      "old",
      "temp",
    ]);
    expect(Object.keys(REASON_LABELS).sort()).toEqual(["junk", "old", "temp"]);
  });

  test("every rule documents its condition and rationale", () => {
    for (const r of WASTE_RULES) {
      expect(r.rule.length).toBeGreaterThan(5);
      expect(r.rationale.length).toBeGreaterThan(20);
    }
  });
});
