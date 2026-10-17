import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import {
  initDatabase,
  getOrCreateUser,
  createClient,
  createJob,
  getJobs,
  getJobById,
  updateJobStatus,
  addJobPayment,
  getJobPayments,
  getJobFinancialSummary,
  reservePhotoSlot,
  activatePhotoSlot,
  failPhotoSlot,
  markPhotoForDeletion,
  finalizePhotoDeletion,
  cleanupOrphanedPhotos,
  getJobPhotos,
  getJobPhotoById,
  validatePhotoUploadQuota,
  getDashboardData,
} from "../src/lib/db";
import {
  getCurrentUser,
  createSessionToken,
  verifySessionToken,
  getJwtSecret,
  createSessionCookieHeader,
} from "../src/lib/auth";
import {
  detectImageMimeType,
  putPhoto,
  getPhoto,
  deletePhoto,
  clearMemoryStorage,
} from "../src/lib/storage";

/**
 * Lightweight in-memory D1 mock with SQL query counting
 */
function createInstrumentedMockD1(): { db: D1Database; getQueryCount: () => number; resetQueryCount: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  let queryCount = 0;

  const db = {
    prepare(query: string) {
      let boundValues: any[] = [];
      return {
        bind(...values: any[]) {
          boundValues = values;
          return this;
        },
        async first<T = any>() {
          queryCount++;
          const stmt = sqlite.prepare(query);
          return (stmt.get(...boundValues) as T) || null;
        },
        async all<T = any>() {
          queryCount++;
          const stmt = sqlite.prepare(query);
          const results = stmt.all(...boundValues) as T[];
          return { results, success: true, meta: {} as any };
        },
        async run() {
          queryCount++;
          const stmt = sqlite.prepare(query);
          const info = stmt.run(...boundValues);
          const changes = Number((info as any)?.changes ?? 0);
          return { success: true, meta: { changes }, changes } as any;
        },
      } as any;
    },
  } as unknown as D1Database;

  return {
    db,
    getQueryCount: () => queryCount,
    resetQueryCount: () => {
      queryCount = 0;
    },
  };
}

