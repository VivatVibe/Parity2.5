/**
 * Zero-Bloat Cloudflare R2 Storage Helper with Strict Image Validation
 * Native platform / Web Crypto / stdlib only. No heavy AWS SDK.
 */

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
  contentType: string
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
    memoryStore.set(key, { data: buffer, contentType, uploaded: new Date() });
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
 * P0-01: Cross-Service Storage Reconciler with Safe Orphan Eligibility Predicate.
 *
 * Guarantees and Limitations:
 * - Orphan Eligibility: An R2 object is eligible for purging ONLY if:
 *   1. Its creation age exceeds safetyGracePeriodMs (to protect in-flight multipart/uploads).
 *   2. AND no record exists in D1 in ANY valid lifecycle state (ACTIVE, RESERVED, PENDING_DELETE, CLEANING).
 * - Objects with an active D1 record (ACTIVE), in-flight upload (RESERVED), or sweeper lease (CLEANING, PENDING_DELETE)
 *   are NEVER deleted by the reconciler.
 * - Handles full R2 cursor pagination.
 */
export async function reconcileR2Storage(
  r2: any,
  db: any,
  options?: {
    prefix?: string;
    safetyGracePeriodMs?: number;
    maxObjectsToScan?: number;
  }
): Promise<{ scannedCount: number; deletedOrphans: string[]; truncated: boolean }> {
  const safetyGracePeriodMs = options?.safetyGracePeriodMs ?? 15 * 60 * 1000;
  const prefix = options?.prefix ?? "users/";
  let cursor: string | undefined = undefined;
  let scannedCount = 0;
  const deletedOrphans: string[] = [];
  const now = Date.now();
  const maxScan = options?.maxObjectsToScan ?? 10000;

  do {
    const page = await listPhotosPaginated(r2, { prefix, cursor, limit: 1000 });
    for (const obj of page.objects) {
      scannedCount++;
      const uploadedMs = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;

      // 1. In-flight grace period: Never touch recent objects
      if (safetyGracePeriodMs > 0 && now - uploadedMs < safetyGracePeriodMs) {
        continue;
      }

      // 2. Safe orphan eligibility predicate:
      // Query D1 for ANY record with this r2_key
      const d1Record = await db
        .prepare("SELECT id, status FROM job_photos WHERE r2_key = ? LIMIT 1")
        .bind(obj.key)
        .first<{ id: number; status: string }>();

      // If record exists in ANY valid lifecycle state, DO NOT DELETE!
      // The application or D1 sweeper owns this file.
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

      // Object has NO D1 record (or explicit FAILED status) and is older than safety grace period.
      // It is a confirmed unreferenced orphan.
      await deletePhoto(r2, obj.key);
      deletedOrphans.push(obj.key);
    }

    if (scannedCount >= maxScan) {
      return { scannedCount, deletedOrphans, truncated: true };
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { scannedCount, deletedOrphans, truncated: false };
}

export function clearMemoryStorage(): void {
  memoryStore.clear();
}
