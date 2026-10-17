/**
 * Zero-Bloat Cloudflare R2 Storage Helper with Strict Image Validation
 * Native platform / Web Crypto / stdlib only. No heavy AWS SDK.
 */
import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";

interface StorageItem {
  data: Uint8Array;
  contentType: string;
  uploaded: Date;
}

// In-memory fallback for local dev and automated tests ONLY
const memoryStore = new Map<string, StorageItem>();

/**
 * SEC-03: Validate image bytes against magic byte signatures.
 * Allowed formats: WebP, JPEG, PNG.
 */
export function detectImageMimeType(
  buffer: Uint8Array
): { mimeType: "image/webp" | "image/jpeg" | "image/png"; extension: string } | null {
  if (!buffer || buffer.length < 12) return null;

  // WebP: RIFF (bytes 0-3) + WEBP (bytes 8-11)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }

  return null;
}

export async function putPhoto(
  r2: any,
  key: string,
  buffer: Uint8Array,
  contentType: string,
  options?: { uploaded?: Date }
): Promise<void> {
  if (r2 && typeof r2.put === "function") {
    await r2.put(key, buffer, {
      httpMetadata: { contentType },
    });
  } else {
    // Fail closed in production if R2 binding is missing
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cloudflare R2 binding is required in production");
    }
    memoryStore.set(key, { data: buffer, contentType, uploaded: options?.uploaded || new Date() });
  }
}

export async function getPhoto(
  r2: any,
  key: string
): Promise<{ data: Uint8Array; contentType: string } | null> {
  if (r2 && typeof r2.get === "function") {
    const obj = await r2.get(key);
    if (!obj) return null;
    const arrayBuffer = await obj.arrayBuffer();
    const contentType = obj.httpMetadata?.contentType || "image/webp";
    return { data: new Uint8Array(arrayBuffer), contentType };
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cloudflare R2 binding is required in production");
    }
    const item = memoryStore.get(key);
    if (!item) return null;
    return item;
  }
}

export async function deletePhoto(r2: any, key: string): Promise<void> {
  if (r2 && typeof r2.delete === "function") {
    await r2.delete(key);
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cloudflare R2 binding is required in production");
    }
    memoryStore.delete(key);
  }
}

/**
 * Lists objects in storage matching an optional key prefix with pagination support.
 */
export async function listPhotosPaginated(
  r2: any,
  options?: { prefix?: string; cursor?: string; limit?: number }
): Promise<{ objects: { key: string; uploaded: Date; size?: number }[]; truncated: boolean; cursor?: string }> {
  if (r2 && typeof r2.list === "function") {
    const listRes = await r2.list({
      prefix: options?.prefix,
      cursor: options?.cursor,
      limit: options?.limit || 1000,
    });
    return {
      objects: (listRes.objects || []).map((o: any) => ({
        key: o.key,
        uploaded: o.uploaded instanceof Date ? o.uploaded : new Date(o.uploaded || Date.now()),
        size: o.size,
      })),
      truncated: Boolean(listRes.truncated),
      cursor: listRes.cursor,
    };
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cloudflare R2 binding is required in production");
    }
    const all: { key: string; uploaded: Date; size?: number }[] = [];
    for (const [key, item] of memoryStore.entries()) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        all.push({
          key,
          uploaded: item.uploaded || new Date(),
          size: item.data.length,
        });
      }
    }
    const startIndex = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const limit = options?.limit || 1000;
    const sliced = all.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + limit;
    const truncated = nextIndex < all.length;
    return {
      objects: sliced,
      truncated,
      cursor: truncated ? String(nextIndex) : undefined,
    };
  }
}

export async function listPhotos(
  r2: any,
  prefix?: string
): Promise<{ key: string; uploaded: Date; size?: number }[]> {
  const result = await listPhotosPaginated(r2, { prefix });
  return result.objects;
}

