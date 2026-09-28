import { useEffect, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RotateCcw,
  ScanSearch,
  X,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import {
  REASON_LABELS,
  savingsForPrice,
  STORAGE_USD_PER_GB_MONTH,
  WASTE_RULES,
  type WasteReason,
} from "@/convex/waste";
import { formatAge, formatBytes, formatDate, formatUsd } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;
// HTTP actions are served from *.convex.site, while VITE_CONVEX_URL points at
// the *.convex.cloud WebSocket API domain.
const CONVEX_SITE_URL = CONVEX_URL.replace(/\.convex\.cloud/, ".convex.site");

/**
 * AWS S3 storage-class list prices (USD per GB-month, us-east-1).
 * Source: https://aws.amazon.com/s3/pricing/ — the default tier matches the
 * backend's STORAGE_USD_PER_GB_MONTH so demo and math stay consistent.
 */
const PRICING_TIERS = [
  { id: "standard", label: "S3 Standard", usdPerGbMonth: 0.023 },
  { id: "standard-ia", label: "Standard-IA", usdPerGbMonth: 0.0125 },
  { id: "glacier-ir", label: "Glacier Instant Retrieval", usdPerGbMonth: 0.004 },
  { id: "glacier-flex", label: "Glacier Flexible Retrieval", usdPerGbMonth: 0.0036 },
  { id: "deep-archive", label: "Glacier Deep Archive", usdPerGbMonth: 0.00099 },
];

/* -------------------------------- header -------------------------------- */

function ApiStatusBadge() {
  const [status, setStatus] = useState<"pending" | "live" | "down">("pending");

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch(`${CONVEX_SITE_URL}/health`)
        .then((r) => {
          if (!cancelled) setStatus(r.ok ? "live" : "down");
        })
        .catch(() => {
          if (!cancelled) setStatus("down");
        });
    };
    check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const dot =
    status === "live" ? "bg-[#16a34a]" : status === "down" ? "bg-red-500" : "bg-zinc-400";
  const label =
    status === "live" ? "API Live" : status === "down" ? "API Offline" : "Checking…";

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700">
      <span className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#16a34a]">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
              <path
                d="M7 17a4 4 0 0 1-.7-7.94A5.5 5.5 0 0 1 17 8.5c0 .2 0 .4-.02.6A3.75 3.75 0 0 1 16.25 17H7Z"
                stroke="white"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="m9.5 19.5 2-3.5m3 3.5 2-3.5"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="text-lg font-bold tracking-tight">CloudSweep</span>
          <span className="hidden text-sm text-zinc-400 sm:inline">
            / S3 waste finder
          </span>
        </div>
        <ApiStatusBadge />
      </div>
    </header>
  );
}

/* ----------------------------- methodology ------------------------------- */

