-- Parity 2.5: Migration 0002 — Remediation for Payment Idempotency & Photo Lifecycle
-- Additive, safe migration for Cloudflare D1

-- 1. Payment Idempotency
ALTER TABLE job_payments ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency ON job_payments(user_id, idempotency_key);

-- 2. Photo Quota Slot & Concurrency Lifecycle
ALTER TABLE job_photos ADD COLUMN slot_number INTEGER CHECK(slot_number BETWEEN 1 AND 5);
ALTER TABLE job_photos ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('RESERVED', 'ACTIVE', 'PENDING_DELETE', 'FAILED'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_job_slot ON job_photos(job_id, slot_number);
CREATE INDEX IF NOT EXISTS idx_photos_status ON job_photos(user_id, status);
