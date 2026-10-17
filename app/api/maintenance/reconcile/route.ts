import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { reconcileR2Storage } from "@/src/lib/storage";

export async function POST(request: Request) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });
    const r2Binding = (env as any).PHOTOS || (env as any).R2;
    if (!r2Binding) return NextResponse.json({ error: "R2 binding missing" }, { status: 500 });

    // Authorization check for scheduled cron / maintenance runner
    const authHeader = request.headers.get("Authorization");
    const cronHeader = request.headers.get("X-Cron-Key");
    const expectedSecret = (env as any).CRON_SECRET || (env as any).JWT_SECRET;

    if (process.env.NODE_ENV === "production" && expectedSecret) {
      if (cronHeader !== expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
        return NextResponse.json({ error: "Unauthorized maintenance request" }, { status: 401 });
      }
    }

    const url = new URL(request.url);
    const prefix = url.searchParams.get("prefix") || "users/";
    const safetyGracePeriodMs = Number(url.searchParams.get("grace_ms")) || 15 * 60 * 1000;

    const result = await reconcileR2Storage(r2Binding, env.DB, {
      prefix,
      safetyGracePeriodMs,
    });

    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
