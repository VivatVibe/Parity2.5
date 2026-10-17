/**
 * Zero-Bloat Cloudflare R2 Storage Helper with In-Memory / Local Fallback
 * No AWS SDK, no external dependencies.
 */

interface StorageItem {
  data: Uint8Array;
  contentType: string;
}

// In-memory fallback for local dev and automated tests
const memoryStore = new Map<string, StorageItem>();

export async function putPhoto(
  r2: any,
  key: string,
  buffer: Uint8Array,
  contentType: string = "image/webp"
): Promise<void> {
  if (r2 && typeof r2.put === "function") {
    await r2.put(key, buffer, {
      httpMetadata: { contentType },
    });
  } else {
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
    const item = memoryStore.get(key);
    if (!item) return null;
    return item;
  }
}

export async function deletePhoto(r2: any, key: string): Promise<void> {
  if (r2 && typeof r2.delete === "function") {
    await r2.delete(key);
  } else {
    memoryStore.delete(key);
  }
}

export function clearMemoryStorage(): void {
  memoryStore.clear();
}
