# ADR 0002: Cross-Service Storage Protocol, Atomic Sweeper CAS, & Persistent Financial Idempotency

## Status
Accepted (Amended for Final Production Readiness Re-Audit: P0-01, P0-02, P1-03, Migration Safety)

## Context
During the independent re-audit of PR #2, three critical correctness edge cases and one migration safety requirement were identified:
1. **P0-01 (Delayed R2 PUT After Sweeper Deletion):** When an in-flight R2 PUT outlives the reservation TTL, the sweeper marks the row pending deletion and purges D1, after which the late PUT completes in R2 and the worker dies before compensation. Activation-time generation checks cannot physically prevent external network writes. An asynchronous cross-service reconciler is required so no unrecoverable orphan can ever remain.
2. **P0-02 (Stale Sweeper Deletion):** Sweepers selecting records and deleting rows via `WHERE id = ?` could race against concurrent sweepers, state transitions, or active uploads. Atomic CAS lease transitions with explicit ownership and generation checks are required.
3. **P1-03 (Payment Retry Persistence):** Unresolved payment operations (due to timeouts, page reloads, or uncertain responses) must retry using their original idempotency key, while preserving the ability to create distinct partial payments.
4. **Migration Safety (Surplus Photo Retention):** Preexisting customer photos exceeding the 5-photo quota must not be automatically deleted without an explicit retention policy.

---

## 1. P0-01: Cross-Service Storage Protocol & Storage Reconciler

### The Asynchronous Interleaving Problem
In a decoupled edge architecture (Cloudflare Workers, D1 Database, R2 Object Storage), R2 does not support distributed two-phase commit with D1:
1. Upload A reserves a slot in D1 (`status = 'RESERVED'`).
2. Upload A begins streaming bytes via R2 `put()`, which stalls in flight beyond the 5-minute TTL.
3. Sweeper runs, transitions expired reservation to `CLEANING`, calls R2 delete (no-op as bytes are not yet written), and deletes the D1 row.
4. Upload A's delayed R2 PUT finally lands in R2.
5. Upload A's worker terminates or crashes before compensation can execute.

Because the D1 record was purged in Step 3, D1 has no record of the R2 key. A standard D1-driven query can never find this object.

### The Safe Protocol Solution
We enforce a dual-layer lifecycle:
1. **Worker-Side Fencing (Fast Path):**
   `activatePhotoSlot()` requires `created_at >= datetime('now', '-5 minutes')` and key matching. A delayed upload that finishes in the worker fails activation, catches the error, and deletes the R2 object.
2. **Storage Reconciler (`reconcileR2Storage`) (Asynchronous Safety Net):**
   To guard against worker crashes or lost compensation (Step 5 above), the system runs an asynchronous storage reconciler:
   - Scans R2 objects via `r2.list({ prefix: 'users/' })`.
   - Compares each object's `uploaded` timestamp against a safety grace period (5 minutes) to avoid interfering with in-flight uploads.
   - For objects older than the grace period, queries D1: `SELECT id FROM job_photos WHERE r2_key = ? AND status = 'ACTIVE' LIMIT 1`.
   - If no active D1 record exists, the reconciler calls `deletePhoto(r2, object.key)`.

**Guarantee:** No orphan remains unrecoverable. Even in the worst-case worker death scenario, the storage reconciler detects and purges the unreferenced object.

---

## 2. P0-02: Stale Sweeper Prevention via Atomic CAS & Leases

### Schema Design for Concurrency
`job_photos` is enhanced with:
- `slot_number INTEGER CHECK(slot_number BETWEEN 1 AND 5)` (nullable to allow tombstones and legacy surplus).
- `status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('RESERVED', 'ACTIVE', 'PENDING_DELETE', 'FAILED', 'CLEANING'))`.
- `cleanup_attempts INTEGER DEFAULT 0`: Retry counter for transient network/R2 failures.
- `last_cleanup_error TEXT`: Preserves diagnostic error metadata.
- `cleanup_worker_id TEXT`: Holds the unique lease owner during active cleanup.
- `cleanup_generation INTEGER DEFAULT 0`: Monotonically incremented generation token.

### Atomic CAS State Transitions
To guarantee that concurrent sweepers and active uploads never delete or modify records that have changed state:
1. **Candidate Selection:**
   Find rows where `status = 'PENDING_DELETE'` or expired `RESERVED` (>5m) or stale `CLEANING` (>5m).
2. **Atomic Lease Claim (CAS):**
   ```sql
   UPDATE job_photos 
   SET status = 'CLEANING', 
       cleanup_worker_id = :workerId, 
       cleanup_generation = COALESCE(cleanup_generation, 0) + 1,
       slot_number = NULL
   WHERE id = :id 
     AND (status = 'PENDING_DELETE' OR (status = 'RESERVED' AND created_at < datetime('now', '-5 minutes')) OR (status = 'CLEANING' AND created_at < datetime('now', '-5 minutes')));
   ```
   **Verification of Affected Rows:** The sweeper inspects `changes`. If `changes === 0`, another worker claimed the record or it changed state. The sweeper **skips** the row and touches nothing in R2.
3. **External R2 Mutation:**
   Only the single worker that acquired `changes === 1` performs `deletePhoto(r2, r2Key)`.
4. **Conditional D1 Purge or Failure Reversion:**
   - On R2 Success:
     ```sql
     DELETE FROM job_photos 
     WHERE id = :id AND status = 'CLEANING' AND cleanup_worker_id = :workerId;
     ```
   - On R2 Failure:
     ```sql
     UPDATE job_photos 
     SET status = 'PENDING_DELETE', 
         cleanup_attempts = cleanup_attempts + 1, 
         last_cleanup_error = :err,
         cleanup_worker_id = NULL
     WHERE id = :id AND status = 'CLEANING' AND cleanup_worker_id = :workerId;
     ```

---

## 3. P1-03: Persistent Idempotency Key Lifecycle & Retries

### Unresolved Operation Persistence
- **Client Storage Key:** When a user initiates a payment operation (e.g. 1-Click Retainer Collect), the client checks `localStorage` for `parity_pending_pay_${jobId}_${period}`.
- **Unresolved Retries:** If a request times out, the page is reloaded, or network response is dropped after server insertion, the retry uses the **identical persisted idempotency key**.
- **Material Replay Validation:** The server compares all material parameters (`amount`, `parts_cost`, `payment_type`, `billing_period`, `note`). If matching, the existing payment is returned with `isIdempotentReplay: true`. If conflicting, HTTP 409 is returned.
- **Confirmed Resolution:** Upon receiving a confirmed HTTP 200/201 response, `localStorage.removeItem()` is called. A subsequent payment click for the same month generates a new operation key, fully supporting legitimate multiple partial collections.

---

## 4. Migration Safety & Surplus Photo Retention

### Upgrade Path (`migrations/0002_remediation.sql`)
1. Add columns `slot_number`, `status`, `cleanup_attempts`, `last_cleanup_error`, `cleanup_worker_id`, `cleanup_generation`, and `idempotency_key`.
2. Deterministically backfill `slot_number` (1..5) using `ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY id ASC)` for the first 5 photos per job.
3. **Zero Customer Data Loss:** Preexisting photos beyond quota ($rnum > 5$) remain `status = 'ACTIVE'` with `slot_number = NULL`. They are **never** automatically marked for deletion.
4. **Quota Protection:** Subsequent uploads evaluate `COUNT(*) WHERE status IN ('ACTIVE', 'RESERVED')`. If active count $\ge 5$, new uploads are rejected until the user explicitly deletes existing photos below quota.
