# CloudSweep — AWS S3 Waste & Cost Finder

Find the S3 objects you pay for and never use. CloudSweep scans a bucket, flags
zero-byte junk, stale backups/logs and never-cleaned temp files, and prices the
waste in dollars per month using AWS's published storage prices.

## What it does

1. **Scan Demo Bucket** — explore the full product against a deterministic
   150-object mock bucket. No AWS account needed (clearly labeled as demo data).
2. **Scan Your Bucket** — paste a read-only access key and scan a real bucket
   with the S3 `ListObjectsV2` API (paged, capped at 10,000 keys per scan).
3. Review per-object waste, re-price savings across S3 storage classes, filter
   findings by category, and copy ready-to-apply S3 lifecycle rules as JSON.

## How savings are calculated (methodology)

The rules live in exactly one place — [`src/convex/waste.ts`](src/convex/waste.ts) —
and the UI renders them directly from that module, so the documentation shown to
users can never drift from the code that runs.

| Category      | Rule                                                        | Why it's waste                                                              |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Zero-byte junk | `size = 0 bytes`                                            | Failed uploads and empty logs — request fees, zero value, masks real errors |
| Stale backups & logs | `lastModified > 365 days` **and** name contains `backup` / `log` (case-insensitive) | Most retention policies expire these within a year; older copies are almost never restored but billed every month |
| Temp files    | name contains `tmp` (case-insensitive, any age)             | Scratch files nobody swept — the classic S3 bill filler                     |

**Cost math:** `savings = wasted GB × storage-class price per GB-month`,
defaulting to S3 Standard at **$0.023/GB-month** (us-east-1 list price). The UI
can re-price the same scan across Standard-IA, Glacier Instant Retrieval,
Glacier Flexible Retrieval and Deep Archive using
[AWS's published prices](https://aws.amazon.com/s3/pricing/).

These are transparent heuristics, not AWS recommendations — verify flagged
objects before deleting anything.

## Architecture

```
src/
├── pages/Landing.tsx        # the whole single-page UI (scan, metrics, table, rules dialog)
├── convex/
│   ├── waste.ts             # core logic: rules, classification, cost math (unit-tested)
│   ├── s3.ts                # demo bucket scan (deterministic seeded generator) + rules query
│   ├── scanBucket.ts        # real S3 scan: "use node" action, @aws-sdk/client-s3
│   └── http.ts              # REST endpoints: GET /health, /s3/scan, /s3/rules (CORS)
├── lib/format.ts            # shared display formatters (unit-tested)
└── components/ui/           # only the shadcn/ui components actually used
```

- **Frontend:** React 19, Vite, Tailwind v4, shadcn/ui. Single page, no auth.
- **Backend:** Convex queries/actions with generated typed API (`api.s3.*`).
- **Demo determinism:** the 150-object mock bucket uses a seeded PRNG
  (mulberry32), so every scan returns identical objects — easy to reason about
  and test.

## Security notes

- Credentials are supplied per request, held in memory for the duration of one
  scan, and never stored, logged or persisted anywhere.
- The scan only calls `s3:ListBucket` — the UI shows the minimal IAM policy
  needed, so users can scope a dedicated read-only key.
- AWS errors are mapped to human-readable messages (wrong key, bad secret,
  missing permission, wrong region, nonexistent bucket).

## Tests

```bash
bun test        # 21 unit tests
```

Coverage focuses on the money logic: waste-rule boundaries (365-day cutoff,
zero-byte precedence, case-insensitive matching), cost math, storage-class
re-pricing, and the shared formatters.

## Setup

```bash
bun install
bunx convex dev      # generates src/convex/_generated and starts the backend
bun run dev          # starts the frontend
bun test             # unit tests
bun run lint         # eslint
```

The frontend needs one variable, `VITE_CONVEX_URL`, pointing at your Convex
deployment — `bunx convex dev` prints it, and it is injected automatically in
the bundled environment.
