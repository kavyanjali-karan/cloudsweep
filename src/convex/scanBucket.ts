import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  CDATASection,
  Comment,
  DOMException,
  DOMParser,
  Document,
  Element,
  Node,
  Text,
  XMLSerializer,
} from "@xmldom/xmldom";
import { classify, savingsForPrice, STORAGE_USD_PER_GB_MONTH } from "./waste";

// The Convex action runtime has no DOM; the AWS SDK's S3 XML parser needs
// DOMParser and related DOM globals, so polyfill them from @xmldom/xmldom.
// Actions run in an isolated V8 context, so these globals stay scoped to this
// module's requests and don't affect anything else.
const globalAny = globalThis as unknown as Record<string, unknown>;
for (const [key, value] of Object.entries({
  DOMParser,
  XMLSerializer,
  DOMException,
  Node,
  Element,
  Document,
  Text,
  Comment,
  CDATASection,
}) as [string, unknown][]) {
  if (!globalAny[key]) {
    globalAny[key] = value;
  }
}

/**
 * Scan a real AWS S3 bucket with ListObjectsV2.
 *
 * Credentials are supplied per-request, used in-memory for the duration of the
 * scan, and never stored, logged, or persisted in any table. The IAM identity
 * only needs `s3:ListBucket` on the target bucket.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** ListObjectsV2 is capped at 1,000 keys per page; keep scans bounded. */
const MAX_KEYS = 10_000;

export const scanBucket = action({
  args: {
    bucket: v.string(),
    accessKeyId: v.string(),
    secretAccessKey: v.string(),
    region: v.optional(v.string()),
    prefix: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const bucket = args.bucket.trim();
    const accessKeyId = args.accessKeyId.trim();
    const secretAccessKey = args.secretAccessKey.trim();
    const prefix = args.prefix?.trim() || undefined;
    const region = args.region?.trim() || "us-east-1";

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new ConvexError(
        "Bucket name, access key ID and secret access key are all required.",
      );
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new ConvexError(
        `"${bucket}" doesn't look like a valid S3 bucket name (lowercase letters, numbers, dots or dashes, 3–63 chars).`,
      );
    }

    const client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    // Page through the bucket listing.
    const objects: { name: string; size: number; lastModified: number }[] = [];
    let continuationToken: string | undefined;
    try {
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const obj of res.Contents ?? []) {
          if (obj.Key === undefined || obj.LastModified === undefined) continue;
          objects.push({
            name: obj.Key,
            size: obj.Size ?? 0,
            lastModified: obj.LastModified.getTime(),
          });
          if (objects.length >= MAX_KEYS) break;
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken && objects.length < MAX_KEYS);
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "Error";
      const message = (err as { message?: string })?.message ?? String(err);
      if (name === "NoSuchBucket" || /NoSuchBucket/.test(message)) {
        throw new ConvexError(`Bucket "${bucket}" does not exist in region ${region}.`);
      }
      if (name === "InvalidAccessKeyId") {
        throw new ConvexError("Access key ID not recognized by AWS — check the key.");
      }
      if (name === "SignatureDoesNotMatch" || name === "InvalidClientTokenId") {
        throw new ConvexError("Secret access key doesn't match — re-check your credentials.");
      }
      if (name === "AccessDenied" || /AccessDenied/.test(message)) {
        throw new ConvexError(
          "Access denied. The IAM identity needs s3:ListBucket on this bucket (and the region must match).",
        );
      }
      if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|NetworkingError/.test(`${name} ${message}`)) {
        throw new ConvexError(`Could not reach S3 in region "${region}" — check the region and network.`);
      }
      throw new ConvexError(`S3 list failed: ${message}`);
    }

    const now = Date.now();
    const { waste, byReason, bytesByReason, wastedBytes } = classify(objects, now);
    const savingsUsd = savingsForPrice(wastedBytes, STORAGE_USD_PER_GB_MONTH);

    // Estimated total stored bytes across ALL listed objects (waste + healthy).
    const totalBytes = objects.reduce((sum, o) => sum + o.size, 0);
    const oldestDays =
      objects.length > 0
        ? Math.floor(
            (now - Math.min(...objects.map((o) => o.lastModified))) / DAY_MS,
          )
        : 0;

    return {
      bucket,
      region,
      prefix: prefix ?? "",
      scannedAt: now,
      totalFiles: objects.length,
      totalBytes,
      truncated: objects.length >= MAX_KEYS,
      wastedFiles: waste.length,
      wastedBytes,
      savingsUsd,
      byReason,
      bytesByReason,
      priceUsdPerGbMonth: STORAGE_USD_PER_GB_MONTH,
      oldestObjectDays: oldestDays,
      files: waste,
    };
  },
});
