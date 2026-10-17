import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import { initDatabase, getClients, searchClients, createClient } from "@/src/lib/db";
import { z } from "zod";

const CreateClientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required"),
  phone: z.string().trim().optional(),
  lineId: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export async function GET(request: Request) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });
    await initDatabase(env.DB);

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const q = url.searchParams.get("q");

    const clients = q
      ? await searchClients(env.DB, session.userId, q)
      : await getClients(env.DB, session.userId);

    return NextResponse.json({ clients });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!env.DB) return NextResponse.json({ error: "D1 database missing" }, { status: 500 });
    await initDatabase(env.DB);

    const session = await getCurrentUser(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const validated = CreateClientSchema.parse(body);

    const client = await createClient(env.DB, session.userId, validated);
    return NextResponse.json({ success: true, client });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
