import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import {
  initDatabase,
  getOrCreateUser,
  createClient,
  getClients,
  createJob,
  getJobs,
} from "@/src/lib/db";

export async function GET(request: Request) {
  try {
    if (!env.DB) {
      return NextResponse.json({ error: "D1 database binding missing" }, { status: 500 });
    }

    await initDatabase(env.DB);
    const session = await getCurrentUser(request);
    if (!session) {
      return NextResponse.json({ authenticated: false, message: "Please log in" }, { status: 401 });
    }

    const dbUser = await getOrCreateUser(env.DB, session.email, session.name, session.avatarUrl);
    const clients = await getClients(env.DB, dbUser.id);
    const jobs = await getJobs(env.DB, dbUser.id);

    return NextResponse.json({
      authenticated: true,
      user: dbUser,
      clientsCount: clients.length,
      jobsCount: jobs.length,
      jobs,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!env.DB) {
      return NextResponse.json({ error: "D1 database binding missing" }, { status: 500 });
    }

    await initDatabase(env.DB);
    const session = await getCurrentUser(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await getOrCreateUser(env.DB, session.email, session.name, session.avatarUrl);

    // 1. Ensure at least one client exists
    let clients = await getClients(env.DB, dbUser.id);
    let client = clients[0];
    if (!client) {
      client = await createClient(env.DB, dbUser.id, {
        name: "สมเกียรติ สบายใจ (ลูกค้าเดโม)",
        phone: "081-999-8877",
        lineId: "somkiat_demo",
        notes: "ทดสอบลูกค้าระบบ Parity 2.5",
      });
    }

    // 2. Insert dummy job through Zod-compliant input
    const created = await createJob(env.DB, dbUser.id, {
      job_type: "REPAIR",
      client_id: client.id,
      title: "MacBook Air M1 เปิดไม่ติด ตรวจเช็คบอร์ด",
      due_date: new Date(Date.now() + 86400000 * 3).toISOString().split("T")[0],
      total_quoted_amount: 3500,
      metadata: {
        deviceModel: "MacBook Air M1 2020 13-inch Space Gray",
        serialNumber: "C02XYZ123ABC",
        symptom: "ชาร์จไฟไม่เข้า วัดไฟพบ 5V 0.02A ไม่บูต",
        accessories: "สายชาร์จ Type-C + เคสใส",
        partsCost: 1200,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Tracer-Bullet Job Created Successfully",
      job: created,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
