import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import {
  initDatabase,
  getOrCreateUser,
  createClient,
  createJob,
  getJobById,
  addJobPayment,
  getJobPayments,
  getJobFinancialSummary,
  updateJobStatus,
} from "../src/lib/db";
import { PaymentInputSchema } from "../src/schemas/payment";

/**
 * Lightweight in-memory D1 mock using Node 22 native DatabaseSync
 */
function createMockD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");

  return {
    prepare(query: string) {
      let boundValues: any[] = [];
      return {
        bind(...values: any[]) {
          boundValues = values;
          return this;
        },
        async first<T = any>() {
          const stmt = sqlite.prepare(query);
          return (stmt.get(...boundValues) as T) || null;
        },
        async all<T = any>() {
          const stmt = sqlite.prepare(query);
          const results = stmt.all(...boundValues) as T[];
          return { results, success: true, meta: {} as any };
        },
        async run() {
          const stmt = sqlite.prepare(query);
          stmt.run(...boundValues);
          return { success: true, meta: {} as any };
        },
      } as any;
    },
  } as unknown as D1Database;
}

async function runTicket3Verification() {
  console.log("🚀 Running Ticket 3 Self-Check Verification (Financial Ledger & Digital Slip)...");

  const db = createMockD1();
  await initDatabase(db);

  // 1. Setup multi-tenant users & clients
  const user1 = await getOrCreateUser(db, "vivat@parity.local", "Vivat Solo Dev");
  const user2 = await getOrCreateUser(db, "attacker@parity.local", "Attacker");

  const client1 = await createClient(db, user1.id, {
    name: "คุณสมชาย",
    phone: "081-111-2222",
  });
  const client2 = await createClient(db, user2.id, {
    name: "คุณสมหมาย",
    phone: "089-999-8888",
  });

  // 2. Alignment Check: Retainer Rate Auto-Sync
  const retainerJob = await createJob(db, user1.id, {
    job_type: "RETAINER",
    client_id: client1.id,
    title: "ดูแลระบบเซิร์ฟเวอร์",
    // total_quoted_amount omitted / 0
    metadata: {
      billingCycleDay: 25,
      monthlyRate: 7500,
      serviceScope: "Security & Uptime",
    },
  });
  assert.strictEqual(
    retainerJob.total_quoted_amount,
    7500,
    "Retainer total_quoted_amount should auto-sync with monthlyRate"
  );
  console.log("  ✓ Retainer total_quoted_amount automatically synced with monthlyRate");

  // 3. Payment Zod Schema Validation
  // Negative amount rejected
  assert.throws(() => {
    PaymentInputSchema.parse({
      amount: -500,
      payment_type: "DEPOSIT",
    });
  });

  // RETAINER_CYCLE without billing_period rejected
  assert.throws(() => {
    PaymentInputSchema.parse({
      amount: 7500,
      payment_type: "RETAINER_CYCLE",
      // missing billing_period
    });
  });

  // Valid RETAINER_CYCLE payment
  const validRetainerPayment = PaymentInputSchema.parse({
    amount: "7500", // Coerced from string
    parts_cost: "0",
    payment_type: "RETAINER_CYCLE",
    billing_period: "2026-10",
    note: "โอนผ่าน K-Bank",
  });
  assert.strictEqual(validRetainerPayment.amount, 7500);
  assert.strictEqual(validRetainerPayment.billing_period, "2026-10");
  console.log("  ✓ PaymentInputSchema Zod validations and type refinements verified");

  // 4. Financial Math Verification (REPAIR job: DEPOSIT + FINAL + parts_cost)
  const repairJob = await createJob(db, user1.id, {
    job_type: "REPAIR",
    client_id: client1.id,
    title: "ซ่อมบอร์ด ASUS ROG Strix",
    total_quoted_amount: 5000,
    metadata: {
      deviceModel: "ASUS ROG G15",
      symptom: "เปิดไม่ติด",
      partsCost: 1500, // Estimated parts cost
    },
  });

  // Check initial financial summary before payments
  const initialSummary = await getJobFinancialSummary(db, user1.id, repairJob);
  assert.strictEqual(initialSummary.totalQuotedAmount, 5000);
  assert.strictEqual(initialSummary.totalPaid, 0);
  assert.strictEqual(initialSummary.totalPartsCost, 1500); // Fallback to estimated partsCost from metadata
  assert.strictEqual(initialSummary.balanceDue, 5000);
  assert.strictEqual(initialSummary.netProfit, -1500); // 0 paid - 1500 parts
  assert.strictEqual(initialSummary.isPaidInFull, false);

  // Record Deposit: 2,000 THB with 1,200 THB actual parts cost
  const deposit = await addJobPayment(db, user1.id, {
    jobId: repairJob.id,
    amount: 2000,
    partsCost: 1200,
    paymentType: "DEPOSIT",
    note: "มัดจำค่าอะไหล่",
  });
  assert.strictEqual(deposit.amount, 2000);
  assert.strictEqual(deposit.parts_cost, 1200);

  // Summary after deposit
  const midSummary = await getJobFinancialSummary(db, user1.id, repairJob);
  assert.strictEqual(midSummary.totalPaid, 2000);
  assert.strictEqual(midSummary.totalPartsCost, 1200); // Overrides estimated metadata partsCost
  assert.strictEqual(midSummary.balanceDue, 3000); // 5000 - 2000
  assert.strictEqual(midSummary.netProfit, 800); // 2000 - 1200
  assert.strictEqual(midSummary.isPaidInFull, false);

  // Record Final Payment: 3,000 THB (Balance settled)
  await addJobPayment(db, user1.id, {
    jobId: repairJob.id,
    amount: 3000,
    paymentType: "FINAL",
    note: "รับเครื่องและชำระส่วนที่เหลือ",
  });

  // Final summary
  const finalJob = await getJobById(db, user1.id, repairJob.id);
  assert.ok(finalJob !== null);
  assert.strictEqual(finalJob.financialSummary.totalPaid, 5000);
  assert.strictEqual(finalJob.financialSummary.balanceDue, 0);
  assert.strictEqual(finalJob.financialSummary.totalPartsCost, 1200);
  assert.strictEqual(finalJob.financialSummary.netProfit, 3800); // 5000 - 1200 = 3800 Net Profit
  assert.strictEqual(finalJob.financialSummary.isPaidInFull, true);
  console.log("  ✓ Financial Math (DEPOSIT + FINAL, partsCost deduction, netProfit, balanceDue = 0) verified");

  // 5. Retainer Billing Period Tracking
  // Record payment for cycle 2026-10
  await addJobPayment(db, user1.id, {
    jobId: retainerJob.id,
    amount: 7500,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: "2026-10",
  });

  const fetchedRetainer = await getJobById(db, user1.id, retainerJob.id);
  assert.ok(fetchedRetainer !== null);
  assert.strictEqual(fetchedRetainer.payments.length, 1);
  assert.strictEqual(fetchedRetainer.payments[0].billing_period, "2026-10");
  assert.strictEqual(fetchedRetainer.financialSummary.currentCyclePaid, true);
  console.log("  ✓ Retainer billing period (YYYY-MM) tracking verified");

  // 6. Status Update Flow
  const statusUpdated = await updateJobStatus(db, user1.id, repairJob.id, "DELIVERED");
  assert.strictEqual(statusUpdated, true);
  const deliveredJob = await getJobById(db, user1.id, repairJob.id);
  assert.strictEqual(deliveredJob?.status, "DELIVERED");
  console.log("  ✓ Status update to DELIVERED verified");

  // 7. Security Gate: Cross-Tenant Payment Injection Block
  // User 2 (attacker) tries to add a payment to User 1's repairJob
  await assert.rejects(
    async () => {
      await addJobPayment(db, user2.id, {
        jobId: repairJob.id, // Belongs to User 1!
        amount: 9999,
        paymentType: "FINAL",
      });
    },
    (err: any) => {
      return err.message.includes(`Job ID ${repairJob.id} not found or does not belong to user ${user2.id}`);
    }
  );
  console.log("  ✓ Cross-tenant payment injection attempt strictly blocked!");

  console.log("🎉 All Ticket 3 assertions passed successfully!");
}

runTicket3Verification().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
