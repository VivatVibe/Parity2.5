import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import { initDatabase, addJobPayment, getJobById } from "@/src/lib/db";
import { PaymentInputSchema } from "@/src/schemas/payment";

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

    const rawBody = await request.json();
    const validated = PaymentInputSchema.parse(rawBody);

    const payment = await addJobPayment(env.DB, session.userId, {
      jobId,
      amount: validated.amount,
      partsCost: validated.parts_cost,
      paymentType: validated.payment_type,
      billingPeriod: validated.billing_period,
      note: validated.note,
    });

    const updatedJob = await getJobById(env.DB, session.userId, jobId);

    return NextResponse.json({
      success: true,
      payment,
      financialSummary: updatedJob?.financialSummary,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
