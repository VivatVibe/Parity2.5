# ADR 0002: Storage Lifecycle, Distributed Leases, & Immutable Financial Operations

## Status
Accepted (Amended for Independent Audit Corrections: Reconciler Safety, Sweeper Lease Semantics, Payment Payload Persistence)

## Context
Following the PR #2 audit, three targeted correctness defects were resolved:
1. **R2 Reconciler Safety:** The initial reconciler erroneously treated non-ACTIVE objects as orphans, threatening in-flight uploads (`RESERVED`) and active sweeper leases (`CLEANING`, `PENDING_DELETE`). Pagination was also unhandled.
2. **Sweeper Lease Semantics:** Lease expiration relied on `created_at` (the photo's original upload timestamp) instead of an independent lease acquisition timestamp, causing immediate lease stealing on older records. Generation checks were not enforced on deletion.
3. **Payment Retry Payload Persistence:** Only the idempotency key string was persisted. A reload or dashboard balance change caused a mismatch between the persisted key and new amount, triggering 409 conflicts, which were then silently cleared from storage.

---

## 1. Safe R2 Reconciliation Architecture

### Safe Orphan Eligibility Predicate
An R2 storage object at `object.key` is considered eligible for reconciliation purging **only** when all of the following conditions hold:
1. **Creation Age Exceeds Grace Period:** `now - object.uploaded > safetyGracePeriodMs` (default: 15 minutes). This prevents race conditions with concurrent multipart or in-flight upload streaming before D1 activation.
2. **Safe D1 State Check:**
   ```sql
   SELECT id, status FROM job_photos WHERE r2_key = ? LIMIT 1
   ```
   - If `status = 'ACTIVE'`: Protected production asset.
   - If `status = 'RESERVED'`: Protected in-flight upload.
   - If `status = 'CLEANING'`: Protected active sweeper lease.
   - If `status = 'PENDING_DELETE'`: Protected queued deletion managed by the D1 sweeper.
   - **Only if NO record exists in D1** (or status is explicitly `FAILED`): The object is a confirmed unreferenced orphan (e.g. from an aborted upload where D1 reservation was deleted or a late PUT that landed after sweeper completion).

### Cursor Pagination & Interruption Recovery
`reconcileR2Storage()` utilizes the R2 continuation `cursor` to iterate across buckets without memory exhaustion. If interrupted, the reconciler can resume from the last cursor or simply restart on the next cron invocation without data loss, because reconciliation is strictly idempotent and read-first.

### Invocation & Scheduling
Reconciliation is exposed via `POST /api/maintenance/reconcile` (secured by `CRON_SECRET` / bearer authorization) and callable by Cloudflare Workers cron triggers.

### Architectural Limitations
R2 reconciliation is an **eventual consistency safety net**, not a distributed ACID transaction. A late-written PUT that arrives after D1 deletion remains temporarily in R2 until the reconciler's next run after the 15-minute grace period expires.

---

## 2. Distributed Sweeper Lease Semantics

### Schema Enhancement
`job_photos` is equipped with an explicit lease expiration column:
- `cleanup_lease_expires_at DATETIME`: Absolute timestamp when the active sweeper lease expires (e.g. `datetime('now', '+2 minutes')`).
- `cleanup_worker_id TEXT`: Unique identity of the current lease holder.
- `cleanup_generation INTEGER DEFAULT 0`: Monotonically incremented generation counter.

### State Invariants & CAS Protocol
1. **Candidate Query:** Selects records that are `PENDING_DELETE`, expired `RESERVED` (>5m), or `CLEANING` where `cleanup_lease_expires_at < datetime('now')`.
2. **Atomic CAS Lease Claim:**
   ```sql
   UPDATE job_photos 
   SET status = 'CLEANING', 
       cleanup_worker_id = :workerId, 
       cleanup_generation = :nextGen,
       cleanup_lease_expires_at = datetime('now', '+2 minutes'),
       slot_number = NULL
   WHERE id = :id 
     AND (
       status = 'PENDING_DELETE' 
       OR (status = 'RESERVED' AND created_at < datetime('now', '-5 minutes'))
       OR (status = 'CLEANING' AND cleanup_lease_expires_at IS NOT NULL AND cleanup_lease_expires_at < datetime('now'))
     );
   ```
   Only if `changes === 1` does the worker proceed to external R2 mutations.
3. **Lease Renewal:** If an external operation is slow, `renewPhotoCleanupLease()` extends `cleanup_lease_expires_at = datetime('now', '+2 minutes')` using matching `worker_id` and `generation`.
4. **Conditional Deletion (Fencing Out Stale Workers):**
   ```sql
   DELETE FROM job_photos 
   WHERE id = :id 
     AND status = 'CLEANING' 
     AND cleanup_worker_id = :workerId 
     AND cleanup_generation = :gen;
   ```
   If a worker's R2 operation outlives the 2-minute lease and another worker claims generation `gen + 1`, the stale worker's `DELETE` statement matches 0 rows. It cannot delete or overwrite the newer generation.

---

## 3. Persistent Immutable Payment Operations

### Full Operation Persistence
`src/lib/payment-client.ts` stores the **entire immutable payment intent** in client storage under `parity_pending_pay_op_${jobId}_${billingPeriod}`:
```ts
{
  jobId: number,
  amount: number,
  partsCost: number,
  paymentType: "RETAINER_CYCLE",
  billingPeriod: "2026-10",
  note: string,
  idempotencyKey: string,
  createdAt: number
}
```

### Invariant Rules:
1. **Retry Stability:** When retrying after a network drop, timeout, or page reload, `executePaymentWithRetry` extracts and resends the exact stored payload (`amount`, `partsCost`, `note`, `idempotencyKey`). Any UI balance changes that occurred while the request was in flight do not alter the retried payload.
2. **No Silent Discard on 409:** If HTTP 409 occurs, the client does not delete the operation. Instead, it queries the server reconciliation endpoint (`GET /api/jobs/${jobId}/payments?idempotency_key=...`). If the payment was already recorded, it resolves successfully; otherwise, it reports the conflict for explicit user action.
3. **Intentional Partial Payments:** Only after an operation is confirmed resolved (or explicitly cancelled) is its storage cleared. A subsequent payment click generates a fresh operation, cleanly supporting multiple partial payments within the same billing period.

---

## 4. Migration Safety & Surplus Retention

### Invariant Policy
- Historical customer photos from pre-remediation schemas are **never deleted automatically**.
- In `migrations/0002_remediation.sql`, existing photos beyond 5 per job are preserved with `status = 'ACTIVE'` and `slot_number = NULL`.
- Quota is strictly enforced on new uploads: `validatePhotoUploadQuota()` evaluates total active/reserved photos. If count $\ge 5$, new uploads are rejected.