function MethodologySection() {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold tracking-tight">
          How savings are calculated
        </h2>
        <a
          href="https://aws.amazon.com/s3/pricing/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-[#16a34a] hover:text-[#15803d]"
        >
          AWS S3 pricing <ExternalLink className="size-3" />
        </a>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {WASTE_RULES.map((r) => (
          <div key={r.reason} className="rounded-xl border border-zinc-200 p-6">
            <h3 className="font-semibold text-zinc-950">{r.title}</h3>
            <code className="mt-2 block rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
              {r.rule}
            </code>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              {r.rationale}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-zinc-400">
        Savings = wasted gigabytes × the S3 storage-class price, per month.
        Defaults to S3 Standard at ${STORAGE_USD_PER_GB_MONTH}/GB-month
        (us-east-1 list price). These are transparent heuristics, not AWS
        recommendations — verify flagged objects before deleting anything.
      </p>
    </section>
  );
}

/* ---------------------------- credentials form --------------------------- */

const IAM_POLICY_SNIPPET = `{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "s3:ListBucket",
    "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME"
  }]
}`;

interface Credentials {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  prefix: string;
}

function CredentialsForm({
  onSubmit,
  onCancel,
  scanning,
}: {
  onSubmit: (creds: Credentials) => void;
  onCancel: () => void;
  scanning: boolean;
}) {
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [prefix, setPrefix] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);

  const ready = bucket.trim() && accessKeyId.trim() && secretAccessKey.trim();

  return (
    <section className="rounded-xl border border-zinc-200">
      <div className="border-b border-zinc-200 px-6 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-zinc-950">
          <KeyRound className="size-4 text-[#16a34a]" />
          Scan your own bucket
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Read-only scan. Your keys are used once, in memory, for this scan only —
          never stored, logged, or sent anywhere except AWS.
        </p>
      </div>

      <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-zinc-700">
            Bucket name <span className="text-red-500">*</span>
          </span>
          <Input
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            placeholder="my-company-backups"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-zinc-700">Region</span>
          <Input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="us-east-1"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-zinc-700">
            Access key ID <span className="text-red-500">*</span>
          </span>
          <Input
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            placeholder="AKIA…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-zinc-700">
            Secret access key <span className="text-red-500">*</span>
          </span>
          <Input
            type="password"
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            placeholder="••••••••••••••••"
            autoComplete="off"
          />
        </label>

        <label className="grid gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-zinc-700">
            Prefix <span className="font-normal text-zinc-400">(optional — scan one folder)</span>
          </span>
          <Input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="backups/"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-zinc-500">
          Needs only{" "}
          <button
            type="button"
            onClick={() => setShowPolicy((v) => !v)}
            className="font-medium text-[#16a34a] underline underline-offset-2 hover:text-[#15803d]"
          >
            s3:ListBucket
          </button>{" "}
          — a dedicated read-only IAM user is recommended.
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={scanning}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit({ bucket, accessKeyId, secretAccessKey, region, prefix })
            }
            disabled={!ready || scanning}
            className="bg-[#16a34a] font-semibold text-white shadow-none hover:bg-[#15803d]"
          >
            {scanning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ScanSearch className="size-4" />
            )}
            {scanning ? "Scanning…" : "Scan My Bucket"}
          </Button>
        </div>
      </div>

      {showPolicy && (
        <div className="border-t border-zinc-200 bg-zinc-50 px-6 py-4">
          <p className="mb-2 text-xs font-medium text-zinc-700">
            Minimal IAM policy — replace YOUR-BUCKET-NAME:
          </p>
          <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-800">
            {IAM_POLICY_SNIPPET}
          </pre>
        </div>
      )}
    </section>
  );
}

/* --------------------------------- types --------------------------------- */

interface ScanData {
  bucket: string;
  region?: string;
  prefix?: string;
  scannedAt: number;
  totalFiles: number;
  totalBytes?: number;
  truncated?: boolean;
  wastedFiles: number;
  wastedBytes: number;
  savingsUsd: number;
  byReason: { junk: number; old: number; temp: number };
  bytesByReason: { junk: number; old: number; temp: number };
  priceUsdPerGbMonth: number;
  oldestObjectDays?: number;
  files: {
    name: string;
    size: number;
    lastModified: number;
    reason: string;
    reasonLabel: string;
    wasteUsd: number;
  }[];
}

/* ------------------------------ rules dialog ----------------------------- */

function RulesDialogContent({
  scanResult,
}: {
  scanResult: ScanData | null;
}) {
  const rules = useQuery(api.s3.generateRules, {
    bucket: scanResult?.bucket,
    byReason: scanResult?.byReason,
    bytesByReason: scanResult?.bytesByReason,
    wastedBytes: scanResult?.wastedBytes,
  });
  const [copied, setCopied] = useState(false);
  const json = rules ? JSON.stringify(rules.lifecycle, null, 2) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      toast.success("Lifecycle JSON copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>S3 Lifecycle Rules{rules ? ` — ${rules.bucket}` : ""}</DialogTitle>
        <DialogDescription>
          Drop this into your bucket's lifecycle configuration to stop paying for
          the waste found in this scan.
        </DialogDescription>
      </DialogHeader>
      <pre className="max-h-[50vh] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-800">
        {json || "Generating…"}
      </pre>
      <DialogFooter>
        <Button onClick={copy} disabled={!json}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </DialogFooter>
    </>
  );
}

/* -------------------------------- page ---------------------------------- */

type ReasonFilter = WasteReason | "all";

