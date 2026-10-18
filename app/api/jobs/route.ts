import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import { getJobs, createJob } from "@/src/lib/db";
import { JobInputSchema } from "@/src/schemas/job";

export async function GET(request: Request) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || undefined;
    const jobType = url.searchParams.get("jobType") || undefined;

    const jobs = await getJobs(env.DB, session.userId, { status, jobType });
    return NextResponse.json({ jobs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rawBody = await request.json();
    const validatedInput = JobInputSchema.parse(rawBody);

    const job = await createJob(env.DB, session.userId, validatedInput);
    return NextResponse.json({ success: true, job });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
