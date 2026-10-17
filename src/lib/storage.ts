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
 * Lists objects in storage matching an optional key prefix.
 */
export async function listPhotos(
  r2: any,
  prefix?: string
): Promise<{ key: string; uploaded: Date; size?: number }[]> {
  if (r2 && typeof r2.list === "function") {
    const listRes = await r2.list({ prefix });
    return (listRes.objects || []).map((o: any) => ({
      key: o.key,
      uploaded: o.uploaded instanceof Date ? o.uploaded : new Date(o.uploaded || Date.now()),
      size: o.size,
    }));
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cloudflare R2 binding is required in production");
    }
    const results: { key: string; uploaded: Date; size?: number }[] = [];
    for (const [key, item] of memoryStore.entries()) {
      if (!prefix || key.startsWith(prefix)) {
        results.push({
          key,
          uploaded: item.uploaded || new Date(),
          size: item.data.length,
        });
      }
    }
    return results;
  }
}

/**
 * P0-01: Cross-Service Storage Reconciler.
 * Eliminates late-writer orphans created when an R2 PUT completes after a reservation
 * expired, was swept, and the upload handler crashed before compensation.
 *
 * Any R2 object whose age exceeds safetyGracePeriodMs and has no active D1 record is purged.
 */
export async function reconcileR2Storage(
  r2: any,
  db: any,
  options?: {
    prefix?: string;
    safetyGracePeriodMs?: number;
  }
): Promise<{ scannedCount: number; deletedOrphans: string[] }> {
  const safetyGracePeriodMs = options?.safetyGracePeriodMs ?? 5 * 60 * 1000;
  const prefix = options?.prefix ?? "users/";
  const objects = await listPhotos(r2, prefix);

  const deletedOrphans: string[] = [];
  const now = Date.now();

  for (const obj of objects) {
    const uploadedMs = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
    // Skip if within safety grace period so in-flight uploads can finish activating
    if (safetyGracePeriodMs > 0 && now - uploadedMs < safetyGracePeriodMs) {
      continue;
    }

    const activePhoto = await db
      .prepare("SELECT id FROM job_photos WHERE r2_key = ? AND status = 'ACTIVE' LIMIT 1")
      .bind(obj.key)
      .first<{ id: number }>();

    if (!activePhoto) {
      // Unreferenced orphan detected! Delete from R2 storage.
      await deletePhoto(r2, obj.key);
      deletedOrphans.push(obj.key);
    }
  }

  return { scannedCount: objects.length, deletedOrphans };
}

export function clearMemoryStorage(): void {
  memoryStore.clear();
}