export default function Landing() {
  const [mode, setMode] = useState<"demo" | "own">("demo");
  const [showOwnForm, setShowOwnForm] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [ownResult, setOwnResult] = useState<ScanData | null>(null);
  const [ownError, setOwnError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [tierId, setTierId] = useState("standard");
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("all");

  const demoScan = useQuery(api.s3.scan, mode === "demo" ? {} : "skip");
  const scanBucket = useAction(api.scanBucket.scanBucket);

  const scanResult: ScanData | null =
    mode === "own" ? ownResult : (demoScan as ScanData | undefined) ?? null;

  // Re-price with the selected storage class using the same function the
  // backend uses — no duplicated math.
  const tier =
    PRICING_TIERS.find((t) => t.id === tierId) ?? PRICING_TIERS[0];
  const savings = scanResult
    ? savingsForPrice(scanResult.wastedBytes, tier.usdPerGbMonth)
    : 0;
  const wastedBytesGb = (scanResult?.wastedBytes ?? 0) / 1e9;

  const filteredFiles = scanResult
    ? reasonFilter === "all"
      ? scanResult.files
      : scanResult.files.filter((f) => f.reason === reasonFilter)
    : [];

  const runOwnScan = async (creds: Credentials) => {
    setScanning(true);
    setOwnError(null);
    try {
      const res = await scanBucket({
        bucket: creds.bucket,
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        region: creds.region || undefined,
        prefix: creds.prefix || undefined,
      });
      setOwnResult(res as ScanData);
      setShowOwnForm(false);
      setReasonFilter("all");
      toast.success(
        `Scanned ${res.totalFiles.toLocaleString()} objects in ${res.bucket}`,
      );
    } catch (err) {
      const data = (err as { data?: unknown }).data;
      const msg =
        typeof data === "string"
          ? data
          : err instanceof Error
            ? err.message
            : String(err);
      setOwnError(msg);
      toast.error(msg);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-zinc-950">
      <Header />

      <main className="mx-auto max-w-6xl px-6 pb-24">
        {/* Hero */}
        <section className="pt-16 pb-12 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#16a34a]">
            AWS S3 waste finder
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold tracking-tight text-zinc-950 sm:text-5xl">
            Find the files you pay for and never use.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-500">
            CloudSweep scans a bucket, flags zero-byte junk, stale backups and
            never-cleaned temp files, and prices every wasted gigabyte at
            $0.023/GB-month.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                onClick={() => {
                  setMode("demo");
                  setShowOwnForm(false);
                }}
                className={`h-12 px-8 text-base font-semibold shadow-none ${
                  mode === "demo"
                    ? "bg-[#16a34a] text-white hover:bg-[#15803d]"
                    : "border border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-50"
                }`}
              >
                <ScanSearch className="size-5" />
                Scan Demo Bucket
              </Button>
              <Button
                size="lg"
                onClick={() => {
                  setMode("own");
                  setShowOwnForm(true);
                }}
                className={`h-12 px-8 text-base font-semibold shadow-none ${
                  mode === "own"
                    ? "bg-[#16a34a] text-white hover:bg-[#15803d]"
                    : "border border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-50"
                }`}
              >
                <KeyRound className="size-5" />
                Scan Your Bucket
              </Button>
            </div>
            <p className="text-xs text-zinc-400">
              Demo: 150 mock objects, no keys · Your bucket: read-only, keys used
              once in memory
            </p>
          </div>
        </section>

        {/* Methodology — rendered straight from the same metadata as the logic */}
        <div className="mb-12">
          <MethodologySection />
        </div>

        {/* Error from real scans */}
        {ownError && (
          <div className="mb-8 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-red-800">Scan failed</p>
              <p className="mt-1 text-sm text-red-700">{ownError}</p>
            </div>
            <button
              type="button"
              onClick={() => setOwnError(null)}
              className="text-red-400 hover:text-red-600"
              aria-label="Dismiss error"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* Real-bucket credentials form */}
        {showOwnForm && (
          <div className="mb-8">
            <CredentialsForm
              onSubmit={runOwnScan}
              onCancel={() => setShowOwnForm(false)}
              scanning={scanning}
            />
          </div>
        )}

        {/* Results */}
        {scanResult && (
          <>
            {/* Scan context line */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-500">
                {mode === "own" ? "Your bucket" : "Demo bucket"}:{" "}
                <span className="font-semibold text-zinc-950">
                  {scanResult.bucket}
                </span>
                {scanResult.prefix ? (
                  <span className="text-zinc-500"> · prefix {scanResult.prefix}</span>
                ) : null}
                {scanResult.region ? (
                  <span className="text-zinc-400"> · {scanResult.region}</span>
                ) : null}
              </p>
              {mode === "own" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowOwnForm(true)}
                  className="shadow-none"
                >
                  <RotateCcw className="size-3.5" />
                  New scan
                </Button>
              )}
            </div>

            {/* Metric cards */}
            <section className="grid gap-4 sm:grid-cols-3">
              <Card className="rounded-xl border-zinc-200 py-5 shadow-none">
                <CardHeader className="px-6">
                  <CardDescription>Total Files Scanned</CardDescription>
                  <CardTitle className="text-4xl font-extrabold tracking-tight tabular-nums">
                    {scanResult.totalFiles.toLocaleString()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6">
                  <p className="text-xs text-zinc-400">
                    {scanResult.totalBytes !== undefined
                      ? `${formatBytes(scanResult.totalBytes)} stored total`
                      : "objects in cloudsweep-demo-bucket"}
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-xl border-zinc-200 py-5 shadow-none">
                <CardHeader className="px-6">
                  <CardDescription>Wasted Files Found</CardDescription>
                  <CardTitle className="text-4xl font-extrabold tracking-tight tabular-nums">
                    {scanResult.wastedFiles.toLocaleString()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6">
                  <p className="text-xs text-zinc-400">
                    {formatBytes(scanResult.wastedBytes)} of wasted storage
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-xl border-[#16a34a]/30 bg-[#16a34a]/[0.04] py-5 shadow-none">
                <CardHeader className="px-6">
                  <CardDescription className="flex items-center gap-1.5 font-medium text-[#15803d]">
                    Estimated Savings <span aria-hidden="true">💸</span>
                  </CardDescription>
                  <CardTitle className="text-4xl font-extrabold tracking-tight text-[#16a34a] tabular-nums">
                    {formatUsd(savings)}
                    <span className="ml-1 text-base font-medium text-zinc-400">
                      /mo
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6">
                  <Select value={tierId} onValueChange={setTierId}>
                    <SelectTrigger
                      className="h-8 w-full border-none bg-transparent p-0 text-xs shadow-none focus:ring-0"
                      aria-label="S3 storage class price"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRICING_TIERS.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">
                          {t.label} — ${t.usdPerGbMonth}/GB-mo
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-[#15803d]/70">
                    {wastedBytesGb.toFixed(1)} GB × ${tier.usdPerGbMonth}/GB-month
                  </p>
                </CardContent>
              </Card>
            </section>

            {/* Waste table */}
            <section className="mt-10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">
                    Waste breakdown
                  </h2>
                  <p className="text-sm text-zinc-500">
                    {scanResult.files.length} flagged objects, sorted by monthly cost
                    {scanResult.truncated
                      ? " — listing capped at 10,000 keys"
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(["all", "junk", "old", "temp"] as ReasonFilter[]).map((r) => {
                    const active = reasonFilter === r;
                    const count =
                      r === "all"
                        ? scanResult.files.length
                        : scanResult.byReason[r];
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReasonFilter(r)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          active
                            ? "border-zinc-950 bg-zinc-950 text-white"
                            : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                        }`}
                      >
                        {r === "all" ? "All" : REASON_LABELS[r]} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-zinc-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-zinc-50 hover:bg-zinc-50">
                      <TableHead className="sticky top-0 z-10 bg-zinc-50 pl-4 font-semibold text-zinc-500">
                        File Name
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 bg-zinc-50 font-semibold text-zinc-500">
                        Size
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 bg-zinc-50 font-semibold text-zinc-500">
                        Last Modified
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 bg-zinc-50 font-semibold text-zinc-500">
                        Reason
                      </TableHead>
                      <TableHead className="sticky top-0 z-10 bg-zinc-50 pr-4 text-right font-semibold text-zinc-500">
                        Waste / month
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFiles.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell className="max-w-[320px] truncate pl-4 font-medium text-zinc-950">
                          {f.name}
                        </TableCell>
                        <TableCell className="tabular-nums text-zinc-600">
                          {formatBytes(f.size)}
                        </TableCell>
                        <TableCell className="text-zinc-600">
                          {formatDate(f.lastModified)}
                          <span className="ml-2 text-xs text-zinc-400">
                            {formatAge(f.lastModified)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal text-zinc-600">
                            {f.reasonLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="pr-4 text-right font-semibold tabular-nums text-[#16a34a]">
                          {formatUsd(f.wasteUsd)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredFiles.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-16 text-center text-zinc-400">
                          No waste found — this bucket is clean.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Cleanup rules CTA */}
              <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-xl border border-zinc-200 p-6 sm:flex-row sm:items-center">
                <div>
                  <h3 className="font-semibold text-zinc-950">
                    Automate the cleanup
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Generate S3 lifecycle rules that expire temp files after 7
                    days and stale backups and logs after one year.
                  </p>
                </div>
                <Button
                  onClick={() => setRulesOpen(true)}
                  className="shrink-0 bg-zinc-950 font-semibold text-white shadow-none hover:bg-zinc-800"
                >
                  Generate Cleanup Rules (JSON)
                </Button>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-zinc-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-8 text-xs text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
          <p>CloudSweep — S3 waste & cost finder.</p>
          <p>
            Estimates use AWS S3 list prices. Bucket scans use read-only
            ListObjects; credentials are never stored.
          </p>
        </div>
      </footer>

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="sm:max-w-xl">
          {rulesOpen && <RulesDialogContent scanResult={scanResult} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
