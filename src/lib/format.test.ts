import { describe, test, expect } from "bun:test";
import { formatAge, formatBytes, formatDate, formatUsd } from "./format";

describe("formatBytes", () => {
  test("handles the boundary cases", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(2.5e9)).toBe("2.3 GB");
  });
});

describe("formatUsd", () => {
  test("uses 4 decimals for sub-dollar values", () => {
    expect(formatUsd(0.5)).toBe("$0.5000");
    expect(formatUsd(0.00099)).toBe("$0.0010");
  });

  test("uses 2 decimals otherwise", () => {
    expect(formatUsd(11.0229)).toBe("$11.02");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("formatAge", () => {
  const now = new Date(2026, 8, 27, 12, 0, 0).getTime(); // Sep 27 2026 local
  const daysAgo = (n: number) => now - n * 86_400_000;

  test("relative buckets", () => {
    expect(formatAge(now, now)).toBe("today");
    expect(formatAge(daysAgo(1), now)).toBe("1 day ago");
    expect(formatAge(daysAgo(12), now)).toBe("12 days ago");
    expect(formatAge(daysAgo(100), now)).toBe("3 mo ago");
    expect(formatAge(daysAgo(800), now)).toBe("2 yrs ago");
  });
});

describe("formatDate", () => {
  test("formats as 'Mon D, YYYY' in the local timezone", () => {
    expect(formatDate(new Date(2024, 0, 5).getTime())).toBe("Jan 5, 2024");
    expect(formatDate(new Date(2025, 11, 31).getTime())).toBe("Dec 31, 2025");
  });
});
