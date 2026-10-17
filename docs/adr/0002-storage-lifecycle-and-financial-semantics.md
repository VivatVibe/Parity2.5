# ADR 0002: Storage Lifecycle & Financial Accounting Model

## Status
Accepted

## Context
During the independent architecture audit of Parity 2.5, two critical areas required explicit architectural documentation and durable state management:
1. **Durable R2/D1 Storage Consistency & Atomic Quota (DATA-01, DATA-02):** Uncoordinated D1 SELECT COUNT and R2 PUT operations permitted concurrent quota evasion and orphaned R2 storage objects upon failures.
2. **Retainer Billing Cycle & Financial Reporting Model (FIN-01, FIN-02):** Ambiguity in multi-month retainer lifecycle, partial payments, and timezone boundary definitions.

---

## 1. Storage Lifecycle & State Transitions

### Schema Design
The `job_photos` table is enhanced with two new fields:
- `slot_number INTEGER NOT NULL CHECK(slot_number BETWEEN 1 AND 5)`: Guarantees at the database level that no job can ever exceed 5 photos.
- `status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('RESERVED', 'ACTIVE', 'PENDING_DELETE', 'FAILED'))`: Tracks lifecycle state.
- `UNIQUE(job_id, slot_number)`: Enforces concurrency safety in SQLite/D1.

### State Transition Diagram
```
[Client Upload Request]
       │
       ▼
  [RESERVED] ──(R2 Upload Failure)──► [FAILED / DELETED] (Slot immediately released)
       │
       ▼ (R2 Upload Success)
   [ACTIVE] ──(User Deletion)──► [PENDING_DELETE]
       │                                │
       │                                ▼ (R2 Object Deleted)
       │                            [DELETED] (Row removed from D1)
       │                                │
       │                                ▼ (If R2 Delete Fails)
       └──────(Orphan Sweep / Retry)──► [Re-attempt R2 Delete & Purge]
```

### Detailed Failure Recovery Rules:
1. **Atomic Slot Reservation:** Before streaming bytes to R2, the system atomically reserves an available `slot_number` (1..5) in D1 with `status = 'RESERVED'` and a timestamp. If all 5 slots are occupied, D1 immediately rejects the request. Concurrent requests contending for the same slot are serialized by `UNIQUE(job_id, slot_number)`.
2. **Upload Failure:** If the R2 write fails or times out, the `RESERVED` row is immediately removed from D1 (or marked `FAILED`), releasing the quota slot.
3. **Commit Failure:** If R2 write succeeds but D1 activation fails, the reservation remains `RESERVED`. Any reservation older than 5 minutes is considered abandoned and eligible for automatic garbage collection (`cleanupOrphanedPhotos`), which deletes the R2 object and purges the row.
4. **Deletion Crash Protection:** When deleting a photo, the system first marks the row as `PENDING_DELETE` in D1. It then deletes the object in Cloudflare R2. Only upon successful R2 deletion is the D1 record completely purged. If the R2 delete fails or the worker crashes mid-flight, the record remains in `PENDING_DELETE` with its `r2_key` intact, allowing retryable background cleanup without losing references.

---

## 2. Retainer Billing Period & Financial Accounting Model

### Domain Definitions
In Parity 2.5, **Retainer Jobs (`RETAINER`)** represent ongoing monthly service contracts (e.g., WordPress maintenance, SEO management) characterized by:
- `total_quoted_amount` / `metadata.monthlyRate`: The recurring monthly fee (e.g., ฿5,000/month).
- `metadata.billingCycleDay`: The day of each month (1–31) on which payment is due or invoiced.
- `billing_period`: A standard ISO year-month string (`YYYY-MM`, e.g., `"2026-10"`), representing the monthly service billing cycle.

### Strict Cycle Isolation Rules
1. **Cycle Separation:** Payments recorded in `job_payments` with `payment_type = 'RETAINER_CYCLE'` must specify their target `billing_period` (`YYYY-MM`). Payments for past cycles (e.g. `"2026-09"`) do not satisfy current or future cycles (`"2026-10"`).
2. **Current Cycle Paid Calculation:**
   $$\text{currentCyclePaidAmount} = \sum_{\substack{p \in \text{payments} \\ p.\text{payment\_type} = \text{'RETAINER\_CYCLE'} \\ p.\text{billing\_period} = \text{currentBangkokMonth}}} p.\text{amount}$$
   $$\text{currentCyclePaid} = (\text{currentCyclePaidAmount} \ge \text{monthlyRate}) \land (\text{monthlyRate} > 0)$$
   $$\text{balanceDue} = \max(0, \text{monthlyRate} - \text{currentCyclePaidAmount})$$
3. **Partial Payments:** If a client pays partially (e.g., ฿2,000 of a ฿5,000 monthly rate), `balanceDue` reflects the remaining ฿3,000, and `currentCyclePaid` remains `false`.
4. **Lifetime Revenue vs. Cycle Status:** `totalPaid` on a Retainer reflects cumulative lifetime collections across all months, while `isPaidInFull` and `balanceDue` reflect the status of the current active billing cycle.

### Timezone Boundaries & Accounting Definition
- **Timezone:** All financial month boundaries are strictly computed using **Asia/Bangkok (UTC+7)** (`new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" })`).
- **Database Query Alignment:** In SQLite, UTC timestamps in `paid_at` are converted to Asia/Bangkok time using `datetime(paid_at, '+7 hours')` before month extraction:
  ```sql
  strftime('%Y-%m', datetime(paid_at, '+7 hours')) = ?
  ```
  This prevents midnight transactions (e.g., 01:00 AM on the 1st of the month in Bangkok) from being misattributed to the previous calendar month.
- **Gross Profit (Contribution Margin) Definition:**
  $$\text{Contribution Margin} = \text{Revenue} - \text{Direct Hardware Parts Cost}$$
  The dashboard and API clearly define this metric as **Contribution Margin / Gross Profit before overhead**, avoiding misleading claims of full GAAP Net Profit.
