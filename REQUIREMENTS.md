# Parity 2.5 — Requirements & Blueprint (Universal Solo Hub)
> **ปรัชญา:** "Boring, Lean, Zero-bloat" (Ponytail Senior Dev Mode) + **Ai-Hero (Matt Pocock)** Domain Modeling

---

## 1. Core Problem & User
- **ปัญหาหลัก:** ผู้ประกอบการคนเดียว (Solo Worker / Freelancer) ที่ให้บริการหลายรูปแบบ ทั้ง **งานซ่อมคอม/ฮาร์ดแวร์**, **งานออนไลน์รายโปรเจกต์ (SEO/Web)**, และ **งานบริการรายเดือน (Monthly Retainer/Web Care)** ต้องการระบบเดียวที่จัดการลูกค้า ติดตามสถานะงาน ไม่ให้งานตกหล่น และตามเก็บเงินได้ครบถ้วน
- **ผู้ใช้งาน:** เจ้าของระบบล็อกอินผ่าน Google Account รองรับการขยายเป็น Multi-tenant ในอนาคตเพื่อนำไปจำหน่ายให้ผู้อื่นได้
- **ประเภทงานที่รองรับ:**
  1. `REPAIR`: งานซ่อมคอมพิวเตอร์ / โน้ตบุ๊ก / อุปกรณ์ IT (รับเครื่อง, อะไหล่, รูปถ่ายสภาพ)
  2. `PROJECT`: งานออนไลน์เป็นจ็อบ เช่น ทำ SEO Audit, ปรับแต่ง On-page, ขึ้นเว็บไซต์ใหม่
  3. `RETAINER`: งานดูแลรายเดือน เช่น ดูแลเว็บไซต์ประจำเดือน, ทำ SEO ประจำเดือน (มีรอบบิลเก็บเงิน)

---

## 2. ขอบเขตฟังก์ชันหลัก (Core Workflows)

### 2.1 การเข้าสู่ระบบและความปลอดภัย (Authentication)
- ล็อกอินด้วย **Google OAuth 2.0**
- ข้อมูลทั้งหมดถูกแยกตาม `user_id` อย่างเด็ดขาด (Data Isolation) ทำให้พร้อมสำหรับ Multi-tenant / Commercialization โดยไม่ต้องแก้ Schema ในภายหลัง
- Session จัดการผ่าน Secure HTTP-only Cookie

### 2.2 หน้าแรกของระบบ (Unified Mission Control Dashboard)
- แบ่งเป็น 3 โซนเห็นภาพรวมทันที:
  1. 🔧 **Active Repairs:** งานซ่อมที่กำลังตรวจเช็ค/รออะไหล่/รอส่งมอบ
  2. 💻 **Active Projects:** งานโปรเจกต์ SEO ที่กำลังทำ เรียงตาม Deadline
  3. 📅 **Due Retainers:** งานบริการรายเดือนที่ถึงรอบบิลของเดือนนี้ พร้อมแจ้งเตือนตามเก็บเงิน
- **ปุ่มเปิดงานด่วน:** `[+ เปิดใบงานใหม่]` ด้านล่าง กดเลือกประเภทงานแล้วบันทึกเสร็จใน 10 วินาที
- **ค้นหาด่วน (Quick Search):** ค้นจากชื่อลูกค้า, เบอร์โทร, รหัสงาน, หรือ URL เว็บไซต์

### 2.3 รับงาน / เปิดจ็อบ (Job Intake)
- เลือกลูกค้าเดิม หรือสร้างลูกค้าใหม่
- **เลือกประเภทงาน (`JobType`):**
  - หากเป็น **`REPAIR`**: ระบุประเภทอุปกรณ์, ยี่ห้อ/รุ่น, อาการเสีย, อุปกรณ์ที่ติดมาด้วย, ถ่ายรูปสภาพเครื่อง (เก็บใน Cloudflare R2 สูงสุด 5 รูป)
  - หากเป็น **`PROJECT`**: ระบุชื่องาน, URL เว็บไซต์ลูกค้า, Scope ย่อ, กำหนดส่ง (Deadline), ลิงก์แนบงาน (Google Drive, Figma, Docs)
  - หากเป็น **`RETAINER`**: ระบุ URL เว็บไซต์, ขอบเขตงานประจำเดือน, วันที่ตัดรอบบิล (1-31), ค่าบริการต่อเดือน
- ออกรหัสงานอัตโนมัติ เช่น `PR-2026-0001` (Repair), `PJ-2026-0001` (Project), `RT-2026-0001` (Retainer)

### 2.4 ปิดงานและสรุปการเงิน (Handover & Digital Slip)
- บันทึกการเงินแบบ Manual: ยอดรวม, เงินมัดจำ/รับแล้ว, ยอดคงค้าง
- แสดงหน้า **Digital Slip** (การ์ดสรุปงานสำหรับมือถือ) ที่แคปส่ง LINE หรือพิมพ์เป็นกระดาษได้ทันที

---

## 3. สถาปัตยกรรมทางเทคนิค (The Stack)

- **Framework:** Next.js (App Router)
- **Runtime:** Cloudflare Pages / Workers
- **Database:** Cloudflare D1 (SQLite) — Zero-ops
- **Object Storage:** Cloudflare R2 — เก็บรูปถ่ายสภาพเครื่อง
- **Auth:** Google OAuth 2.0
- **Issue Tracker:** GitHub Issues (`VivatVibe/Parity2.5`)
- **Development Skills:** Matt Pocock's Ai-Hero skill suite (`setup-matt-pocock-skills`, `grill-with-docs`, `to-spec`, `to-tickets`, `tdd`, `code-review`)

---

## 4. โครงสร้างข้อมูล (D1 SQLite Schema)

```sql
-- ผู้ใช้งานระบบ (Google OAuth & Multi-tenant isolation)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ลูกค้า
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  line_id TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ใบงานหลัก (Unified Jobs)
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_number TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  job_type TEXT NOT NULL, -- 'REPAIR', 'PROJECT', 'RETAINER'
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  due_date TEXT, -- YYYY-MM-DD
  billing_cycle_day INTEGER, -- 1-31 (เฉพาะ RETAINER)
  total_amount REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- รายละเอียดเฉพาะงานซ่อมคอมพิวเตอร์ (Hardware Repair Extension)
CREATE TABLE job_repairs (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL,
  brand_model TEXT NOT NULL,
  serial_number TEXT,
  symptoms TEXT NOT NULL,
  accessories TEXT,
  cost_parts REAL DEFAULT 0,
  cost_labor REAL DEFAULT 0
);

-- รูปถ่ายสภาพเครื่อง (Hardware Photos in R2)
CREATE TABLE job_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- รายละเอียดเฉพาะงานออนไลน์ / SEO (Online & Project Extension)
CREATE TABLE job_online_meta (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  website_url TEXT,
  deliverable_url TEXT, -- Google Drive, Figma, Report link
  scope_notes TEXT
);
```

---

## 5. แผนการส่งมอบตามลำดับ (Tracer-bullet Milestones)
1. **Milestone 1: Core Foundation & Auth** — Schema D1 + Google OAuth login & User session
2. **Milestone 2: Unified Intake Form** — ฟอร์มรับงานเดียวที่ปรับเปลี่ยนตาม `JobType` (Repair, Project, Retainer) + Client lookup
3. **Milestone 3: Mission Control Dashboard** — กระดานแสดงผล 3 โซน + Retainer due reminder badge
4. **Milestone 4: R2 Photos & Digital Slip** — ระบบอัปโหลดรูปกล้องมือถือ + หน้าสรุปสลิปสำหรับส่ง LINE
