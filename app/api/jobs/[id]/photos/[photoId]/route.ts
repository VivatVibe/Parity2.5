import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import {
  getJobPhotoById,
  handlePhotoDeletionRequest,
} from "@/src/lib/db";
import { getPhoto } from "@/src/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> | { id: string; photoId: string } }
) {
  try {
    if (!env.DB) return new Response("D1 database missing", { status: 500 });

    const session = await getCurrentUser(request);
    if (!session) return new Response("Unauthorized", { status: 401 });

    const resolvedParams = await params;
    const jobId = Number(resolvedParams.id);
    const photoId = Number(resolvedParams.photoId);

    if (isNaN(jobId) || isNaN(photoId)) {
      return new Response("Invalid ID parameters", { status: 400 });
    }

    // SEC-02: Strictly enforce tenant ownership
    const photo = await getJobPhotoById(env.DB, jobId, photoId, session.userId);
    if (!photo || photo.status !== "ACTIVE") {
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
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
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

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resolvedParams = await params;
    const jobId = Number(resolvedParams.id);
    const photoId = Number(resolvedParams.photoId);

    if (isNaN(jobId) || isNaN(photoId)) {
      return NextResponse.json({ error: "Invalid ID parameters" }, { status: 400 });
    }

    const r2Binding = (env as any).PHOTOS || (env as any).R2;
    const result = await handlePhotoDeletionRequest(env.DB, r2Binding, session.userId, jobId, photoId);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