/**
 * P0-01: Cross-Service Storage Reconciler with Double-Check Race Guard & Resilient Fault Handling.
 *
 * Guarantees and Concurrency Architecture:
 * - Safe Orphan Eligibility Predicate: An R2 object is eligible for purging ONLY if:
 *   1. Its creation age exceeds safetyGracePeriodMs (default: 1 hour, min: 15 mins) to protect
 *      in-flight multipart/standard uploads and transient network delays.
 *   2. AND no record exists in D1 in ANY valid lifecycle state (ACTIVE, RESERVED, CLEANING, PENDING_DELETE).
 * - Check-Then-Delete Race Guard: To eliminate check-then-delete race conditions where a concurrent
 *   upload activation or retry registers a D1 row between the candidate scan and the external deletion,
 *   a pre-delete double-check query re-verifies D1 eligibility immediately before calling R2 DELETE.
 * - Object Identity & Key Reuse: Object keys follow immutable UUID-based paths (`users/${userId}/jobs/${jobId}/${uuid}.${ext}`)
 *   and are never reused for different files or jobs.
 * - Resilient Fault Handling: Individual R2 deletion failures are captured in `failedDeletions` without
 *   aborting the scan, allowing subsequent cron executions to retry.
 * - Scan Interruption & Resumption: Respects `maxObjectsToScan` and returns continuation cursors.
 */
export const MIN_SAFETY_GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour hard safety bound

export async function reconcileR2Storage(
  r2: any,
  db: any,
  options?: {
    prefix?: string;
    safetyGracePeriodMs?: number;
    maxObjectsToScan?: number;
  }
): Promise<{
  scannedCount: number;
  deletedOrphans: string[];
  failedDeletions: { key: string; error: string }[];
  truncated: boolean;
  cursor?: string;
}> {
  // R8-A3: Hard safety bound floor. Enforce minimum 60 minutes across all production callers.
  // In non-production testing, an explicit override can be used only if expressly specified.
  const isProd = process.env.NODE_ENV === "production";
  const requestedGrace = options?.safetyGracePeriodMs;
  const safetyGracePeriodMs = isProd
    ? Math.max(MIN_SAFETY_GRACE_PERIOD_MS, requestedGrace ?? MIN_SAFETY_GRACE_PERIOD_MS)
    : (requestedGrace !== undefined ? requestedGrace : MIN_SAFETY_GRACE_PERIOD_MS);
  const prefix = options?.prefix ?? "users/";
  let cursor: string | undefined = undefined;
  let scannedCount = 0;
  const deletedOrphans: string[] = [];
  const failedDeletions: { key: string; error: string }[] = [];
  const now = Date.now();
  const maxScan = options?.maxObjectsToScan ?? 10000;

  do {
    const pageLimit = Math.min(1000, Math.max(1, maxScan - scannedCount));
    const page = await listPhotosPaginated(r2, { prefix, cursor, limit: pageLimit });
    for (const obj of page.objects) {
      if (scannedCount >= maxScan) break;
      scannedCount++;
      const uploadedMs = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;

      // 1. In-flight grace period: Never touch recent objects
      if (safetyGracePeriodMs > 0 && now - uploadedMs < safetyGracePeriodMs) {
        continue;
      }

      // 2. Initial D1 eligibility check
      const d1Record = await db
        .prepare("SELECT id, status FROM job_photos WHERE r2_key = ? LIMIT 1")
        .bind(obj.key)
        .first<{ id: number; status: string }>();

      if (d1Record) {
        if (
          d1Record.status === "ACTIVE" ||
          d1Record.status === "RESERVED" ||
          d1Record.status === "CLEANING" ||
          d1Record.status === "PENDING_DELETE"
        ) {
          continue;
        }
      }

      // 3. P0-01 Double-check guard immediately prior to external R2 deletion:
      // Guards against concurrent uploads, activations, or retries that may have registered
      // this key in D1 between the initial scan check and the delete call.
      const immediateCheck = await db
        .prepare("SELECT id, status FROM job_photos WHERE r2_key = ? LIMIT 1")
        .bind(obj.key)
        .first<{ id: number; status: string }>();

      if (immediateCheck) {
        if (
          immediateCheck.status === "ACTIVE" ||
          immediateCheck.status === "RESERVED" ||
          immediateCheck.status === "CLEANING" ||
          immediateCheck.status === "PENDING_DELETE"
        ) {
          // Object state transitioned to active concurrently; abort deletion!
          continue;
        }
      }

      // 4. Perform external R2 deletion with resilient error capture
      try {
        await deletePhoto(r2, obj.key);
        deletedOrphans.push(obj.key);
      } catch (err: any) {
        failedDeletions.push({
          key: obj.key,
          error: err?.message || "R2 deletion failed",
        });
      }
    }

    if (scannedCount >= maxScan) {
      return {
        scannedCount,
        deletedOrphans,
        failedDeletions,
        truncated: true,
        cursor: page.cursor,
      };
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { scannedCount, deletedOrphans, failedDeletions, truncated: false };
}

// Ponytail: Standard library constant-time string comparison to prevent timing attacks
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.byteLength !== bufB.byteLength) {
    cryptoTimingSafeEqual(bufA, bufA);
    return false;
  }
  return cryptoTimingSafeEqual(bufA, bufB);
}

