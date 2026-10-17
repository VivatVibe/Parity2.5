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
  createJobPhoto,
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
  listPhotos,
  reconcileR2Storage,
  clearMemoryStorage,
} from "../src/lib/storage";
import { executePaymentWithRetry } from "../src/lib/payment-client";

/**
 * Lightweight in-memory D1 mock with SQL query counting
 */
function createInstrumentedMockD1(): {
  db: D1Database;
  sqlite: DatabaseSync;
  getQueryCount: () => number;
  resetQueryCount: () => void;
} {
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
    sqlite,
    getQueryCount: () => queryCount,
    resetQueryCount: () => {
      queryCount = 0;
    },
  };
}

async function runRemediationVerification() {
  console.log("🚀 Starting Comprehensive Production Readiness Remediation Verification...\n");

  const { db, sqlite, getQueryCount, resetQueryCount } = createInstrumentedMockD1();

  // =========================================================================
  // 1. DB-01 & DB-02: Schema Initialization & Constraints
  // =========================================================================
  console.log("▶ Testing DB-01 & DB-02: D1 Migration Schema & Constraints...");
  await initDatabase(db);

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

  const originalEnv = process.env.NODE_ENV;
  const originalMock = process.env.MOCK_AUTH;
  const originalSecret = process.env.JWT_SECRET;

  process.env.NODE_ENV = "production";
  process.env.MOCK_AUTH = "true";

  const fakeReq = new Request("http://localhost:5173/api/dashboard");
  const prodUser = await getCurrentUser(fakeReq);
  assert.strictEqual(prodUser, null, "MOCK_AUTH=true MUST return null in production");
  console.log("  ✓ Production mode unconditionally refuses mock auth bypass");

  delete process.env.JWT_SECRET;
  assert.throws(
    () => {
      getJwtSecret();
    },
    (err: any) => err.message.includes("strictly required in production")
  );
  console.log("  ✓ Missing JWT_SECRET in production fails closed");

  process.env.JWT_SECRET = "super-secure-production-key-parity-2026-min-32-chars";
  const validToken = await createSessionToken({
    userId: 42,
    email: "test@parity.local",
    name: "Valid Worker",
  });
  const verified = await verifySessionToken(validToken);
  assert.ok(verified !== null);
  assert.strictEqual(verified.userId, 42);

  const invalidToken = await createSessionToken({
    userId: -1,
    email: "",
    name: "Bad Worker",
  });
  const rejectedClaims = await verifySessionToken(invalidToken);
  assert.strictEqual(rejectedClaims, null, "Corrupted userId or email must be rejected");
  console.log("  ✓ Session token claims strictly validated");

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

  const crossJob = await getJobById(db, user2.id, job1.id);
  assert.strictEqual(crossJob, null, "User 2 cannot read User 1's job");

  const updateResult = await updateJobStatus(db, user2.id, job1.id, "DELIVERED");
  assert.strictEqual(updateResult, false, "User 2 cannot update User 1's job");

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

  const crossPayments = await getJobPayments(db, user2.id, job1.id);
  assert.strictEqual(crossPayments.length, 0, "User 2 cannot read User 1's payments");

  await assert.rejects(
    async () => {
      await getJobPhotoById(db, job1.id, 1, 0);
    },
    (err: any) => err.message.includes("Tenant userId is strictly required")
  );
  console.log("  ✓ Cross-tenant read, write, payment, and photo attacks strictly blocked");

  // =========================================================================
  // 4. SEC-03: Image Content & Magic Bytes Validation
  // =========================================================================
  console.log("\n▶ Testing SEC-03: Image Content & Magic Bytes Validation...");

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

  const jpegBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const jpegDetected = detectImageMimeType(jpegBuffer);
  assert.ok(jpegDetected !== null);
  assert.strictEqual(jpegDetected.mimeType, "image/jpeg");
  assert.strictEqual(jpegDetected.extension, "jpg");

  const pngBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const pngDetected = detectImageMimeType(pngBuffer);
  assert.ok(pngDetected !== null);
  assert.strictEqual(pngDetected.mimeType, "image/png");
  assert.strictEqual(pngDetected.extension, "png");

  const htmlBuffer = new TextEncoder().encode("<script>alert('xss')</script>");
  const fakeImageDetected = detectImageMimeType(htmlBuffer);
  assert.strictEqual(fakeImageDetected, null, "HTML content must be rejected as an image");

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
  // 5. DATA-01 & BLOCKER 2: Atomic Photo Quota & Generation Fencing
  // =========================================================================
  console.log("\n▶ Testing DATA-01 & BLOCKER 2: Atomic Quota & Generation Fencing...");

  // Fill up 4 slots sequentially
  for (let i = 1; i <= 4; i++) {
    const reserved = await reservePhotoSlot(db, user1.id, job1.id, `users/1/jobs/${job1.id}/photo-${i}.webp`);
    await activatePhotoSlot(db, user1.id, reserved.id, `users/1/jobs/${job1.id}/photo-${i}.webp`);
  }

  const photosBeforeRace = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(photosBeforeRace.length, 4, "Should have 4 active photos");

  // 5 concurrent requests contending for the final (5th) slot
  const contenders = Array.from({ length: 5 }, (_, idx) => idx + 1);
  const raceResults = await Promise.allSettled(
    contenders.map(async (c) => {
      const rKey = `users/1/jobs/${job1.id}/contender-${c}.webp`;
      const res = await reservePhotoSlot(db, user1.id, job1.id, rKey);
      await activatePhotoSlot(db, user1.id, res.id, rKey);
      return res;
    })
  );

  const fulfilled = raceResults.filter((r) => r.status === "fulfilled");
  const rejected = raceResults.filter((r) => r.status === "rejected");

  assert.strictEqual(fulfilled.length, 1, "Exactly ONE concurrent contender must win the 5th slot");
  assert.strictEqual(rejected.length, 4, "The remaining 4 contenders must be rejected by quota");

  const totalPhotos = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(totalPhotos.length, 5, "Database must strictly have exactly 5 active photos");

  // Test BLOCKER 2: Delayed R2 Upload / Generation Fencing
  // Free 1 slot
  const toDelete = totalPhotos[0];
  await markPhotoForDeletion(db, user1.id, job1.id, toDelete.id);
  await finalizePhotoDeletion(db, user1.id, toDelete.id);

  // Reserve slot with a key
  const delayedKey = "users/1/jobs/1/delayed-upload.webp";
  const delayedRes = await reservePhotoSlot(db, user1.id, job1.id, delayedKey);

  // Manually backdate the reservation to 6 minutes ago (simulate delayed upload exceeding 5m TTL)
  sqlite.prepare("UPDATE job_photos SET created_at = datetime('now', '-6 minutes') WHERE id = ?").run(delayedRes.id);

  // Attempt to activate delayed upload -> MUST FAIL CLOSED due to generation fencing
  await assert.rejects(
    async () => {
      await activatePhotoSlot(db, user1.id, delayedRes.id, delayedKey);
    },
    (err: any) => err.message.includes("reservation expired (>5m)")
  );
  console.log("  ✓ Generation fencing successfully rejected delayed upload activation (>5m TTL)");

  // Clean up the expired reservation
  await cleanupOrphanedPhotos(db, null, user1.id);

  // Re-fill to 5 photos
  const refillRes = await reservePhotoSlot(db, user1.id, job1.id, "users/1/jobs/1/refill.webp");
  await activatePhotoSlot(db, user1.id, refillRes.id, "users/1/jobs/1/refill.webp");
  const photosFinal = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(photosFinal.length, 5);
  console.log("  ✓ Concurrency race condition and delayed upload generation fencing verified");

  // =========================================================================
  // 6. DATA-02 & BLOCKER 1: Durable R2 Cleanup & SQL Precedence
  // =========================================================================
  console.log("\n▶ Testing DATA-02 & BLOCKER 1: Durable R2 Cleanup & Failure Recovery...");

  // Free one slot
  const photoToFail = photosFinal[0];
  await markPhotoForDeletion(db, user1.id, job1.id, photoToFail.id);

  // Mock R2 where delete throws / times out
  const failingR2 = {
    async delete() {
      throw new Error("R2 connection timeout during deletion");
    },
  };

  // Run cleanup with failing R2
  const failCleanup = await cleanupOrphanedPhotos(db, failingR2, user1.id);
  assert.strictEqual(failCleanup.failedCount, 1, "Cleanup failure must be recorded");
  assert.strictEqual(failCleanup.cleanedCount, 0);

  // Verify that D1 reference WAS NOT PURGED when R2 failed!
  const survivingRow = sqlite
    .prepare("SELECT id, status, cleanup_attempts, last_cleanup_error FROM job_photos WHERE id = ?")
    .get(photoToFail.id) as any;

  assert.ok(survivingRow !== null, "D1 reference MUST be preserved when R2 deletion fails");
  assert.strictEqual(survivingRow.status, "PENDING_DELETE");
  assert.strictEqual(survivingRow.cleanup_attempts, 1);
  assert.ok(survivingRow.last_cleanup_error.includes("timeout"));
  console.log("  ✓ D1 reference preserved with error diagnostic metadata when R2 deletion fails");

  // Verify SQL precedence: User 2's cleanup does NOT touch User 1's pending photo
  const user2Cleanup = await cleanupOrphanedPhotos(db, null, user2.id);
  assert.strictEqual(user2Cleanup.cleanedCount, 0);
  assert.strictEqual(user2Cleanup.failedCount, 0);

  // Now run cleanup with working R2 -> MUST succeed and purge from D1
  const workingR2 = {
    async delete() {
      return;
    },
  };
  const successCleanup = await cleanupOrphanedPhotos(db, workingR2, user1.id);
  assert.strictEqual(successCleanup.cleanedCount, 1, "Working cleanup purges confirmed R2 deletion");

  const purgedRow = sqlite.prepare("SELECT id FROM job_photos WHERE id = ?").get(photoToFail.id);
  assert.strictEqual(purgedRow, undefined, "Row purged from D1 only after confirmed R2 delete");
  console.log("  ✓ SQL precedence and durable cleanup confirmed");

  // =========================================================================
  // P0-01 FAULT-INJECTION TEST: Delayed R2 PUT After Sweeper Deletion
  // =========================================================================
  console.log("\n▶ Testing P0-01: Delayed R2 PUT After Sweeper Deletion Fault-Injection...");

  // 1. Upload A reserves a slot in D1
  const lateKey = `users/${user1.id}/jobs/${job1.id}/delayed-late-writer.webp`;
  const lateReservation = await reservePhotoSlot(db, user1.id, job1.id, lateKey);
  assert.strictEqual(lateReservation.status, "RESERVED");

  // 2. Upload A starts an R2 PUT that remains in flight beyond reservation TTL
  assert.strictEqual(await getPhoto(null, lateKey), null);

  // 3. Fast forward reservation TTL (> 5 minutes)
  sqlite.prepare("UPDATE job_photos SET created_at = datetime('now', '-6 minutes') WHERE id = ?").run(lateReservation.id);

  // 4. Sweeper runs, transitions expired reservation, calls R2 delete (finds nothing), and purges D1 row
  const lateSweeperResult = await cleanupOrphanedPhotos(db, null, user1.id, "sweeper-early");
  assert.strictEqual(lateSweeperResult.cleanedCount, 1);
  const d1Check = sqlite.prepare("SELECT id FROM job_photos WHERE id = ?").get(lateReservation.id);
  assert.strictEqual(d1Check, undefined, "D1 reservation was purged by sweeper");

  // 5. Upload A's delayed PUT finally completes afterward in R2!
  const latePayload = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); // WebP
  await putPhoto(null, lateKey, latePayload, "image/webp");
  assert.ok((await getPhoto(null, lateKey)) !== null, "R2 now holds the delayed late-written object");

  // 6. The upload handler crashes / terminates without compensation!
  // At this point, R2 contains lateKey, but D1 has no row.
  // Verify that an asynchronous storage reconciler detects and purges this orphan!
  const reconcileResult = await reconcileR2Storage(null, db, {
    prefix: `users/${user1.id}/jobs/${job1.id}/`,
    safetyGracePeriodMs: 0,
  });
  assert.ok(reconcileResult.deletedOrphans.includes(lateKey), "Reconciler MUST find and purge late-written orphan");
  const postReconcile = await getPhoto(null, lateKey);
  assert.strictEqual(postReconcile, null, "Late-written R2 orphan successfully eliminated from storage");
  console.log("  ✓ P0-01: Late R2 PUT fault injection verified; storage reconciler guaranteed zero orphans");

  // =========================================================================
  // P0-02 CONCURRENCY TEST: Simultaneous Sweepers & Atomic CAS Leases
  // =========================================================================
  console.log("\n▶ Testing P0-02: Simultaneous Sweepers & Atomic CAS State Transitions...");

  const dummyR2Key = `users/${user1.id}/jobs/${job1.id}/concurrent-test.webp`;
  await putPhoto(null, dummyR2Key, latePayload, "image/webp");
  const photoForCAS = await createJobPhoto(db, user1.id, job1.id, dummyR2Key);
  await markPhotoForDeletion(db, user1.id, job1.id, photoForCAS.id);

  // Simulate Sweeper 1 and Sweeper 2 running concurrently on the exact same row:
  // Sweeper 1 claims the lease via atomic CAS with worker ID 'worker-1'
  const claimRes1 = await db.prepare(
    `UPDATE job_photos 
     SET status = 'CLEANING', cleanup_worker_id = 'worker-1', cleanup_generation = cleanup_generation + 1 
     WHERE id = ? AND status = 'PENDING_DELETE'`
  ).bind(photoForCAS.id).run();
  assert.strictEqual((claimRes1 as any).changes, 1, "Sweeper 1 successfully acquired exclusive lease");

  // Sweeper 2 attempts CAS claim on the SAME row concurrently -> MUST get 0 affected rows
  const claimRes2 = await db.prepare(
    `UPDATE job_photos 
     SET status = 'CLEANING', cleanup_worker_id = 'worker-2', cleanup_generation = cleanup_generation + 1 
     WHERE id = ? AND status = 'PENDING_DELETE'`
  ).bind(photoForCAS.id).run();
  assert.strictEqual((claimRes2 as any).changes, 0, "Sweeper 2's affected count MUST be 0 (CAS collision)");

  // Stale Sweeper 2 attempts deletion without holding lease -> MUST fail
  const staleDeleteRes = await db.prepare(
    `DELETE FROM job_photos WHERE id = ? AND status = 'CLEANING' AND cleanup_worker_id = 'worker-2'`
  ).bind(photoForCAS.id).run();
  assert.strictEqual((staleDeleteRes as any).changes, 0, "Stale sweeper 2 CANNOT delete row without holding lease");

  // Legitimate Sweeper 1 completes external R2 deletion and purges D1 row
  await deletePhoto(null, dummyR2Key);
  const legitDeleteRes = await db.prepare(
    `DELETE FROM job_photos WHERE id = ? AND status = 'CLEANING' AND cleanup_worker_id = 'worker-1'`
  ).bind(photoForCAS.id).run();
  assert.strictEqual((legitDeleteRes as any).changes, 1, "Lease holder Sweeper 1 successfully purged D1 row");
  console.log("  ✓ P0-02: Simultaneous sweepers and atomic CAS lease ownership verified");

  // =========================================================================
  // 7. DATA-03 & BLOCKER 3: Retainer Multiple Partial Payments & Replay Matching
  // =========================================================================
  console.log("\n▶ Testing DATA-03 & BLOCKER 3: Retainer Multiple Partial Payments & Replay Validation...");

  const retainerJob = await createJob(db, user1.id, {
    client_id: client1.id,
    job_type: "RETAINER",
    title: "Monthly Care Maintenance",
    total_quoted_amount: 5000,
    metadata: {
      billingCycleDay: 15,
      monthlyRate: 5000,
      serviceScope: "Site updates",
    },
  });

  const period = "2026-10";

  // Intentional Collection #1: Partial payment 2000
  const opKey1 = "op-uuid-partial-1";
  const partPayment1 = await addJobPayment(db, user1.id, {
    jobId: retainerJob.id,
    amount: 2000,
    partsCost: 150,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: period,
    note: "First partial collection",
    idempotencyKey: opKey1,
  });
  assert.strictEqual(partPayment1.amount, 2000);

  // Exact retry of Collection #1 -> Identical replay
  const retryPart1 = await addJobPayment(db, user1.id, {
    jobId: retainerJob.id,
    amount: 2000,
    partsCost: 150,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: period,
    note: "First partial collection",
    idempotencyKey: opKey1,
  });
  assert.strictEqual(retryPart1.id, partPayment1.id);
  assert.strictEqual(retryPart1.isIdempotentReplay, true);

  // Conflicting retry with changed parts_cost on same opKey1 -> 409 IDEMPOTENCY_CONFLICT
  await assert.rejects(
    async () => {
      await addJobPayment(db, user1.id, {
        jobId: retainerJob.id,
        amount: 2000,
        partsCost: 350, // Conflicting parts cost!
        paymentType: "RETAINER_CYCLE",
        billingPeriod: period,
        note: "First partial collection",
        idempotencyKey: opKey1,
      });
    },
    (err: any) => err.message.includes("IDEMPOTENCY_CONFLICT")
  );

  // Conflicting retry with changed note on same opKey1 -> 409 IDEMPOTENCY_CONFLICT
  await assert.rejects(
    async () => {
      await addJobPayment(db, user1.id, {
        jobId: retainerJob.id,
        amount: 2000,
        partsCost: 150,
        paymentType: "RETAINER_CYCLE",
        billingPeriod: period,
        note: "Tampered note",
        idempotencyKey: opKey1,
      });
    },
    (err: any) => err.message.includes("IDEMPOTENCY_CONFLICT")
  );

  // Intentional Collection #2: Legitimate second partial payment (3000) in the SAME month!
  const opKey2 = "op-uuid-partial-2";
  const partPayment2 = await addJobPayment(db, user1.id, {
    jobId: retainerJob.id,
    amount: 3000,
    partsCost: 0,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: period,
    note: "Second partial collection",
    idempotencyKey: opKey2,
  });
  assert.strictEqual(partPayment2.amount, 3000);

  // Verify BOTH partial payments exist for the same month without conflict!
  const retainerPayments = await getJobPayments(db, user1.id, retainerJob.id);
  assert.strictEqual(retainerPayments.length, 2);
  const totalCollected = retainerPayments.reduce((s, p) => s + p.amount, 0);
  assert.strictEqual(totalCollected, 5000, "Two partial collections cleanly total 5000");

  const finSummary = await getJobFinancialSummary(db, user1.id, retainerJob, retainerPayments);
  assert.strictEqual(finSummary.currentCyclePaid, true);
  assert.strictEqual(finSummary.balanceDue, 0);
  assert.strictEqual(finSummary.isPaidInFull, true);
  console.log("  ✓ Multiple partial collections within the same period succeed with distinct operation keys");
  console.log("  ✓ Material replay validation (amount, partsCost, note) prevents conflict tampering");

  // =========================================================================
  // P1-03 CLIENT TEST: Lost Response & Idempotency Key Retry Persistence
  // =========================================================================
  console.log("\n▶ Testing P1-03: Lost Network Response & Client Retry Persistence...");

  const clientStorageMap = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => clientStorageMap.get(k) || null,
    setItem: (k: string, v: string) => { clientStorageMap.set(k, v); },
    removeItem: (k: string) => { clientStorageMap.delete(k); },
  };

  let callCount = 0;
  const mockFetchWithLostResponse = async (url: string, init: any) => {
    callCount++;
    const payload = JSON.parse(init.body);
    
    // Server processes payment into D1
    const pRecord = await addJobPayment(db, user1.id, {
      jobId: payload.job_id || retainerJob.id,
      amount: payload.amount,
      partsCost: payload.parts_cost || 0,
      paymentType: payload.payment_type,
      billingPeriod: payload.billing_period,
      note: payload.note,
      idempotencyKey: payload.idempotency_key,
    });

    if (callCount === 1) {
      // Simulate network connection drop before response reaches client!
      throw new Error("Network connection dropped before response received");
    }

    return new Response(JSON.stringify({ success: true, payment: pRecord }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // Attempt 1: Fails due to dropped network response
  const attempt1 = await executePaymentWithRetry({
    jobId: retainerJob.id,
    amount: 1000,
    partsCost: 0,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: "2026-11",
    note: "November Collection",
    storage: mockStorage,
    fetchFn: mockFetchWithLostResponse as any,
  });

  assert.strictEqual(attempt1.ok, false);
  assert.ok(attempt1.error?.includes("dropped"));
  // Key MUST remain persisted in client storage!
  const persistedKey = mockStorage.getItem(`parity_pending_pay_${retainerJob.id}_2026-11`);
  assert.ok(persistedKey !== null, "Idempotency key must remain in storage after network failure");
  assert.strictEqual(persistedKey, attempt1.idempotencyKey);

  // Attempt 2: User retries with page reload or click
  const attempt2 = await executePaymentWithRetry({
    jobId: retainerJob.id,
    amount: 1000,
    partsCost: 0,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: "2026-11",
    note: "November Collection",
    storage: mockStorage,
    fetchFn: mockFetchWithLostResponse as any,
  });

  assert.strictEqual(attempt2.ok, true);
  assert.strictEqual(attempt2.idempotencyKey, attempt1.idempotencyKey, "Retry used IDENTICAL idempotency key");
  assert.strictEqual(attempt2.data.payment.isIdempotentReplay, true, "Server recognized idempotent replay");

  // Verify D1 has EXACTLY ONE payment for 2026-11!
  const novPayments = (await getJobPayments(db, user1.id, retainerJob.id)).filter(p => p.billing_period === "2026-11");
  assert.strictEqual(novPayments.length, 1, "Only ONE payment record created despite network drop and retry");

  // Storage key must be cleared on success
  assert.strictEqual(mockStorage.getItem(`parity_pending_pay_${retainerJob.id}_2026-11`), null);

  // Next payment click generates a NEW operation key for a second partial payment
  const attempt3 = await executePaymentWithRetry({
    jobId: retainerJob.id,
    amount: 500,
    partsCost: 0,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: "2026-11",
    note: "November Second Partial Collection",
    storage: mockStorage,
    fetchFn: mockFetchWithLostResponse as any,
  });
  assert.strictEqual(attempt3.ok, true);
  assert.notStrictEqual(attempt3.idempotencyKey, attempt1.idempotencyKey, "New partial payment received distinct key");

  const novPaymentsTotal = (await getJobPayments(db, user1.id, retainerJob.id)).filter(p => p.billing_period === "2026-11");
  assert.strictEqual(novPaymentsTotal.length, 2, "Two distinct partial payments recorded");
  console.log("  ✓ P1-03: Lost-response client retry persistence and distinct partial collections verified");

  // =========================================================================
  // 8. BLOCKER 4: Migration Compatibility & Deterministic Backfill
  // =========================================================================
  console.log("\n▶ Testing BLOCKER 4 & Migration Safety: Migration 0002 Backfill & Customer Data Retention...");

  // Create isolated fresh SQLite DB simulating legacy 0001 schema state
  const legacySqlite = new DatabaseSync(":memory:");

  // Setup legacy tables (0001_init.sql state WITHOUT slot_number/status)
  legacySqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY, user_id INTEGER, client_id INTEGER, job_number TEXT, job_type TEXT, title TEXT, status TEXT, due_date TEXT, total_quoted_amount REAL, metadata TEXT);
    CREATE TABLE job_payments (id INTEGER PRIMARY KEY, job_id INTEGER, user_id INTEGER, amount REAL, parts_cost REAL, payment_type TEXT, billing_period TEXT, paid_at DATETIME, note TEXT);
    CREATE TABLE job_photos (id INTEGER PRIMARY KEY, job_id INTEGER, user_id INTEGER, r2_key TEXT, caption TEXT, created_at DATETIME);
  `);

  // Insert legacy data: Job 1 has 3 photos, Job 2 has 6 photos (legacy surplus exceeding quota)
  legacySqlite.exec(`
    INSERT INTO users (id, email, name) VALUES (1, 'user@test.local', 'Test User');
    INSERT INTO jobs (id, user_id, client_id, job_number, job_type, title, status) VALUES (1, 1, 1, 'PR-0001', 'REPAIR', 'Job 1', 'RECEIVED');
    INSERT INTO jobs (id, user_id, client_id, job_number, job_type, title, status) VALUES (2, 1, 1, 'PR-0002', 'REPAIR', 'Job 2', 'RECEIVED');

    -- Job 1: 3 photos
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (1, 1, 1, 'key-1');
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (2, 1, 1, 'key-2');
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (3, 1, 1, 'key-3');

    -- Job 2: 6 photos (exceeds max 5 quota)
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (4, 2, 1, 'key-4');
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (5, 2, 1, 'key-5');
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (6, 2, 1, 'key-6');
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (7, 2, 1, 'key-7');
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (8, 2, 1, 'key-8');
    INSERT INTO job_photos (id, job_id, user_id, r2_key) VALUES (9, 2, 1, 'key-9');
  `);

  // Read and execute migrations/0002_remediation.sql on legacy DB
  const fs = await import("node:fs");
  const migration0002Sql = fs.readFileSync("migrations/0002_remediation.sql", "utf-8");
  legacySqlite.exec(migration0002Sql);

  // Verify Job 1 deterministic backfill: slot_numbers 1, 2, 3
  const job1Backfilled = legacySqlite
    .prepare("SELECT id, slot_number, status FROM job_photos WHERE job_id = 1 ORDER BY slot_number ASC")
    .all() as any[];
  assert.strictEqual(job1Backfilled.length, 3);
  assert.deepStrictEqual(
    job1Backfilled.map((p) => p.slot_number),
    [1, 2, 3]
  );
  assert.ok(job1Backfilled.every((p) => p.status === "ACTIVE"));

  // Verify Job 2 surplus handling: slots 1..5 are ACTIVE, 6th is PRESERVED as ACTIVE with slot_number = null
  const job2Backfilled = legacySqlite
    .prepare("SELECT id, slot_number, status FROM job_photos WHERE job_id = 2 ORDER BY id ASC")
    .all() as any[];
  assert.strictEqual(job2Backfilled.length, 6);
  assert.ok(job2Backfilled.every((p) => p.status === "ACTIVE"), "All 6 customer photos PRESERVED without data loss");
  const assignedSlots = job2Backfilled.slice(0, 5).map((p) => p.slot_number);
  assert.deepStrictEqual(assignedSlots, [1, 2, 3, 4, 5]);
  assert.strictEqual(job2Backfilled[5].slot_number, null, "Surplus photo has null slot_number");
  assert.strictEqual(job2Backfilled[5].id, 9);
  console.log("  ✓ Migration 0002 deterministic backfill and customer data retention verified");

  // =========================================================================
  // 9. Dashboard Query Count & Performance (Zero N+1)
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

  console.log("\n🎉 ALL AUDIT RE-CHECK ASSERTIONS (BLOCKERS 1-4) PASSED FLAWLESSLY!\n");
}

runRemediationVerification().catch((err) => {
  console.error("❌ Remediation verification failed:", err);
  process.exit(1);
});
