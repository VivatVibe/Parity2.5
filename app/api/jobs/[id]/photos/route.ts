import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import { initDatabase, createJobPhoto, getJobPhotos } from "@/src/lib/db";
import { putPhoto } from "@/src/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });
    await initDatabase(env.DB);

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
    await initDatabase(env.DB);

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

    const r2Key = `users/${session.userId}/jobs/${jobId}/${crypto.randomUUID()}.webp`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const contentType = file.type || "image/webp";

    // 1. Put into R2 (with memory fallback)
    const r2Binding = (env as any).PHOTOS || (env as any).R2;
    await putPhoto(r2Binding, r2Key, buffer, contentType);

    // 2. Insert into D1 (Enforces < 5 quota and tenant ownership)
    const photo = await createJobPhoto(env.DB, session.userId, jobId, r2Key, caption);

    return NextResponse.json({ success: true, photo });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