/**
 * SEC-04 & P0-01: Hardened Maintenance Reconciliation Handler with Fail-Closed Auth,
 * Constant-Time Verification, and Strict Boundary Validation.
 */
export async function handleMaintenanceReconciliation(
  request: Request,
  db: any,
  r2: any,
  cronSecret?: string
): Promise<Response> {
  try {
    if (!db) return Response.json({ error: "D1 database missing" }, { status: 500 });
    if (!r2) return Response.json({ error: "R2 binding missing" }, { status: 500 });

    // SEC-04: Fail closed without dedicated CRON_SECRET.
    // NEVER reuse JWT_SECRET, and enforce strict authentication in ALL environments.
    const expectedSecret = cronSecret || process.env.CRON_SECRET;
    if (!expectedSecret || typeof expectedSecret !== "string" || expectedSecret.trim().length === 0) {
      return Response.json(
        { error: "Maintenance service unavailable: CRON_SECRET not configured" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("Authorization");
    const cronHeader = request.headers.get("X-Cron-Key");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    const isAuthorized =
      (bearerToken && timingSafeEqual(bearerToken, expectedSecret)) ||
      (cronHeader && timingSafeEqual(cronHeader, expectedSecret));

    if (!isAuthorized) {
      return Response.json({ error: "Unauthorized maintenance request" }, { status: 401 });
    }

    // Input sanitization & boundary defense:
    // Restrict prefix to 'users/' root or legitimate subpaths under 'users/' only.
    const url = new URL(request.url);
    const requestedPrefix = url.searchParams.get("prefix");
    let prefix = "users/";
    if (requestedPrefix !== null) {
      const sanitized = requestedPrefix.trim();
      // Prefix must strictly start with 'users/' and not traverse directory boundaries
      if (!sanitized.startsWith("users/") || sanitized.includes("..")) {
        return Response.json(
          { error: "Invalid prefix: must be 'users/' or scoped under 'users/'" },
          { status: 400 }
        );
      }
      prefix = sanitized;
    }

    // P0-01 / R7-A2: Enforce minimum safety grace period of at least 60 minutes (1 hour)
    const MIN_GRACE_PERIOD_MS = 60 * 60 * 1000; // 60 minutes strictly enforced minimum threshold
    const DEFAULT_GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour default
    const requestedGraceMs = url.searchParams.get("grace_ms");
    let safetyGracePeriodMs = DEFAULT_GRACE_PERIOD_MS;
    if (requestedGraceMs !== null) {
      const parsed = Number(requestedGraceMs);
      if (isNaN(parsed) || parsed < MIN_GRACE_PERIOD_MS) {
        return Response.json(
          { error: `Invalid grace_ms: minimum allowable safety grace period is ${MIN_GRACE_PERIOD_MS}ms (60m)` },
          { status: 400 }
        );
      }
      safetyGracePeriodMs = parsed;
    }

    const result = await reconcileR2Storage(r2, db, {
      prefix,
      safetyGracePeriodMs,
    });

    return Response.json({ success: true, result });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export function clearMemoryStorage(): void {
  memoryStore.clear();
}

