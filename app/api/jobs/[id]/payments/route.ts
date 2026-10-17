import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import { addJobPayment, getJobById, getJobPayments } from "@/src/lib/db";
import { PaymentInputSchema } from "@/src/schemas/payment";

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

    const url = new URL(request.url);
    const idempotencyKey = url.searchParams.get("idempotency_key");

    if (idempotencyKey) {
      const existing = await env.DB.prepare(
        "SELECT * FROM job_payments WHERE job_id = ? AND user_id = ? AND idempotency_key = ? LIMIT 1"
      )
        .bind(jobId, session.userId, idempotencyKey)
        .first();
      return NextResponse.json({ payment: existing || null });
    }

    const payments = await getJobPayments(env.DB, session.userId, jobId);
    return NextResponse.json({ payments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
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

    const rawBody = await request.json();
    const validated = PaymentInputSchema.parse(rawBody);

    // Support Idempotency-Key header as well as body parameter
    const headerIdempotencyKey = request.headers.get("Idempotency-Key");
    const idempotencyKey = validated.idempotency_key || (headerIdempotencyKey ? headerIdempotencyKey.trim() : undefined);

    const payment = await addJobPayment(env.DB, session.userId, {
      jobId,
      amount: validated.amount,
      partsCost: validated.parts_cost,
      paymentType: validated.payment_type,
      billingPeriod: validated.billing_period,
      note: validated.note,
      idempotencyKey,
    });

    const updatedJob = await getJobById(env.DB, session.userId, jobId);

    return NextResponse.json({
      success: true,
      payment,
      isIdempotentReplay: Boolean(payment.isIdempotentReplay),
      financialSummary: updatedJob?.financialSummary,
    });
  } catch (error: any) {
    if (error.message && error.message.includes("IDEMPOTENCY_CONFLICT")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
