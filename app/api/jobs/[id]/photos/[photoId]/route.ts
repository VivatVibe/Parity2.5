import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import { initDatabase, getJobPhotoById, deleteJobPhoto } from "@/src/lib/db";
import { getPhoto, deletePhoto } from "@/src/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> | { id: string; photoId: string } }
) {
  try {
    if (!env.DB) return new Response("D1 database missing", { status: 500 });
    await initDatabase(env.DB);

    const session = await getCurrentUser(request);
    if (!session) return new Response("Unauthorized", { status: 401 });

    const resolvedParams = await params;
    const jobId = Number(resolvedParams.id);
    const photoId = Number(resolvedParams.photoId);

    if (isNaN(jobId) || isNaN(photoId)) {
      return new Response("Invalid ID parameters", { status: 400 });
    }

    // Strictly enforce tenant ownership (WHERE id = photoId AND job_id = jobId AND user_id = session.userId)
    const photo = await getJobPhotoById(env.DB, jobId, photoId, session.userId);
    if (!photo) {
      return new Response("Photo not found", { status: 404 });
    }

    const r2Binding = (env as any).PHOTOS || (env as any).R2;
    const item = await getPhoto(r2Binding, photo.r2_key);

    if (!item) {
      return new Response("Image binary not found in storage", { status: 404 });
    }

    return new Response(item.data as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": item.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    return new Response(error.message, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> | { id: string; photoId: string } }
) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });
    await initDatabase(env.DB);

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resolvedParams = await params;
    const jobId = Number(resolvedParams.id);
    const photoId = Number(resolvedParams.photoId);

    if (isNaN(jobId) || isNaN(photoId)) {
      return NextResponse.json({ error: "Invalid ID parameters" }, { status: 400 });
    }

    // 1. Delete from D1 (Strictly scoped to session.userId)
    const deletedPhoto = await deleteJobPhoto(env.DB, session.userId, jobId, photoId);

    // 2. Delete from R2 Storage
    const r2Binding = (env as any).PHOTOS || (env as any).R2;
    await deletePhoto(r2Binding, deletedPhoto.r2_key);

    return NextResponse.json({ success: true, deletedPhotoId: photoId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
