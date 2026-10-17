import type { D1Database } from "@cloudflare/workers-types";
import { type JobInput, type JobStatus, parseJobMetadata } from "../schemas/job";
import { deletePhoto } from "./storage";

export interface UserRecord {
  id: number;
  email: string;
  name: string;
  avatar_url?: string;
  created_at: string;
}

export interface ClientRecord {
  id: number;
  user_id: number;
  name: string;
  phone?: string;
  line_id?: string;
  notes?: string;
  created_at: string;
}

export interface JobRecord {
  id: number;
  user_id: number;
  client_id: number;
  job_number: string;
  job_type: "REPAIR" | "PROJECT" | "RETAINER";
  title: string;
  status: JobStatus;
  due_date?: string;
  total_quoted_amount: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface JobPaymentRecord {
  id: number;
  job_id: number;
  user_id: number;
  amount: number;
  parts_cost: number;
  payment_type: "DEPOSIT" | "MILESTONE" | "FINAL" | "RETAINER_CYCLE";
  billing_period?: string;
  paid_at: string;
  note?: string;
  idempotency_key?: string;
}

export interface JobPhotoRecord {
  id: number;
  job_id: number;
  user_id: number;
  slot_number?: number | null;
  r2_key: string;
  caption?: string;
  status: "RESERVED" | "ACTIVE" | "PENDING_DELETE" | "FAILED" | "CLEANING";
  cleanup_attempts?: number;
  last_cleanup_error?: string;
  cleanup_worker_id?: string;
  cleanup_generation?: number;
  cleanup_lease_expires_at?: string;
  created_at: string;
}

const initializedDbs = new WeakSet<D1Database>();

// 1. Database Schema Initialization (Used for local tests & dev migrations)
export async function initDatabase(db: D1Database): Promise<void> {
  if (initializedDbs.has(db)) return;
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      line_id TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      job_number TEXT NOT NULL,
      job_type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      due_date TEXT,
      total_quoted_amount REAL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, job_number)
    );

    CREATE TABLE IF NOT EXISTS job_counters (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prefix TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, prefix)
    );

    CREATE TABLE IF NOT EXISTS job_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK(amount > 0),
      parts_cost REAL DEFAULT 0 CHECK(parts_cost >= 0),
      payment_type TEXT NOT NULL,
      billing_period TEXT,
      paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      note TEXT,
      idempotency_key TEXT,
      UNIQUE(user_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS job_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot_number INTEGER CHECK(slot_number BETWEEN 1 AND 5),
      r2_key TEXT NOT NULL,
      caption TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('RESERVED', 'ACTIVE', 'PENDING_DELETE', 'FAILED', 'CLEANING')),
      cleanup_attempts INTEGER DEFAULT 0,
      last_cleanup_error TEXT,
      cleanup_worker_id TEXT,
      cleanup_generation INTEGER DEFAULT 0,
      cleanup_lease_expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_id, slot_number)
    );

    CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
    CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(user_id, phone);
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_type ON jobs(user_id, job_type);
    CREATE INDEX IF NOT EXISTS idx_payments_job ON job_payments(job_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_payments_billing ON job_payments(user_id, billing_period);
    CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON job_payments(user_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_photos_job ON job_photos(job_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_photos_status ON job_photos(user_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_job_slot ON job_photos(job_id, slot_number);
  `;

  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
  initializedDbs.add(db);
}

// 2. User Operations (Strictly scoped)
export async function getUserByEmail(db: D1Database, email: string): Promise<UserRecord | null> {
  const result = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRecord>();
  return result || null;
}

export async function getUserById(db: D1Database, userId: number): Promise<UserRecord | null> {
  const result = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRecord>();
  return result || null;
}

export async function getOrCreateUser(
  db: D1Database,
  email: string,
  name: string,
  avatarUrl?: string
): Promise<UserRecord> {
  const existing = await getUserByEmail(db, email);
  if (existing) return existing;

  const res = await db
    .prepare("INSERT INTO users (email, name, avatar_url) VALUES (?, ?, ?) RETURNING *")
    .bind(email, name, avatarUrl || null)
    .first<UserRecord>();

  if (!res) throw new Error("Failed to create user");
  return res;
}

// 3. Client Operations (Enforcing userId)
export async function getClients(db: D1Database, userId: number): Promise<ClientRecord[]> {
  const { results } = await db
    .prepare("SELECT * FROM clients WHERE user_id = ? ORDER BY id DESC")
    .bind(userId)
    .all<ClientRecord>();
  return results || [];
}

export async function searchClients(
  db: D1Database,
  userId: number,
  searchQuery: string
): Promise<ClientRecord[]> {
  const q = `%${searchQuery.trim()}%`;
  const { results } = await db
    .prepare(
      "SELECT * FROM clients WHERE user_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY id DESC LIMIT 10"
    )
    .bind(userId, q, q)
    .all<ClientRecord>();
  return results || [];
}

export async function createClient(
  db: D1Database,
  userId: number,
  client: { name: string; phone?: string; lineId?: string; notes?: string }
): Promise<ClientRecord> {
  const res = await db
    .prepare(
      "INSERT INTO clients (user_id, name, phone, line_id, notes) VALUES (?, ?, ?, ?, ?) RETURNING *"
    )
    .bind(userId, client.name, client.phone || null, client.lineId || null, client.notes || null)
    .first<ClientRecord>();

  if (!res) throw new Error("Failed to create client");
  return res;
}

// 4. Atomic Counter & Sequence Generator
export async function getNextJobNumber(
  db: D1Database,
  userId: number,
  jobType: "REPAIR" | "PROJECT" | "RETAINER"
): Promise<string> {
  const prefixMap: Record<string, string> = {
    REPAIR: "PR",
    PROJECT: "PJ",
    RETAINER: "RT",
  };
  const prefix = prefixMap[jobType] || "JB";

  const query = `
    INSERT INTO job_counters (user_id, prefix, seq)
    VALUES (?, ?, 1)
    ON CONFLICT(user_id, prefix) DO UPDATE SET seq = seq + 1
    RETURNING seq;
  `;
  const result = await db.prepare(query).bind(userId, prefix).first<{ seq: number }>();
  const seq = result?.seq ?? 1;

  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

// 5. Job Operations (Enforcing userId & client verification)
export async function createJob(
  db: D1Database,
  userId: number,
  input: JobInput
): Promise<JobRecord> {
  // Prevent Cross-Tenant client_id injection
  const client = await db
    .prepare("SELECT id FROM clients WHERE id = ? AND user_id = ?")
    .bind(input.client_id, userId)
    .first<ClientRecord>();

  if (!client) {
    throw new Error(`Client ID ${input.client_id} not found or does not belong to user ${userId}`);
  }

  const jobNumber = await getNextJobNumber(db, userId, input.job_type);
  const metadataJson = JSON.stringify(input.metadata);
  const initialStatus = input.job_type === "RETAINER" ? "ACTIVE" : "RECEIVED";

  // Retainer Rate Sync: sync total_quoted_amount with monthlyRate if 0 or omitted
  let totalQuoted = input.total_quoted_amount || 0;
  if (input.job_type === "RETAINER" && (!totalQuoted || totalQuoted === 0)) {
    totalQuoted = (input.metadata as any).monthlyRate || 0;
  }

  const res = await db
    .prepare(
      `INSERT INTO jobs (
        user_id, client_id, job_number, job_type, title, status, due_date, total_quoted_amount, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      userId,
      input.client_id,
      jobNumber,
      input.job_type,
      input.title,
      initialStatus,
      input.due_date || null,
      totalQuoted,
      metadataJson
    )
    .first<JobRecord>();

  if (!res) throw new Error("Failed to create job");
  return res;
}

export async function getJobs(
  db: D1Database,
  userId: number,
  filter?: { status?: string; jobType?: string }
): Promise<JobRecord[]> {
  let query = "SELECT * FROM jobs WHERE user_id = ?";
  const params: any[] = [userId];

  if (filter?.status) {
    query += " AND status = ?";
    params.push(filter.status);
  }
  if (filter?.jobType) {
    query += " AND job_type = ?";
    params.push(filter.jobType);
  }

  query += " ORDER BY id DESC";

  const { results } = await db.prepare(query).bind(...params).all<JobRecord>();
  return results || [];
}

export interface JobFinancialSummary {
  totalQuotedAmount: number;
  totalPaid: number;
  totalPartsCost: number;
  balanceDue: number;
  netProfit: number;
  isPaidInFull: boolean;
  currentCyclePaid?: boolean;
  currentCyclePeriod?: string;
}

export async function getJobFinancialSummary(
  db: D1Database,
  userId: number,
  job: JobRecord,
  payments?: JobPaymentRecord[]
): Promise<JobFinancialSummary> {
  const jobPayments = payments ?? (await getJobPayments(db, userId, job.id));

  let totalPaid = 0;
  let loggedPartsCost = 0;
  let hasSpecificPartsCost = false;

  for (const p of jobPayments) {
    totalPaid += Number(p.amount) || 0;
    if (p.parts_cost && Number(p.parts_cost) > 0) {
      loggedPartsCost += Number(p.parts_cost);
      hasSpecificPartsCost = true;
    }
  }

  // Fallback to metadata.partsCost for REPAIR if no payments logged parts_cost yet
  let parsedMeta: any = {};
  try {
    parsedMeta = JSON.parse(job.metadata || "{}");
  } catch (e) {}

  let totalPartsCost = loggedPartsCost;
  if (!hasSpecificPartsCost && job.job_type === "REPAIR" && parsedMeta.partsCost) {
    totalPartsCost = Number(parsedMeta.partsCost) || 0;
  }

  const totalQuotedAmount = Number(job.total_quoted_amount) || 0;
  let balanceDue = Math.max(0, totalQuotedAmount - totalPaid);
  const netProfit = totalPaid - totalPartsCost;
  let isPaidInFull = totalQuotedAmount > 0 && balanceDue === 0;

  let currentCyclePaid: boolean | undefined = undefined;
  let currentCyclePeriod: string | undefined = undefined;

  if (job.job_type === "RETAINER") {
    const currentYearMonth = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());

    currentCyclePeriod = currentYearMonth;
    const monthlyRate = Number(parsedMeta?.monthlyRate) || totalQuotedAmount;

    const currentCyclePaidAmount = jobPayments
      .filter((p) => p.payment_type === "RETAINER_CYCLE" && p.billing_period === currentYearMonth)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    currentCyclePaid = currentCyclePaidAmount >= monthlyRate && monthlyRate > 0;
    balanceDue = Math.max(0, monthlyRate - currentCyclePaidAmount);
    isPaidInFull = monthlyRate > 0 && balanceDue === 0;
  }

  return {
    totalQuotedAmount,
    totalPaid,
    totalPartsCost,
    balanceDue,
    netProfit,
    isPaidInFull,
    currentCyclePaid,
    currentCyclePeriod,
  };
}

export async function getJobById(
  db: D1Database,
  userId: number,
  jobId: number
): Promise<
  | (JobRecord & {
      client?: ClientRecord;
      parsedMetadata?: any;
      payments: JobPaymentRecord[];
      financialSummary: JobFinancialSummary;
      photos: JobPhotoRecord[];
    })
  | null
> {
  const job = await db
    .prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<JobRecord>();

  if (!job) return null;

  const client = await db
    .prepare("SELECT * FROM clients WHERE id = ? AND user_id = ?")
    .bind(job.client_id, userId)
    .first<ClientRecord>();

  const parsedMetadata = parseJobMetadata(job.job_type, job.metadata);
  const payments = await getJobPayments(db, userId, job.id);
  const financialSummary = await getJobFinancialSummary(db, userId, job, payments);
  const photos = await getJobPhotos(db, userId, job.id);

  return {
    ...job,
    client: client || undefined,
    parsedMetadata,
    payments,
    financialSummary,
    photos,
  };
}

export async function updateJobStatus(
  db: D1Database,
  userId: number,
  jobId: number,
  status: JobStatus
): Promise<boolean> {
  // Strict tenant verification: verify job exists and belongs to this user
  const job = await db
    .prepare("SELECT id FROM jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<{ id: number }>();

  if (!job) return false;

  const res = await db
    .prepare("UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
    .bind(status, jobId, userId)
    .run();

  return res.success;
}

// 6. Payment Operations (Financial Ledger with DATA-03 Idempotency)
export async function addJobPayment(
  db: D1Database,
  userId: number,
  payment: {
    jobId: number;
    amount: number;
    partsCost?: number;
    paymentType: "DEPOSIT" | "MILESTONE" | "FINAL" | "RETAINER_CYCLE";
    billingPeriod?: string;
    note?: string;
    idempotencyKey?: string;
  }
): Promise<JobPaymentRecord & { isIdempotentReplay?: boolean }> {
  // Strict Tenant Isolation: verify job exists and belongs to this user
  const job = await db
    .prepare("SELECT id FROM jobs WHERE id = ? AND user_id = ?")
    .bind(payment.jobId, userId)
    .first<{ id: number }>();

  if (!job) {
    throw new Error(`Job ID ${payment.jobId} not found or does not belong to user ${userId}`);
  }

  if (payment.amount <= 0) {
    throw new Error("Payment amount must be greater than 0");
  }

  const idempotencyKey = payment.idempotencyKey ? payment.idempotencyKey.trim() : null;

function isPaymentPayloadMatch(
  existing: JobPaymentRecord,
  payment: {
    jobId: number;
    amount: number;
    partsCost?: number;
    paymentType: string;
    billingPeriod?: string;
    note?: string;
  }
): boolean {
  return (
    existing.job_id === payment.jobId &&
    Number(existing.amount) === Number(payment.amount) &&
    Number(existing.parts_cost || 0) === Number(payment.partsCost || 0) &&
    existing.payment_type === payment.paymentType &&
    (existing.billing_period || null) === (payment.billingPeriod || null) &&
    (existing.note || null) === (payment.note || null)
  );
}

  // DATA-03: If idempotency key provided, check for existing entry
  if (idempotencyKey) {
    const existing = await db
      .prepare("SELECT * FROM job_payments WHERE user_id = ? AND idempotency_key = ?")
      .bind(userId, idempotencyKey)
      .first<JobPaymentRecord>();

    if (existing) {
      if (isPaymentPayloadMatch(existing, payment)) {
        return { ...existing, isIdempotentReplay: true };
      } else {
        throw new Error("IDEMPOTENCY_CONFLICT: Key reused with conflicting payment parameters");
      }
    }
  }

  try {
    const res = await db
      .prepare(
        `INSERT INTO job_payments (
          job_id, user_id, amount, parts_cost, payment_type, billing_period, note, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .bind(
        payment.jobId,
        userId,
        payment.amount,
        payment.partsCost || 0,
        payment.paymentType,
        payment.billingPeriod || null,
        payment.note || null,
        idempotencyKey
      )
      .first<JobPaymentRecord>();

    if (!res) throw new Error("Failed to record payment");
    return res;
  } catch (err: any) {
    // If unique constraint collision triggered under race conditions:
    if (idempotencyKey && err.message && (err.message.includes("UNIQUE") || err.message.includes("constraint"))) {
      const existing = await db
        .prepare("SELECT * FROM job_payments WHERE user_id = ? AND idempotency_key = ?")
        .bind(userId, idempotencyKey)
        .first<JobPaymentRecord>();

      if (existing) {
        if (isPaymentPayloadMatch(existing, payment)) {
          return { ...existing, isIdempotentReplay: true };
        } else {
          throw new Error("IDEMPOTENCY_CONFLICT: Key reused with conflicting payment parameters");
        }
      }
    }
    throw err;
  }
}

export async function getJobPayments(
  db: D1Database,
  userId: number,
  jobId: number
): Promise<JobPaymentRecord[]> {
  const { results } = await db
    .prepare("SELECT * FROM job_payments WHERE job_id = ? AND user_id = ? ORDER BY paid_at ASC")
    .bind(jobId, userId)
    .all<JobPaymentRecord>();
  return results || [];
}

// 7. Photo Operations (Atomic Reservation, Quota & Durable Lifecycle)
export async function getJobPhotos(
  db: D1Database,
  userId: number,
  jobId: number
): Promise<JobPhotoRecord[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM job_photos WHERE job_id = ? AND user_id = ? AND status = 'ACTIVE' ORDER BY slot_number ASC, id ASC"
    )
    .bind(jobId, userId)
    .all<JobPhotoRecord>();
  return results || [];
}

/**
 * SEC-02: Strictly require tenant ownership for photo lookup.
 * Unsafe optional userId is removed; userId is strictly required.
 */
export async function getJobPhotoById(
  db: D1Database,
  jobId: number,
  photoId: number,
  userId: number
): Promise<JobPhotoRecord | null> {
  if (typeof userId !== "number" || isNaN(userId) || userId <= 0) {
    throw new Error("Tenant userId is strictly required for photo lookup");
  }

  const photo = await db
    .prepare("SELECT * FROM job_photos WHERE id = ? AND job_id = ? AND user_id = ?")
    .bind(photoId, jobId, userId)
    .first<JobPhotoRecord>();

  return photo || null;
}

export async function validatePhotoUploadQuota(
  db: D1Database,
  userId: number,
  jobId: number
): Promise<void> {
  const job = await db
    .prepare("SELECT id FROM jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<{ id: number }>();

  if (!job) {
    throw new Error(`Job ID ${jobId} not found or does not belong to user ${userId}`);
  }

  const countResult = await db
    .prepare(
      `SELECT COUNT(*) as count FROM job_photos 
       WHERE job_id = ? AND user_id = ? AND status IN ('ACTIVE', 'RESERVED')`
    )
    .bind(jobId, userId)
    .first<{ count: number }>();

  const currentCount = countResult?.count ?? 0;
  if (currentCount >= 5) {
    throw new Error("อัปโหลดรูปภาพได้สูงสุด 5 รูปต่อใบงาน (Max 5 photos reached)");
  }
}

/**
 * DATA-01 & DATA-02: Atomically reserve a photo slot (1..5) in D1 before streaming to R2.
 */
export async function reservePhotoSlot(
  db: D1Database,
  userId: number,
  jobId: number,
  r2Key: string,
  caption?: string
): Promise<JobPhotoRecord> {
  const job = await db
    .prepare("SELECT id FROM jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<{ id: number }>();

  if (!job) {
    throw new Error(`Job ID ${jobId} not found or does not belong to user ${userId}`);
  }

  // Fetch current occupied slots
  const existingRows = await db
    .prepare(
      `SELECT id, slot_number, status, created_at FROM job_photos 
       WHERE job_id = ? AND user_id = ? AND status IN ('ACTIVE', 'RESERVED', 'CLEANING')`
    )
    .bind(jobId, userId)
    .all<{ id: number; slot_number: number | null; status: string; created_at: string }>();

  const totalCount = existingRows.results?.length ?? 0;
  if (totalCount >= 5) {
    throw new Error("อัปโหลดรูปภาพได้สูงสุด 5 รูปต่อใบงาน (Max 5 photos reached)");
  }

  const occupiedSlots = new Set<number>();
  for (const row of existingRows.results || []) {
    if (row.slot_number !== null && row.slot_number !== undefined) {
      occupiedSlots.add(row.slot_number);
    }
  }

  if (occupiedSlots.size >= 5) {
    throw new Error("อัปโหลดรูปภาพได้สูงสุด 5 รูปต่อใบงาน (Max 5 photos reached)");
  }

  // Find lowest free slot (1..5)
  let chosenSlot = -1;
  for (let s = 1; s <= 5; s++) {
    if (!occupiedSlots.has(s)) {
      chosenSlot = s;
      break;
    }
  }

  if (chosenSlot === -1) {
    throw new Error("อัปโหลดรูปภาพได้สูงสุด 5 รูปต่อใบงาน (Max 5 photos reached)");
  }

  try {
    const res = await db
      .prepare(
        `INSERT INTO job_photos (job_id, user_id, slot_number, r2_key, caption, status)
         VALUES (?, ?, ?, ?, ?, 'RESERVED') RETURNING *`
      )
      .bind(jobId, userId, chosenSlot, r2Key, caption || null)
      .first<JobPhotoRecord>();

    if (!res) throw new Error("Failed to reserve photo slot");
    return res;
  } catch (err: any) {
    // Handle concurrent contender race condition
    if (err.message && (err.message.includes("UNIQUE") || err.message.includes("constraint"))) {
      const retrySlots = await db
        .prepare(
          `SELECT slot_number FROM job_photos 
           WHERE job_id = ? AND user_id = ? AND status IN ('ACTIVE', 'RESERVED', 'CLEANING')`
        )
        .bind(jobId, userId)
        .all<{ slot_number: number | null }>();
      const currentOccupied = new Set(
        (retrySlots.results || [])
          .map((r) => r.slot_number)
          .filter((s): s is number => s !== null && s !== undefined)
      );
      if (currentOccupied.size >= 5 || (retrySlots.results || []).length >= 5) {
        throw new Error("อัปโหลดรูปภาพได้สูงสุด 5 รูปต่อใบงาน (Max 5 photos reached)");
      }
      for (let s = 1; s <= 5; s++) {
        if (!currentOccupied.has(s)) {
          const resRetry = await db
            .prepare(
              `INSERT INTO job_photos (job_id, user_id, slot_number, r2_key, caption, status)
               VALUES (?, ?, ?, ?, ?, 'RESERVED') RETURNING *`
            )
            .bind(jobId, userId, s, r2Key, caption || null)
            .first<JobPhotoRecord>();
          if (resRetry) return resRetry;
        }
      }
      throw new Error("อัปโหลดรูปภาพได้สูงสุด 5 รูปต่อใบงาน (Max 5 photos reached)");
    }
    throw err;
  }
}

export async function activatePhotoSlot(
  db: D1Database,
  userId: number,
  photoId: number,
  r2Key?: string
): Promise<JobPhotoRecord> {
  let query = `
    UPDATE job_photos 
    SET status = 'ACTIVE' 
    WHERE id = ? AND user_id = ? AND status = 'RESERVED' 
      AND created_at >= datetime('now', '-5 minutes')
  `;
  const params: any[] = [photoId, userId];

  if (r2Key) {
    query = `
      UPDATE job_photos 
      SET status = 'ACTIVE' 
      WHERE id = ? AND user_id = ? AND r2_key = ? AND status = 'RESERVED' 
        AND created_at >= datetime('now', '-5 minutes')
    `;
    params.push(r2Key);
  }

  query += " RETURNING *";

  const res = await db.prepare(query).bind(...params).first<JobPhotoRecord>();

  if (!res) {
    throw new Error(
      "Failed to activate photo record: reservation expired (>5m), already cleaned up, or invalid key"
    );
  }
  return res;
}

export async function failPhotoSlot(
  db: D1Database,
  userId: number,
  photoId: number
): Promise<void> {
  await db
    .prepare("DELETE FROM job_photos WHERE id = ? AND user_id = ? AND status = 'RESERVED'")
    .bind(photoId, userId)
    .run();
}

export async function markPhotoForDeletion(
  db: D1Database,
  userId: number,
  jobId: number,
  photoId: number
): Promise<JobPhotoRecord> {
  // P0-02 / R7-A1: Unified deletion ownership protocol with atomic generation fencing.
  // Atomically increment cleanup_generation to fence out prior workers or in-flight leases.
  // Only allow transition from non-CLEANING states or from expired CLEANING leases.
  const photo = await db
    .prepare(
      `UPDATE job_photos 
       SET status = 'PENDING_DELETE', 
           slot_number = NULL,
           cleanup_generation = COALESCE(cleanup_generation, 0) + 1
       WHERE id = ? AND job_id = ? AND user_id = ? 
         AND (
           status != 'CLEANING' 
           OR cleanup_lease_expires_at IS NULL 
           OR cleanup_lease_expires_at < datetime('now')
         )
       RETURNING *`
    )
    .bind(photoId, jobId, userId)
    .first<JobPhotoRecord>();

  if (!photo) {
    // Check if photo exists to diagnose active background lease contention vs non-existent photo
    const existing = await db
      .prepare(
        "SELECT id, status, cleanup_lease_expires_at FROM job_photos WHERE id = ? AND job_id = ? AND user_id = ?"
      )
      .bind(photoId, jobId, userId)
      .first<{ id: number; status: string; cleanup_lease_expires_at: string | null }>();

    if (!existing) {
      throw new Error(`Photo ID ${photoId} not found or does not belong to user ${userId}`);
    }
    // Photo exists but is locked by an active background cleanup lease
    throw new Error(
      `Photo ID ${photoId} is currently locked by active background cleanup processing`
    );
  }
  return photo;
}

export async function claimPhotoForDeletion(
  db: D1Database,
  userId: number,
  jobId: number,
  photoId: number,
  workerId: string,
  leaseMinutes = 2
): Promise<JobPhotoRecord> {
  // R8-A2 / R9-01: Exclusive deletion ownership protocol.
  // Distributed safety invariant:
  // - At-most-one valid D1 lease owner: D1 atomic CAS guarantees at-most-one worker holds an active lease and can finalize.
  // - Idempotent external R2 deletion: Keys are immutable UUIDs; if a lease expires while an R2 delete is in flight,
  //   subsequent background sweeper DELETE is idempotent.
  // Fails if the row is already locked by another cleaner holding an unexpired lease.
  const photo = await db
    .prepare(
      `UPDATE job_photos 
       SET status = 'CLEANING', 
           cleanup_worker_id = ?,
           cleanup_generation = COALESCE(cleanup_generation, 0) + 1,
           cleanup_lease_expires_at = datetime('now', '+' || ? || ' minutes'),
           slot_number = NULL
       WHERE id = ? AND job_id = ? AND user_id = ? 
         AND (
           status != 'CLEANING' 
           OR cleanup_lease_expires_at IS NULL 
           OR cleanup_lease_expires_at < datetime('now')
         )
       RETURNING *`
    )
    .bind(workerId, leaseMinutes, photoId, jobId, userId)
    .first<JobPhotoRecord>();

  if (!photo) {
    const existing = await db
      .prepare(
        "SELECT id, status, cleanup_lease_expires_at FROM job_photos WHERE id = ? AND job_id = ? AND user_id = ?"
      )
      .bind(photoId, jobId, userId)
      .first<{ id: number; status: string; cleanup_lease_expires_at: string | null }>();

    if (!existing) {
      throw new Error(`Photo ID ${photoId} not found or does not belong to user ${userId}`);
    }
    throw new Error(
      `Photo ID ${photoId} is currently locked by active background cleanup processing`
    );
  }
  return photo;
}

export async function markPhotoSlotForCleanupRetry(
  db: D1Database,
  userId: number,
  photoId: number,
  lastError: string,
  r2Key?: string,
  jobId?: number
): Promise<void> {
  // R8-A3 / R9-02 / R10-01: Lease-aware durable failure recording.
  // Only transitions rows that are NOT actively CLEANING with a valid lease held by another worker.
  // This prevents upload cleanup from overwriting a sweeper's active ownership.
  const res = await db
    .prepare(
      `UPDATE job_photos 
       SET status = 'PENDING_DELETE', 
           slot_number = NULL, 
           cleanup_attempts = COALESCE(cleanup_attempts, 0) + 1,
           last_cleanup_error = ?
       WHERE id = ? AND user_id = ?
         AND (
           status != 'CLEANING'
           OR cleanup_lease_expires_at IS NULL
           OR cleanup_lease_expires_at < datetime('now')
         )`
    )
    .bind(lastError, photoId, userId)
    .run();

  const changes = (res as any)?.changes ?? (res as any)?.meta?.changes ?? 0;
  if (changes === 0 && r2Key) {
    // Distinguish: row actively owned vs row missing
    const existing = await db
      .prepare("SELECT id, status FROM job_photos WHERE id = ? AND user_id = ?")
      .bind(photoId, userId)
      .first<{ id: number; status: string }>();

    if (existing) {
      // Row exists but is actively CLEANING with a valid lease — do not overwrite.
      // The current owner will handle cleanup; no action needed.
      return;
    }

    // R9-02 / R10-04: Row is truly missing (purged by sweeper). Insert tombstone for durable retry.
    // Wrapped in try/catch: if parent job is missing (FK constraint) or concurrent tombstone creation,
    // R2 reconciler serves as the last-resort cleanup path for orphaned R2 objects.
    const derivedJobId = jobId || Number(r2Key.match(/jobs\/(\d+)\//)?.[1]) || null;
    if (derivedJobId) {
      try {
        await db
          .prepare(
            `INSERT INTO job_photos (job_id, user_id, slot_number, r2_key, status, cleanup_attempts, last_cleanup_error)
             VALUES (?, ?, NULL, ?, 'PENDING_DELETE', 1, ?)`
          )
          .bind(derivedJobId, userId, r2Key, `Orphan recovery: ${lastError}`)
          .run();
      } catch {
        // ponytail: tombstone INSERT failed (FK violation, duplicate key, etc.).
        // R2 reconciler will catch the orphaned R2 object after safetyGracePeriodMs expires.
      }
    }
    // ponytail: if derivedJobId is null or tombstone INSERT failed, the R2 object becomes an orphan
    // that the periodic R2 reconciler (reconcileR2Storage) will purge after the 60-minute grace period.
  }
}

export async function finalizePhotoDeletion(
  db: D1Database,
  userId: number,
  photoId: number,
  workerId?: string,
  expectedGeneration?: number
): Promise<boolean> {
  // R8-A1 & R8-A2: Conditional finalization fencing under active exclusive lease.
  // Strictly verifies ownership, generation token, and active lease validity.
  let query: string;
  const params: any[] = [photoId, userId];

  if (workerId) {
    query = `DELETE FROM job_photos 
             WHERE id = ? AND user_id = ? 
               AND status = 'CLEANING' 
               AND cleanup_worker_id = ? 
               AND cleanup_lease_expires_at IS NOT NULL 
               AND cleanup_lease_expires_at >= datetime('now')`;
    params.push(workerId);
    if (expectedGeneration !== undefined) {
      query += " AND (cleanup_generation IS ? OR cleanup_generation = ?)";
      params.push(expectedGeneration, expectedGeneration);
    }
  } else {
    query = `DELETE FROM job_photos 
             WHERE id = ? AND user_id = ? 
               AND status = 'PENDING_DELETE'`;
    if (expectedGeneration !== undefined) {
      query += " AND (cleanup_generation IS ? OR cleanup_generation = ?)";
      params.push(expectedGeneration, expectedGeneration);
    }
  }

  const res = await db.prepare(query).bind(...params).run();
  const changes = (res as any)?.changes ?? (res as any)?.meta?.changes ?? 0;
  return changes > 0;
}

export async function createJobPhoto(
  db: D1Database,
  userId: number,
  jobId: number,
  r2Key: string,
  caption?: string
): Promise<JobPhotoRecord> {
  const reserved = await reservePhotoSlot(db, userId, jobId, r2Key, caption);
  return await activatePhotoSlot(db, userId, reserved.id);
}

export async function deleteJobPhoto(
  db: D1Database,
  userId: number,
  jobId: number,
  photoId: number
): Promise<JobPhotoRecord> {
  const workerId = `delete-worker-${userId}-${Date.now()}`;
  const claimed = await claimPhotoForDeletion(db, userId, jobId, photoId, workerId);
  await finalizePhotoDeletion(db, userId, photoId, workerId, claimed.cleanup_generation);
  return claimed;
}

export async function handlePhotoDeletionRequest(
  db: D1Database,
  r2: any,
  userId: number,
  jobId: number,
  photoId: number,
  customWorkerId?: string
): Promise<{ status: number; body: { success?: boolean; deletedPhotoId?: number; error?: string } }> {
  const workerId =
    customWorkerId ||
    `http-del-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let claimedPhoto: JobPhotoRecord;
  try {
    claimedPhoto = await claimPhotoForDeletion(db, userId, jobId, photoId, workerId);
  } catch (claimErr: any) {
    const isConflict = claimErr?.message?.includes("currently locked by active background cleanup");
    const isNotFound = claimErr?.message?.includes("not found");
    return {
      status: isConflict ? 409 : isNotFound ? 404 : 400,
      body: { error: claimErr?.message || "Failed to claim photo for deletion" },
    };
  }

  // R9-01 Invariant: At-most-one valid D1 lease owner + idempotent external R2 deletion on immutable UUID keys.
  // D1 CAS generation fencing guarantees at-most-one worker can successfully finalize row deletion.
  // In the event of lease expiry during in-flight external R2 deletion, concurrent DELETEs to the same immutable UUID key are idempotent.
  try {
    await deletePhoto(r2, claimedPhoto.r2_key);
  } catch (r2Err: any) {
    // R9-03 / R10-03: Record diagnostic metadata fenced by generation, status, and active lease validity.
    // A stale worker whose lease expired cannot overwrite a new owner's metadata.
    await db
      .prepare(
        `UPDATE job_photos 
         SET cleanup_attempts = COALESCE(cleanup_attempts, 0) + 1,
             last_cleanup_error = ?
         WHERE id = ? AND user_id = ? 
           AND status = 'CLEANING'
           AND cleanup_worker_id = ?
           AND cleanup_generation = ?
           AND cleanup_lease_expires_at IS NOT NULL
           AND cleanup_lease_expires_at >= datetime('now')`
      )
      .bind(r2Err?.message || "R2 delete failed", photoId, userId, workerId, claimedPhoto.cleanup_generation)
      .run();

    return {
      status: 502,
      body: { error: `Storage deletion failed: ${r2Err?.message || "Unknown R2 error"}` },
    };
  }

  // R8-A1: Finalize deletion in D1 verifying active lease and generation ownership
  const finalized = await finalizePhotoDeletion(
    db,
    userId,
    photoId,
    workerId,
    claimedPhoto.cleanup_generation
  );

  if (!finalized) {
    // R8-A1: Never falsely return success if D1 finalization failed or lease expired
    return {
      status: 409,
      body: { error: "Photo deletion lease expired or was preempted before finalization" },
    };
  }

  return {
    status: 200,
    body: { success: true, deletedPhotoId: photoId },
  };
}

export async function handlePhotoUploadActivationFailure(
  db: D1Database,
  r2: any,
  userId: number,
  slotId: number,
  r2Key: string,
  activationError: any,
  jobId?: number
): Promise<void> {
  // R8-A3 / R9-02: Durable cleanup on activation failure.
  // If R2 deletion succeeds, purge the reservation immediately via failPhotoSlot.
  // If R2 deletion fails, preserve or insert row as PENDING_DELETE with diagnostic error for sweeper retry.
  let r2Deleted = false;
  try {
    await deletePhoto(r2, r2Key);
    r2Deleted = true;
  } catch (r2Err: any) {
    await markPhotoSlotForCleanupRetry(
      db,
      userId,
      slotId,
      r2Err?.message || "R2 cleanup failed",
      r2Key,
      jobId
    );
  }
  if (r2Deleted) {
    try {
      await failPhotoSlot(db, userId, slotId);
    } catch {
      // R10-02: failPhotoSlot only deletes RESERVED rows. If the row changed status
      // (e.g. transient D1 error, or sweeper already claimed it), set PENDING_DELETE
      // which the background sweeper already handles. R2 is already deleted, so
      // sweeper's idempotent R2 delete is safe — it just purges the D1 metadata.
      try {
        await db
          .prepare(
            `UPDATE job_photos SET status = 'PENDING_DELETE', slot_number = NULL 
             WHERE id = ? AND user_id = ?
               AND (
                 status != 'CLEANING'
                 OR cleanup_lease_expires_at IS NULL
                 OR cleanup_lease_expires_at < datetime('now')
               )`
          )
          .bind(slotId, userId)
          .run();
      } catch {
        // ponytail: D1 is unreachable. Row stays as RESERVED and sweeper will
        // pick it up after the 5-minute reservation expiry.
      }
    }
  }
}

export async function renewPhotoCleanupLease(
  db: D1Database,
  photoId: number,
  workerId: string,
  generation: number,
  extensionMinutes = 2
): Promise<boolean> {
  // P0-02: Enforce lease ownership, exact generation, AND that lease is still unexpired
  const res = await db
    .prepare(
      `UPDATE job_photos 
       SET cleanup_lease_expires_at = datetime('now', '+' || ? || ' minutes')
       WHERE id = ? 
         AND status = 'CLEANING' 
         AND cleanup_worker_id = ? 
         AND cleanup_generation = ?
         AND cleanup_lease_expires_at IS NOT NULL
         AND cleanup_lease_expires_at >= datetime('now')`
    )
    .bind(extensionMinutes, photoId, workerId, generation)
    .run();
  const changes = (res as any)?.changes ?? (res as any)?.meta?.changes ?? 0;
  return changes > 0;
}

export async function cleanupOrphanedPhotos(
  db: D1Database,
  r2: any,
  userId?: number,
  workerId?: string
): Promise<{ cleanedCount: number; failedCount: number; skippedCount: number }> {
  const currentWorkerId =
    workerId ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // 1. Select candidate records for cleanup:
  // - Explicitly marked PENDING_DELETE
  // - Expired RESERVED (> 5m old)
  // - Stale CLEANING leases where cleanup_lease_expires_at is strictly in the PAST
  let query = `
    SELECT id, user_id, r2_key, status, created_at, cleanup_attempts, cleanup_generation, cleanup_lease_expires_at 
    FROM job_photos 
    WHERE (
      status = 'PENDING_DELETE' 
      OR (status = 'RESERVED' AND created_at < datetime('now', '-5 minutes'))
      OR (status = 'CLEANING' AND cleanup_lease_expires_at IS NOT NULL AND cleanup_lease_expires_at < datetime('now'))
    )
  `;
  const params: any[] = [];
  if (userId !== undefined) {
    query += " AND user_id = ?";
    params.push(userId);
  }

  const { results } = await db.prepare(query).bind(...params).all<{
    id: number;
    user_id: number;
    r2_key: string;
    status: string;
    created_at: string;
    cleanup_attempts: number;
    cleanup_generation: number;
    cleanup_lease_expires_at: string | null;
  }>();

  let cleanedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const row of results || []) {
    const expectedGen = row.cleanup_generation ?? 0;

    // 2. P0-02 Atomic CAS state transition to 'CLEANING':
    // - Enforce expected cleanup_generation in predicate
    // - Atomically increment generation in SQL: COALESCE(cleanup_generation, 0) + 1
    // - Retrieve the new generation directly via RETURNING
    const claimRes = await db
      .prepare(
        `UPDATE job_photos 
         SET status = 'CLEANING', 
             cleanup_worker_id = ?, 
             cleanup_generation = COALESCE(cleanup_generation, 0) + 1,
             cleanup_lease_expires_at = datetime('now', '+2 minutes'),
             slot_number = NULL
         WHERE id = ? 
           AND (cleanup_generation IS ? OR cleanup_generation = ?)
           AND (
             status = 'PENDING_DELETE' 
             OR (status = 'RESERVED' AND created_at < datetime('now', '-5 minutes'))
             OR (status = 'CLEANING' AND cleanup_lease_expires_at IS NOT NULL AND cleanup_lease_expires_at < datetime('now'))
           )
         RETURNING cleanup_generation`
      )
      .bind(currentWorkerId, row.id, row.cleanup_generation ?? null, expectedGen)
      .first<{ cleanup_generation: number }>();

    if (!claimRes || claimRes.cleanup_generation === undefined || claimRes.cleanup_generation === null) {
      // Row was claimed concurrently, generation diverged, or lease was renewed. Skip!
      skippedCount++;
      continue;
    }

    const targetGen = claimRes.cleanup_generation;

    // 3. Perform external R2 deletion under verified exclusive lease
    let r2Success = false;
    let r2Error = "";
    try {
      await deletePhoto(r2, row.r2_key);
      r2Success = true;
    } catch (err: any) {
      r2Success = false;
      r2Error = err?.message || "R2 deletion failed";
    }

    if (r2Success) {
      // 4a. Conditional D1 row deletion: verify ownership, generation, AND active lease validity before purging.
      // Note: D1 fencing does not physically cancel or abort in-flight network requests to R2;
      // rather, it fences the D1 transaction boundary so that a delayed or stale worker cannot finalize or commit
      // deletions if its lease expired or was taken over by a newer worker.
      const delRes = await db
        .prepare(
          `DELETE FROM job_photos 
           WHERE id = ? 
             AND status = 'CLEANING' 
             AND cleanup_worker_id = ?
             AND cleanup_generation = ?
             AND cleanup_lease_expires_at IS NOT NULL
             AND cleanup_lease_expires_at >= datetime('now')`
        )
        .bind(row.id, currentWorkerId, targetGen)
        .run();

      const delAffected = (delRes as any)?.changes ?? (delRes as any)?.meta?.changes ?? 0;
      if (delAffected > 0) {
        cleanedCount++;
      } else {
        // Lease was stolen by a newer worker or expired while R2 delete was running.
        skippedCount++;
      }
    } else {
      // 4b. Revert to PENDING_DELETE with diagnostic error, fenced by ownership, generation, and active lease.
      failedCount++;
      await db
        .prepare(
          `UPDATE job_photos 
           SET status = 'PENDING_DELETE', 
               cleanup_attempts = COALESCE(cleanup_attempts, 0) + 1, 
               last_cleanup_error = ?,
               cleanup_worker_id = NULL,
               cleanup_lease_expires_at = NULL 
           WHERE id = ? 
             AND status = 'CLEANING' 
             AND cleanup_worker_id = ?
             AND cleanup_generation = ?
             AND cleanup_lease_expires_at IS NOT NULL
             AND cleanup_lease_expires_at >= datetime('now')`
        )
        .bind(r2Error, row.id, currentWorkerId, targetGen)
        .run();
    }
  }

  return { cleanedCount, failedCount, skippedCount };
}

// 8. Mission Control Dashboard Aggregation (Zero N+1 Queries)
export interface DashboardJobItem {
  id: number;
  user_id: number;
  client_id: number;
  job_number: string;
  job_type: "REPAIR" | "PROJECT" | "RETAINER";
  title: string;
  status: string;
  due_date?: string;
  total_quoted_amount: number;
  metadata: string;
  created_at: string;
  updated_at: string;
  client: {
    name: string;
    phone?: string;
    line_id?: string;
  };
  parsedMetadata: any;
  totalPaid: number;
  totalPartsCost: number;
  balanceDue: number;
  netProfit: number;
  isPaidInFull: boolean;
  currentCyclePaid?: boolean;
  currentCyclePeriod?: string;
  paymentProgress?: number;
  isOverdue?: boolean;
}

export interface DashboardData {
  kpis: {
    activeJobsCount: number;
    monthlyRevenue: number;
    monthlyProfit: number;
    unpaidBalanceDue: number;
    currentMonth: string;
  };
  zones: {
    repairs: DashboardJobItem[];
    projects: DashboardJobItem[];
    retainers: DashboardJobItem[];
  };
}

export async function getDashboardData(
  db: D1Database,
  userId: number,
  searchQuery?: string
): Promise<DashboardData> {
  const currentBangkokMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // FIN-02: Timezone aligned with Asia/Bangkok (+7 hours) in SQLite
  // Query 1: Monthly KPI aggregates
  const kpiRow = await db
    .prepare(
      `SELECT 
        COALESCE(SUM(amount), 0) as monthly_revenue,
        COALESCE(SUM(parts_cost), 0) as monthly_parts_cost
       FROM job_payments 
       WHERE user_id = ? AND strftime('%Y-%m', datetime(paid_at, '+7 hours')) = ?`
    )
    .bind(userId, currentBangkokMonth)
    .first<{ monthly_revenue: number; monthly_parts_cost: number }>();

  const monthlyRevenue = kpiRow?.monthly_revenue ?? 0;
  const monthlyPartsCost = kpiRow?.monthly_parts_cost ?? 0;
  // Direct Contribution Margin before overhead
  const monthlyProfit = monthlyRevenue - monthlyPartsCost;

  // Query 2: All jobs joined with clients and payment sums in single query (Zero N+1)
  let jobsQuery = `
    SELECT 
      j.id,
      j.user_id,
      j.client_id,
      j.job_number,
      j.job_type,
      j.title,
      j.status,
      j.due_date,
      j.total_quoted_amount,
      j.metadata,
      j.created_at,
      j.updated_at,
      c.name as client_name,
      c.phone as client_phone,
      c.line_id as client_line_id,
      COALESCE(SUM(p.amount), 0) as total_paid,
      COALESCE(SUM(p.parts_cost), 0) as logged_parts_cost,
      COALESCE(SUM(CASE WHEN p.payment_type = 'RETAINER_CYCLE' AND p.billing_period = ? THEN p.amount ELSE 0 END), 0) as current_cycle_paid_amount
    FROM jobs j
    LEFT JOIN clients c ON j.client_id = c.id AND c.user_id = j.user_id
    LEFT JOIN job_payments p ON j.id = p.job_id AND p.user_id = j.user_id
    WHERE j.user_id = ?
  `;

  const queryParams: any[] = [currentBangkokMonth, userId];

  if (searchQuery && searchQuery.trim()) {
    const q = `%${searchQuery.trim()}%`;
    jobsQuery += ` AND (
      j.job_number LIKE ? OR 
      j.title LIKE ? OR 
      c.name LIKE ? OR 
      c.phone LIKE ? OR 
      j.metadata LIKE ?
    )`;
    queryParams.push(q, q, q, q, q);
  }

  jobsQuery += ` GROUP BY j.id ORDER BY j.id DESC`;

  const { results } = await db.prepare(jobsQuery).bind(...queryParams).all<any>();
  const rows = results || [];

  let activeJobsCount = 0;
  let unpaidBalanceDue = 0;

  const repairs: DashboardJobItem[] = [];
  const projects: DashboardJobItem[] = [];
  const retainers: DashboardJobItem[] = [];

  for (const row of rows) {
    const parsedMetadata = parseJobMetadata(row.job_type, row.metadata);
    const totalQuoted = Number(row.total_quoted_amount) || 0;
    const totalPaid = Number(row.total_paid) || 0;
    const loggedPartsCost = Number(row.logged_parts_cost) || 0;
    const currentCyclePaidAmount = Number(row.current_cycle_paid_amount) || 0;

    let totalPartsCost = loggedPartsCost;
    if (totalPartsCost === 0 && row.job_type === "REPAIR" && parsedMetadata?.partsCost) {
      totalPartsCost = Number(parsedMetadata.partsCost) || 0;
    }

    let balanceDue = Math.max(0, totalQuoted - totalPaid);
    let isPaidInFull = totalQuoted > 0 && balanceDue === 0;
    let currentCyclePaid: boolean | undefined = undefined;

    if (row.job_type === "RETAINER") {
      const monthlyRate = Number(parsedMetadata?.monthlyRate) || totalQuoted;
      currentCyclePaid = currentCyclePaidAmount >= monthlyRate && monthlyRate > 0;
      balanceDue = Math.max(0, monthlyRate - currentCyclePaidAmount);
      isPaidInFull = monthlyRate > 0 && balanceDue === 0;
    }

    const netProfit = totalPaid - totalPartsCost;
    const isActive = row.status !== "DELIVERED" && row.status !== "CANCELLED";

    if (isActive) {
      activeJobsCount++;
      unpaidBalanceDue += balanceDue;
    }

    const item: DashboardJobItem = {
      id: row.id,
      user_id: row.user_id,
      client_id: row.client_id,
      job_number: row.job_number,
      job_type: row.job_type,
      title: row.title,
      status: row.status,
      due_date: row.due_date || undefined,
      total_quoted_amount: totalQuoted,
      metadata: row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
      client: {
        name: row.client_name || "ไม่ระบุ",
        phone: row.client_phone || undefined,
        line_id: row.client_line_id || undefined,
      },
      parsedMetadata,
      totalPaid,
      totalPartsCost,
      balanceDue,
      netProfit,
      isPaidInFull,
      currentCyclePaid,
      currentCyclePeriod: currentBangkokMonth,
    };

    if (row.job_type === "REPAIR") {
      repairs.push(item);
    } else if (row.job_type === "PROJECT") {
      item.paymentProgress =
        totalQuoted > 0 ? Math.min(100, Math.round((totalPaid / totalQuoted) * 100)) : 100;
      item.isOverdue = Boolean(
        row.due_date && row.due_date < todayStr && row.status !== "COMPLETED" && row.status !== "DELIVERED"
      );
      projects.push(item);
    } else if (row.job_type === "RETAINER") {
      retainers.push(item);
    }
  }

  // Sort Projects: Due Date ASC (urgent/overdue on top)
  projects.sort((a, b) => {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });

  // Sort Retainers: Unpaid on top, then by billingCycleDay
  retainers.sort((a, b) => {
    if (a.currentCyclePaid !== b.currentCyclePaid) {
      return a.currentCyclePaid ? 1 : -1;
    }
    const dayA = a.parsedMetadata?.billingCycleDay || 1;
    const dayB = b.parsedMetadata?.billingCycleDay || 1;
    return dayA - dayB;
  });

  return {
    kpis: {
      activeJobsCount,
      monthlyRevenue,
      monthlyProfit,
      unpaidBalanceDue,
      currentMonth: currentBangkokMonth,
    },
    zones: {
      repairs,
      projects,
      retainers,
    },
  };
}
