# Parity 2.5 — Requirements & Blueprint (Universal Solo Hub)
> **ปรัชญา:** "Boring, Lean, Zero-bloat" (Ponytail Senior Dev Mode) + **Ai-Hero (Matt Pocock)** Domain Modeling

---

## 1. Core Problem & User
- **ปัญหาหลัก:** ผู้ประกอบการคนเดียว (Solo Worker / Freelancer) ที่ให้บริการหลายรูปแบบ ทั้ง **งานซ่อมคอม/ฮาร์ดแวร์**, **งานออนไลน์รายโปรเจกต์ (SEO/Web)**, และ **งานบริการรายเดือน (Monthly Retainer/Web Care)** ต้องการระบบเดียวที่จัดการลูกค้า ติดตามสถานะงาน ไม่ให้งานตกหล่น และตามเก็บเงินได้ครบถ้วน
- **ผู้ใช้งาน:** เจ้าของคนเดียว (Single Owner) จัดการงานทั้งหมดจากมือถือหรือคอมพิวเตอร์
- **ประเภทงานที่รองรับ:**
  1. `REPAIR`: งานซ่อมคอมพิวเตอร์ / โน้ตบุ๊ก / อุปกรณ์ IT (รับเครื่อง, อะไหล่, รูปถ่ายสภาพ)
  2. `PROJECT`: งานออนไลน์เป็นจ็อบ เช่น ทำ SEO Audit, ปรับแต่ง On-page, ขึ้นเว็บไซต์ใหม่
  3. `RETAINER`: งานดูแลรายเดือน เช่น ดูแลเว็บไซต์ประจำเดือน, ทำ SEO ประจำเดือน (มีรอบบิลเก็บเงิน)

---

## 2. ขอบเขตฟังก์ชันหลัก (Core Workflows)

### 2.1 รับงาน / เปิดจ็อบ (Job Intake)
- **เลือกลูกค้า:** ค้นหาลูกค้าเดิม (จากเบอร์/ชื่อ) หรือกรอกลูกค้าใหม่
- **เลือกประเภทงาน (`JobType`):**
  - หากเป็น **`REPAIR`**: ระบุประเภทอุปกรณ์, ยี่ห้อ/รุ่น, อาการเสีย, อุปกรณ์ที่ติดมาด้วย, ถ่ายรูปสภาพเครื่อง (จัดเก็บใน Cloudflare R2)
  - หากเป็น **`PROJECT`**: ระบุชื่องาน, รายละเอียด Scope, กำหนดส่ง (Deadline), ลิงก์แนบงาน (Google Drive, Figma, Docs)
  - หากเป็น **`RETAINER`**: ระบุขอบเขตงานรายเดือน, วันที่ตัดรอบบิล (เช่น ทุกวันที่ 1 ของเดือน), อัตราค่าบริการรายเดือน
- **การเงินเริ่มต้น:** ระบุมูลค่างาน, เงินมัดจำ (ถ้ามี)
- **รหัสใบงาน:** ออกรหัสออโต้ตามประเภทงาน เช่น `PR-2026-0001` (Repair), `PJ-2026-0001` (Project), `RT-2026-0001` (Retainer)

### 2.2 คิวงานและกระดานติดตาม (Unified Job Board)
- รวมทุกงานในหน้าเดียว หรือกรองดูตามประเภท (`All` | `Repair` | `Project` | `Retainer`)
- **สถานะงาน (Job Status):**
  1. `RECEIVED` (รับเรื่อง/รอดำเนินการ)
  2. `IN_PROGRESS` (กำลังดำเนินการ)
  3. `WAITING` (รอข้อมูลจากลูกค้า หรือ รออะไหล่)
  4. `COMPLETED` (ทำเสร็จแล้ว รอส่งมอบ/ส่งรายงาน)
  5. `DELIVERED` (ส่งมอบงานแล้ว / ปิดจ็อบ)
- **ระบบเตือนรอบบิลรายเดือน (Retainer Reminder):** แสดงรายการงานรายเดือนที่ใกล้ถึงรอบบิล หรือยังไม่ได้ชำระเงินในรอบปัจจุบัน
- **ค้นหาด่วน (Quick Search):** ค้นจากชื่อลูกค้า, เบอร์โทร, หรือรหัสงาน

### 2.3 ปิดงานและสรุปการเงิน (Handover & Slip)
- สรุปยอดเงิน: ค่าบริการ, ค่าอะไหล่/ค่าใช้จ่ายเสริม, ยอดคงเหลือที่ต้องเก็บ
- บันทึกการรับเงิน: ระบุวิธีชำระและวันที่รับเงิน
- แสดงหน้าสลิป / ใบสรุปงานดิจิทัล (Clean Mobile Slip View) สำหรับแคปส่ง LINE หรือพิมพ์

---

## 3. สถาปัตยกรรมทางเทคนิค (The Stack)

- **Framework:** Next.js (App Router)
- **Runtime:** Cloudflare Pages / Workers
- **Database:** Cloudflare D1 (SQLite) — ไร้หนี้ทางเทค Zero-ops
- **Object Storage:** Cloudflare R2 — เก็บรูปถ่ายสภาพเครื่องและเอกสาร
- **Issue & Task Tracker:** GitHub Issues บน `VivatVibe/Parity2.5`
- **Development Skills:** Matt Pocock's Ai-Hero skill suite (`setup-matt-pocock-skills`, `grill-with-docs`, `to-spec`, `to-tickets`, `tdd`, `code-review`)

---

## 4. โครงสร้างข้อมูล (D1 SQLite Schema)

```sql
-- ลูกค้า
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  line_id TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ใบงานหลัก (Unified Jobs)
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

## 5. กระบวนการพัฒนา (Ai-Hero Delivery Loop)
1. **Grill & Refine Requirements:** ตรวจสอบความถูกต้องของโมเดลกับผู้ใช้ผ่าน Grilling interview
2. **Spec & Ticket Breakdown:** แปลง Requirement เป็น Tracer-bullet tickets บน GitHub Issue (`VivatVibe/Parity2.5`)
3. **TDD Implementation:** พัฒนาฟังก์ชันทีละ Ticket แบบ Test-Driven และผูก verification checks
