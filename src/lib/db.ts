import type { D1Database } from "@cloudflare/workers-types";
import { type JobInput, type JobStatus, parseJobMetadata } from "../schemas/job";

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
}

// 1. Database Schema Initialization (Idempotent)
export async function initDatabase(db: D1Database): Promise<void> {
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
      amount REAL NOT NULL,
      parts_cost REAL DEFAULT 0,
      payment_type TEXT NOT NULL,
      billing_period TEXT,
      paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS job_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      r2_key TEXT NOT NULL,
      caption TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
    CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(user_id, phone);
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_type ON jobs(user_id, job_type);
    CREATE INDEX IF NOT EXISTS idx_payments_job ON job_payments(job_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_payments_billing ON job_payments(user_id, billing_period);
    CREATE INDEX IF NOT EXISTS idx_photos_job ON job_photos(job_id, user_id);
  `;

  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
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
  const balanceDue = Math.max(0, totalQuotedAmount - totalPaid);
  const netProfit = totalPaid - totalPartsCost;
  const isPaidInFull = totalQuotedAmount > 0 && balanceDue === 0;

  let currentCyclePaid: boolean | undefined = undefined;
  let currentCyclePeriod: string | undefined = undefined;

  if (job.job_type === "RETAINER") {
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    currentCyclePeriod = currentYearMonth;
    currentCyclePaid = jobPayments.some(
      (p) => p.payment_type === "RETAINER_CYCLE" && p.billing_period === currentYearMonth
    );
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

  return {
    ...job,
    client: client || undefined,
    parsedMetadata,
    payments,
    financialSummary,
  };
}

export async function updateJobStatus(
  db: D1Database,
  userId: number,
  jobId: number,
  status: JobStatus
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
    .bind(status, jobId, userId)
    .run();
  return res.success;
}

// 6. Payment Operations (Financial Ledger)
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
  }
): Promise<JobPaymentRecord> {
  // Strict Tenant Isolation: verify job exists and belongs to this user
  const job = await db
    .prepare("SELECT id FROM jobs WHERE id = ? AND user_id = ?")
    .bind(payment.jobId, userId)
    .first<{ id: number }>();

  if (!job) {
    throw new Error(`Job ID ${payment.jobId} not found or does not belong to user ${userId}`);
  }

  const res = await db
    .prepare(
      `INSERT INTO job_payments (
        job_id, user_id, amount, parts_cost, payment_type, billing_period, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      payment.jobId,
      userId,
      payment.amount,
      payment.partsCost || 0,
      payment.paymentType,
      payment.billingPeriod || null,
      payment.note || null
    )
    .first<JobPaymentRecord>();

  if (!res) throw new Error("Failed to record payment");
  return res;
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