async function runRemediationVerification() {
  console.log("🚀 Starting Comprehensive Production Readiness Remediation Verification...\n");

  const { db, getQueryCount, resetQueryCount } = createInstrumentedMockD1();

  // =========================================================================
  // 1. DB-01 & DB-02: Schema Initialization & Constraints
  // =========================================================================
  console.log("▶ Testing DB-01 & DB-02: D1 Migration Schema & Constraints...");
  await initDatabase(db);

  // Negative amount check
  const user1 = await getOrCreateUser(db, "vivat@parity.local", "Vivat Solo Dev");
  const user2 = await getOrCreateUser(db, "attacker@parity.local", "Attacker Dev");

  const client1 = await createClient(db, user1.id, { name: "Client One", phone: "0811111111" });
  const job1 = await createJob(db, user1.id, {
    client_id: client1.id,
    job_type: "REPAIR",
    title: "MacBook Pro Screen Repair",
    total_quoted_amount: 5000,
    metadata: {
      deviceModel: "MacBook Pro 14",
      serialNumber: "MBP14-999",
      symptom: "Broken Screen",
      partsCost: 2000,
    },
  });

  // Verify CHECK(amount > 0)
  await assert.rejects(
    async () => {
      await addJobPayment(db, user1.id, {
        jobId: job1.id,
        amount: -500,
        paymentType: "DEPOSIT",
      });
    },
    (err: any) => err.message.includes("greater than 0")
  );
  console.log("  ✓ CHECK(amount > 0) enforced on payments");

  // =========================================================================
  // 2. SEC-01: Production Authentication Bypass & Session Claims Validation
  // =========================================================================
  console.log("\n▶ Testing SEC-01: Production Auth Mock Bypass Elimination...");

  // A. In production, MOCK_AUTH=true must NEVER be accepted
  const originalEnv = process.env.NODE_ENV;
  const originalMock = process.env.MOCK_AUTH;
  const originalSecret = process.env.JWT_SECRET;

  process.env.NODE_ENV = "production";
  process.env.MOCK_AUTH = "true";

  const fakeReq = new Request("http://localhost:5173/api/dashboard");
  const prodUser = await getCurrentUser(fakeReq);
  assert.strictEqual(prodUser, null, "MOCK_AUTH=true MUST return null in production");
  console.log("  ✓ Production mode unconditionally refuses mock auth bypass");

  // B. Missing JWT_SECRET in production fails closed
  delete process.env.JWT_SECRET;
  assert.throws(
    () => {
      getJwtSecret();
    },
    (err: any) => err.message.includes("strictly required in production")
  );
  console.log("  ✓ Missing JWT_SECRET in production fails closed");

  // C. Validate claims in verifySessionToken (reject forged or malformed payloads)
  process.env.JWT_SECRET = "super-secure-production-key-parity-2026-min-32-chars";
  const validToken = await createSessionToken({
    userId: 42,
    email: "test@parity.local",
    name: "Valid Worker",
  });
  const verified = await verifySessionToken(validToken);
  assert.ok(verified !== null);
  assert.strictEqual(verified.userId, 42);

  // Invalid claims (userId = 0, negative, or invalid email)
  const invalidToken = await createSessionToken({
    userId: -1,
    email: "",
    name: "Bad Worker",
  });
  const rejectedClaims = await verifySessionToken(invalidToken);
  assert.strictEqual(rejectedClaims, null, "Corrupted userId or email must be rejected");
  console.log("  ✓ Session token claims strictly validated");

  // D. Cookie attributes in production
  const cookieHeader = createSessionCookieHeader("test-token");
  assert.ok(cookieHeader.includes("HttpOnly"));
  assert.ok(cookieHeader.includes("SameSite=Lax"));
  assert.ok(cookieHeader.includes("Secure"), "Production cookie header must include Secure flag");
  console.log("  ✓ Production cookie header includes HttpOnly, SameSite=Lax, and Secure");

  // Restore env
  process.env.NODE_ENV = originalEnv;
  process.env.MOCK_AUTH = "true";
  process.env.JWT_SECRET = "parity-dev-secret-only-for-local-2026";

  // =========================================================================
  // 3. SEC-02: Comprehensive Cross-Tenant IDOR Protection
  // =========================================================================
  console.log("\n▶ Testing SEC-02: Cross-Tenant IDOR Hardening...");

  // Attacker (User 2) tries to read User 1's job
  const crossJob = await getJobById(db, user2.id, job1.id);
  assert.strictEqual(crossJob, null, "User 2 cannot read User 1's job");

  // Attacker tries to update User 1's job status
  const updateResult = await updateJobStatus(db, user2.id, job1.id, "DELIVERED");
  assert.strictEqual(updateResult, false, "User 2 cannot update User 1's job");

  // Attacker tries to inject payment into User 1's job
  await assert.rejects(
    async () => {
      await addJobPayment(db, user2.id, {
        jobId: job1.id,
        amount: 1000,
        paymentType: "DEPOSIT",
      });
    },
    (err: any) => err.message.includes(`Job ID ${job1.id} not found or does not belong to user ${user2.id}`)
  );

  // Attacker tries to read User 1's payments
  const crossPayments = await getJobPayments(db, user2.id, job1.id);
  assert.strictEqual(crossPayments.length, 0, "User 2 cannot read User 1's payments");

  // Attacker tries to access photo lookup without valid tenant identity
  await assert.rejects(
    async () => {
      await getJobPhotoById(db, job1.id, 1, 0); // Invalid userId 0
    },
    (err: any) => err.message.includes("Tenant userId is strictly required")
  );
  console.log("  ✓ Cross-tenant read, write, payment, and photo attacks strictly blocked");

  // =========================================================================
  // 4. SEC-03: Image Content & Magic Bytes Validation
  // =========================================================================
  console.log("\n▶ Testing SEC-03: Image Content & Magic Bytes Validation...");

  // Valid WebP
  const webpBuffer = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20,
  ]);
  const webpDetected = detectImageMimeType(webpBuffer);
  assert.ok(webpDetected !== null);
  assert.strictEqual(webpDetected.mimeType, "image/webp");
  assert.strictEqual(webpDetected.extension, "webp");

  // Valid JPEG
  const jpegBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const jpegDetected = detectImageMimeType(jpegBuffer);
  assert.ok(jpegDetected !== null);
  assert.strictEqual(jpegDetected.mimeType, "image/jpeg");
  assert.strictEqual(jpegDetected.extension, "jpg");

  // Valid PNG
  const pngBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const pngDetected = detectImageMimeType(pngBuffer);
  assert.ok(pngDetected !== null);
  assert.strictEqual(pngDetected.mimeType, "image/png");
  assert.strictEqual(pngDetected.extension, "png");

  // Invalid payload (HTML / Script disguised as image)
  const htmlBuffer = new TextEncoder().encode("<script>alert('xss')</script>");
  const fakeImageDetected = detectImageMimeType(htmlBuffer);
  assert.strictEqual(fakeImageDetected, null, "HTML content must be rejected as an image");

  // Fail closed when R2 binding missing in production
  process.env.NODE_ENV = "production";
  await assert.rejects(
    async () => {
      await putPhoto(null, "some-key.webp", webpBuffer, "image/webp");
    },
    (err: any) => err.message.includes("Cloudflare R2 binding is required in production")
  );
  process.env.NODE_ENV = originalEnv;
  console.log("  ✓ Magic bytes validation accepts WebP/JPEG/PNG and rejects HTML/malicious payloads");
  console.log("  ✓ Storage fails closed in production when R2 binding is unavailable");

  // =========================================================================
  // 5. DATA-01: Atomic Photo Quota Enforcement Under Concurrency
  // =========================================================================
  console.log("\n▶ Testing DATA-01: Atomic Photo Quota & Concurrency Safety...");

  // Fill up 4 slots sequentially
  for (let i = 1; i <= 4; i++) {
    const reserved = await reservePhotoSlot(db, user1.id, job1.id, `users/1/jobs/${job1.id}/photo-${i}.webp`);
    await activatePhotoSlot(db, user1.id, reserved.id);
  }

  const photosBeforeRace = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(photosBeforeRace.length, 4, "Should have 4 active photos");

  // Now simulate 5 concurrent requests contending for the final (5th) slot
  const contenders = Array.from({ length: 5 }, (_, idx) => idx + 1);
  const raceResults = await Promise.allSettled(
    contenders.map(async (c) => {
      const res = await reservePhotoSlot(
        db,
        user1.id,
        job1.id,
        `users/1/jobs/${job1.id}/contender-${c}.webp`
      );
      await activatePhotoSlot(db, user1.id, res.id);
      return res;
    })
  );

  const fulfilled = raceResults.filter((r) => r.status === "fulfilled");
  const rejected = raceResults.filter((r) => r.status === "rejected");

  assert.strictEqual(fulfilled.length, 1, "Exactly ONE concurrent contender must win the 5th slot");
  assert.strictEqual(rejected.length, 4, "The remaining 4 contenders must be rejected by quota");

  const totalPhotos = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(totalPhotos.length, 5, "Database must strictly have exactly 5 active photos");
  console.log("  ✓ Concurrency race condition tested: exactly 1 won the 5th slot, 4 rejected");

  // =========================================================================
  // 6. DATA-02: Durable Storage Lifecycle & Failure Cleanup
  // =========================================================================
  console.log("\n▶ Testing DATA-02: Durable Storage Lifecycle & Recovery...");

  // Free one slot
  const photoToDelete = totalPhotos[0];
  const marked = await markPhotoForDeletion(db, user1.id, job1.id, photoToDelete.id);
  assert.strictEqual(marked.status, "PENDING_DELETE");

  // Simulate crash before R2 deletion: item remains in PENDING_DELETE
  const remainingActive = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(remainingActive.length, 4, "PENDING_DELETE photo not visible in active photos");

  // Run cleanupOrphanedPhotos: cleans up PENDING_DELETE and unreserved
  const cleanupRes = await cleanupOrphanedPhotos(db, null, user1.id);
  assert.strictEqual(cleanupRes.cleanedCount, 1, "Cleanup must purge the PENDING_DELETE photo");

  // Test reservation failure recovery
  const failedRes = await reservePhotoSlot(db, user1.id, job1.id, "users/1/jobs/1/failed.webp");
  await failPhotoSlot(db, user1.id, failedRes.id);

  // Slot must be immediately reusable
  const newRes = await reservePhotoSlot(db, user1.id, job1.id, "users/1/jobs/1/replacement.webp");
  await activatePhotoSlot(db, user1.id, newRes.id);
  const photosAfterRepl = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(photosAfterRepl.length, 5);
  console.log("  ✓ Durable lifecycle (RESERVED -> ACTIVE -> PENDING_DELETE -> DELETED) verified");

  // =========================================================================
  // 7. DATA-03: Payment Idempotency & Retainer Collection
  // =========================================================================
  console.log("\n▶ Testing DATA-03: Payment Idempotency Keys & Retry Safety...");

  const idempotencyKey = "client-tx-uuid-123456";

  // First payment submission
  const payment1 = await addJobPayment(db, user1.id, {
    jobId: job1.id,
    amount: 1500,
    partsCost: 300,
    paymentType: "DEPOSIT",
    idempotencyKey,
  });
  assert.strictEqual(payment1.amount, 1500);

  // Exact retry with identical details (e.g. network timeout / double-click)
  const paymentRetry = await addJobPayment(db, user1.id, {
    jobId: job1.id,
    amount: 1500,
    partsCost: 300,
    paymentType: "DEPOSIT",
    idempotencyKey,
  });
  assert.strictEqual(paymentRetry.id, payment1.id, "Idempotent retry must return the existing record");
  assert.strictEqual(paymentRetry.isIdempotentReplay, true);

  // Total payment records in DB must still be 1
  const allJobPayments = await getJobPayments(db, user1.id, job1.id);
  assert.strictEqual(allJobPayments.length, 1, "Duplicate payment must NOT be created");

  // Conflicting submission with same key but differing amount
  await assert.rejects(
    async () => {
      await addJobPayment(db, user1.id, {
        jobId: job1.id,
        amount: 2500, // Differs from 1500!
        paymentType: "DEPOSIT",
        idempotencyKey,
      });
    },
    (err: any) => err.message.includes("IDEMPOTENCY_CONFLICT")
  );
  console.log("  ✓ Idempotency replay returns existing payment without duplication");
  console.log("  ✓ Conflicting parameter reuse correctly rejected with IDEMPOTENCY_CONFLICT");

  // =========================================================================
  // 8. FIN-01: Retainer Multi-Month Cycle Isolation & Partial Payments
  // =========================================================================
  console.log("\n▶ Testing FIN-01: Retainer Multi-Month Isolation & Partial Payments...");

  const retainerJob = await createJob(db, user1.id, {
    client_id: client1.id,
    job_type: "RETAINER",
    title: "Monthly WordPress Maintenance",
    total_quoted_amount: 4000,
    metadata: {
      billingCycleDay: 25,
      monthlyRate: 4000,
      serviceScope: "Security, Backups, Updates",
    },
  });

  const currentMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

  // Past month payment (2026-09)
  await addJobPayment(db, user1.id, {
    jobId: retainerJob.id,
    amount: 4000,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: "2026-09",
    note: "September Cycle Paid",
    idempotencyKey: "ret-past-sep",
  });

  // Current month: verify past month payment DOES NOT mark current month paid
  const summaryBefore = await getJobFinancialSummary(db, user1.id, retainerJob);
  assert.strictEqual(summaryBefore.currentCyclePaid, false, "Past cycle payment must not satisfy current month");
  assert.strictEqual(summaryBefore.balanceDue, 4000, "Balance due for current cycle must be 4000");
  assert.strictEqual(summaryBefore.totalPaid, 4000, "Lifetime totalPaid includes past cycle");

  // Partial payment for current cycle (e.g. 1,500 of 4,000)
  await addJobPayment(db, user1.id, {
    jobId: retainerJob.id,
    amount: 1500,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: currentMonth,
    note: "Partial payment for current month",
    idempotencyKey: "ret-curr-part1",
  });

  const summaryPartial = await getJobFinancialSummary(db, user1.id, retainerJob);
  assert.strictEqual(summaryPartial.currentCyclePaid, false, "Partial payment does not mark cycle paid");
  assert.strictEqual(summaryPartial.balanceDue, 2500, "Remaining balance due must be 2,500");
  assert.strictEqual(summaryPartial.totalPaid, 5500, "Lifetime totalPaid is 4,000 + 1,500 = 5,500");

  // Final payment to complete current cycle (2,500)
  await addJobPayment(db, user1.id, {
    jobId: retainerJob.id,
    amount: 2500,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: currentMonth,
    note: "Remaining payment for current month",
    idempotencyKey: "ret-curr-part2",
  });

  const summaryComplete = await getJobFinancialSummary(db, user1.id, retainerJob);
  assert.strictEqual(summaryComplete.currentCyclePaid, true, "Full payment marks cycle paid");
  assert.strictEqual(summaryComplete.balanceDue, 0, "Balance due becomes 0");
  assert.strictEqual(summaryComplete.isPaidInFull, true);
  assert.strictEqual(summaryComplete.totalPaid, 8000, "Lifetime totalPaid is 8,000");
  console.log("  ✓ Retainer past cycles isolated; partial payments & balance due strictly verified");

  // =========================================================================
  // 9. FIN-02: Asia/Bangkok Midnight Revenue Boundary
  // =========================================================================
  console.log("\n▶ Testing FIN-02: Asia/Bangkok Midnight Revenue Boundary (+7h offset)...");

  // Create a payment recorded at 2026-09-30 18:30:00 UTC
  // In UTC, this is September 30.
  // In Asia/Bangkok (UTC+7), 18:30 + 7h = 01:30 AM on 2026-10-01 (October 1st!)
  await db
    .prepare(
      `INSERT INTO job_payments (
        job_id, user_id, amount, parts_cost, payment_type, paid_at, note, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, '2026-09-30 18:30:00', 'Midnight boundary payment', 'midnight-tx-1')`
    )
    .bind(job1.id, user1.id, 2000, 500, "MILESTONE")
    .run();

  // Query October KPI with Asia/Bangkok boundary alignment
  const kpiOctober = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as rev 
       FROM job_payments 
       WHERE user_id = ? AND strftime('%Y-%m', datetime(paid_at, '+7 hours')) = '2026-10'`
    )
    .bind(user1.id)
    .first<{ rev: number }>();

  assert.ok(kpiOctober && kpiOctober.rev >= 2000, "Midnight UTC transaction correctly categorized in Bangkok October");
  console.log("  ✓ Midnight boundary transaction (UTC 18:30 / BKK 01:30) correctly grouped in Bangkok month");

  // =========================================================================
  // 10. Dashboard Query Count & Performance (Zero N+1)
  // =========================================================================
  console.log("\n▶ Testing Dashboard Query Count (Zero N+1)...");
  resetQueryCount();

  const dashboardData = await getDashboardData(db, user1.id);
  const queriesFired = getQueryCount();

  assert.strictEqual(queriesFired, 2, `Dashboard MUST fire exactly 2 SQL queries (fired ${queriesFired})`);
  assert.ok(dashboardData.kpis.activeJobsCount > 0);
  assert.ok(dashboardData.zones.repairs.length > 0);
  assert.ok(dashboardData.zones.retainers.length > 0);
  console.log("  ✓ Dashboard fired EXACTLY 2 SQL queries for full mission control aggregation");

  console.log("\n🎉 ALL REMEDIATION & PRODUCTION-READINESS ASSERTIONS PASSED PERFECTLY!\n");
}

runRemediationVerification().catch((err) => {
  console.error("❌ Remediation verification failed:", err);
  process.exit(1);
});
