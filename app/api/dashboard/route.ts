import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import { getDashboardData } from "@/src/lib/db";

export async function GET(request: Request) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const q = url.searchParams.get("q") || undefined;

    const data = await getDashboardData(env.DB, session.userId, q);

    return NextResponse.json({
      success: true,
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
      },
      ...data,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
