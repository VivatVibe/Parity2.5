-- Parity 2.5: Initial Lean Schema (D1 SQLite)
-- Core Multi-tenant Isolation via user_id

-- 1. Users (Google OAuth & Multi-tenant anchor)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Clients (Customer registry isolated by user_id)
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  line_id TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Jobs (Unified job entity with JSON metadata)
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  job_number TEXT NOT NULL,
  job_type TEXT NOT NULL, -- 'REPAIR', 'PROJECT', 'RETAINER'
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED', -- 'RECEIVED', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'DELIVERED', 'ACTIVE', 'CANCELLED'
  due_date TEXT, -- 'YYYY-MM-DD'
  total_quoted_amount REAL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}', -- JSON validated by Zod Discriminated Union
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, job_number)
);

-- 4. Atomic Job Code Counters
CREATE TABLE IF NOT EXISTS job_counters (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL, -- 'PR', 'PJ', 'RT'
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, prefix)
);

-- 5. Financial Ledger (Decoupled payments & parts cost tracking)
CREATE TABLE IF NOT EXISTS job_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK(amount > 0),
  parts_cost REAL DEFAULT 0 CHECK(parts_cost >= 0), -- Hardware parts cost for net profit calculation
  payment_type TEXT NOT NULL, -- 'DEPOSIT', 'MILESTONE', 'FINAL', 'RETAINER_CYCLE'
  billing_period TEXT, -- 'YYYY-MM' e.g. '2026-10' for recurring retainers
  paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note TEXT
);

-- 6. Hardware Photos (Cloudflare R2 metadata)
CREATE TABLE IF NOT EXISTS job_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  caption TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance & strict tenant queries
CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(user_id, phone);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_type ON jobs(user_id, job_type);
CREATE INDEX IF NOT EXISTS idx_payments_job ON job_payments(job_id, user_id);
CREATE INDEX IF NOT EXISTS idx_payments_billing ON job_payments(user_id, billing_period);
CREATE INDEX IF NOT EXISTS idx_photos_job ON job_photos(job_id, user_id);
