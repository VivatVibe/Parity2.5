import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import {
  reservePhotoSlot,
  activatePhotoSlot,
  failPhotoSlot,
  getJobPhotos,
} from "@/src/lib/db";
import { putPhoto, deletePhoto, detectImageMimeType } from "@/src/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resolvedParams = await params;
    const jobId = Number(resolvedParams.id);
    if (isNaN(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    const photos = await getJobPhotos(env.DB, session.userId, jobId);
    return NextResponse.json({ photos });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resolvedParams = await params;
    const jobId = Number(resolvedParams.id);
    if (isNaN(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const caption = (formData.get("caption") as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    // Hard ceiling: reject if compressed file is > 500KB
    const MAX_BYTES = 500 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File size exceeds 500KB (${Math.round(file.size / 1024)}KB)` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // SEC-03: Validate actual image bytes via magic bytes inspection
    const imageInfo = detectImageMimeType(buffer);
    if (!imageInfo) {
      return NextResponse.json(
        { error: "Invalid image format. Supported formats: WebP, JPEG, PNG." },
        { status: 400 }
      );
    }

    const r2Binding = (env as any).PHOTOS || (env as any).R2;
    if (process.env.NODE_ENV === "production" && !r2Binding) {
      return NextResponse.json({ error: "Storage service unavailable" }, { status: 500 });
    }

    const r2Key = `users/${session.userId}/jobs/${jobId}/${crypto.randomUUID()}.${imageInfo.extension}`;

    // DATA-01: Atomically reserve photo slot in D1 before streaming to R2
    const reservedPhoto = await reservePhotoSlot(env.DB, session.userId, jobId, r2Key, caption);

    // DATA-02: Stream to R2 with automatic cleanup on failure
    try {
      await putPhoto(r2Binding, r2Key, buffer, imageInfo.mimeType);
    } catch (uploadErr) {
      await failPhotoSlot(env.DB, session.userId, reservedPhoto.id);
      throw uploadErr;
    }

    // Activate photo in D1 with generation fencing
    let activePhoto;
    try {
      activePhoto = await activatePhotoSlot(env.DB, session.userId, reservedPhoto.id, r2Key);
    } catch (actErr) {
      await deletePhoto(r2Binding, r2Key);
      await failPhotoSlot(env.DB, session.userId, reservedPhoto.id);
      throw actErr;
    }

    return NextResponse.json({ success: true, photo: activePhoto });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
