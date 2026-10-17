-- Parity 2.5: Migration 0002 — Remediation for Payment Idempotency, Photo Lifecycle & Backfill
-- Compatible with both fresh and preexisting databases with historical data

-- 1. Payment Idempotency
ALTER TABLE job_payments ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency ON job_payments(user_id, idempotency_key);

-- 2. Photo Quota Slot, Concurrency Lifecycle & Retry Metadata
ALTER TABLE job_photos ADD COLUMN slot_number INTEGER CHECK(slot_number BETWEEN 1 AND 5);
ALTER TABLE job_photos ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('RESERVED', 'ACTIVE', 'PENDING_DELETE', 'FAILED'));
ALTER TABLE job_photos ADD COLUMN cleanup_attempts INTEGER DEFAULT 0;
ALTER TABLE job_photos ADD COLUMN last_cleanup_error TEXT;

-- 3. Deterministic Backfill of slot_number for Existing Photos (1..5 per job ordered by id ASC)
UPDATE job_photos
SET slot_number = (
  SELECT rnum FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY id ASC) as rnum
    FROM job_photos
  ) t WHERE t.id = job_photos.id
)
WHERE slot_number IS NULL AND (
  SELECT rnum FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY id ASC) as rnum
    FROM job_photos
  ) t WHERE t.id = job_photos.id
) <= 5;

-- 4. Mark legacy surplus photos beyond 5 as PENDING_DELETE
UPDATE job_photos
SET status = 'PENDING_DELETE'
WHERE slot_number IS NULL;

-- 5. Safe Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_job_slot ON job_photos(job_id, slot_number);
CREATE INDEX IF NOT EXISTS idx_photos_status ON job_photos(user_id, status);
