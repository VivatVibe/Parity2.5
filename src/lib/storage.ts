/**
 * Zero-Bloat Cloudflare R2 Storage Helper with Strict Image Validation
 * Native platform / Web Crypto / stdlib only. No heavy AWS SDK.
 */

interface StorageItem {
  data: Uint8Array;
  contentType: string;
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
    memoryStore.set(key, { data: buffer, contentType });
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

export function clearMemoryStorage(): void {
  memoryStore.clear();
}
