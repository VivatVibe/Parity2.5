# ADR 0002: Storage Lifecycle, Reservation Fencing & Financial Accounting Model

## Status
Accepted (Amended for Re-Audit Remediation)

## Context
During the independent re-audit of PR #2, four specific edge and consistency blockers were identified:
1. **Durable R2 Cleanup:** `cleanupOrphanedPhotos()` must never purge D1 records when R2 deletion fails or is uncertain, and must correct SQL precedence on tenant filtering.
2. **Reservation Fencing & Expiry:** Inline deletion of expired reservations inside `reservePhotoSlot()` caused race conditions with delayed uploads. A generation fencing and two-phase cleanup transition is required.
3. **Operation-Scoped Idempotency:** Static monthly keys blocked legitimate partial payments within the same billing period.
4. **Deterministic Migration Backfill:** Databases upgrading from `0001_init.sql` with preexisting photos require deterministic `slot_number` assignment before index enforcement.

---

## 1. Storage Lifecycle, Fencing & State Transitions

### Schema Design
`job_photos` is enhanced with:
- `slot_number INTEGER NOT NULL CHECK(slot_number BETWEEN 1 AND 5)`: Hard ceiling of 5 photos per job.
- `status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('RESERVED', 'ACTIVE', 'PENDING_DELETE', 'FAILED'))`.
- `cleanup_attempts INTEGER DEFAULT 0`: Tracks retry counts for failed R2 deletions.
- `last_cleanup_error TEXT`: Preserves error diagnostic info when R2 operations fail.
- `UNIQUE(job_id, slot_number)`: Serializes concurrent slot contenders at the SQLite/D1 engine level.

### State Transitions & Generation Fencing
```
[Client Upload Request]
       │
       ▼
  [RESERVED] (TTL: 5 minutes, bound to photoId + r2Key)
       │
       ├─► (R2 Upload Fails) ──────────────────► [Purge D1 Reservation]
       │
       ├─► (R2 Upload Delayed > 5 mins) ────────► [Fencing Rejection on Activation]
       │                                                 │
       │                                                 ▼
       │                                         [Delete Delayed R2 Object]
       │
       ▼ (R2 Upload Succeeded within TTL)
   [ACTIVE]
       │
       ▼ (User Deletion or Orphan Sweep)
 [PENDING_DELETE] ──(R2 Delete Fails)──────────► [Retain in PENDING_DELETE with Error]
       │                                                 ▲ (Next Sweep Retries)
       │                                                 │
       ▼ (R2 Delete Confirmed Success)                   │
   [DELETED] (Row purged from D1) ───────────────────────┘
```

### Critical Concurrency & Fencing Rules:
1. **No Inline Deletions by Contenders:** `reservePhotoSlot()` NEVER deletes rows created by other requests. Expired reservations are transitioned via dedicated cleanup routines or fenced out.
2. **Generation Fencing:** When `activatePhotoSlot()` is invoked:
   ```sql
   UPDATE job_photos 
   SET status = 'ACTIVE'
   WHERE id = ? AND user_id = ? AND r2_key = ? 
     AND status = 'RESERVED' 
     AND created_at >= datetime('now', '-5 minutes')
   RETURNING *;
   ```
   If a delayed upload arrives after its 5-minute reservation window, the activation update returns 0 rows. The worker catches this failure and immediately calls `deletePhoto(r2, r2Key)` to remove the delayed R2 binary.
   *(Note: While D1 cannot physically cancel an in-flight R2 network packet, fencing guarantees that a delayed packet can neither activate in D1 nor overwrite another slot, and the abort cleanup removes it).*
3. **Durable Cleanup Guarantee:** `cleanupOrphanedPhotos()` attempts `deletePhoto(r2, r2Key)`. Only if R2 deletion succeeds is the D1 record deleted. If R2 deletion throws or times out, the D1 record is **retained** with incremented `cleanup_attempts` and `last_cleanup_error` for subsequent retry.
4. **SQL Precedence:** Tenant filtering in cleanup is strictly parenthesized:
   ```sql
   WHERE (status = 'PENDING_DELETE' OR (status = 'RESERVED' AND created_at < datetime('now', '-5 minutes')))
     AND user_id = ?
   ```

---

## 2. Operation-Scoped Idempotency & Partial Payments

### Domain Rules
- **No Static Keys:** Idempotency keys must represent a single **intentional user operation**, not a whole calendar month.
- **Dynamic Key Generation:** Every user click or form submission generates a unique client operation UUID (`crypto.randomUUID()`). Network retries of that specific operation reuse the key.
- **Multiple Partial Payments:** Because each partial collection has its own operation key, a client can make multiple partial payments within the same month (e.g., ฿2,000 on Oct 5 and ฿2,000 on Oct 20) without key collisions.
- **Replay Validation:** On duplicate key submission, the server validates all material fields (`job_id`, `amount`, `parts_cost`, `payment_type`, `billing_period`, `note`). Matching fields return the recorded payment (`isIdempotentReplay: true`); conflicting fields return HTTP 409 (`IDEMPOTENCY_CONFLICT`).

---

## 3. Migration Compatibility & Deterministic Backfill

### Upgrade Path (`migrations/0002_remediation.sql`)
For preexisting databases created under `0001_init.sql`:
1. Add columns `slot_number`, `status`, `cleanup_attempts`, `last_cleanup_error`, and `idempotency_key`.
2. Deterministically backfill `slot_number` for existing photos using SQLite window functions:
   ```sql
   UPDATE job_photos
   SET slot_number = (
     SELECT rnum FROM (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY id ASC) as rnum
       FROM job_photos
     ) t WHERE t.id = job_photos.id
   )
   WHERE slot_number IS NULL;
   ```
3. For any historical surplus photos beyond quota ($rnum > 5$), set `status = 'PENDING_DELETE'`.
4. Apply the unique index `idx_photos_job_slot ON job_photos(job_id, slot_number)`.
