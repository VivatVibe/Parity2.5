# Parity 2.5 — Requirements & Technical Blueprint
> **ปรัชญา:** ตัดหนี้ทางเทคทั้งหมดทิ้ง เริ่มจากศูนย์ด้วยหลักการ "Boring, Lean, Zero-bloat" (Ponytail Senior Dev Mode)

---

## 1. Core Problem & User
- **ปัญหาหลัก:** ช่างซ่อมคอมพิวเตอร์/อุปกรณ์ IT ต้องการบันทึกและติดตามงานซ่อม ไม่ให้งานตกหล่น รู้ว่าเครื่องใคร มาทำอะไร ซ่อมถึงไหน และคิดเงินเท่าไหร่
- **ผู้ใช้งาน:** ช่างคนเดียว (Single Owner / Solo Technician) ในร้านซ่อม IT
- **อุปกรณ์ที่รองรับ:** คอมพิวเตอร์ตั้งโต๊ะ, โน้ตบุ๊ก, ปริ้นเตอร์, แท็บเล็ต, มือถือ, และอุปกรณ์ IT ทั่วไป

---

## 2. ขอบเขตฟังก์ชันหลัก (The 3 Core Workflows)

### 2.1 รับเครื่องเข้าซ่อม (Job Intake)
- **ข้อมูลลูกค้า:** ชื่อ, เบอร์โทรศัพท์ (จำเป็น)
- **ข้อมูลอุปกรณ์:** 
  - ประเภทอุปกรณ์ (Dropdown เช่น Notebook, PC, Printer, Phone, Other)
  - ยี่ห้อ / รุ่น (Text)
  - Serial Number (ไม่บังคับ)
  - อาการเสียที่แจ้ง (Textarea)
  - อุปกรณ์ที่ติดมาด้วย (เช่น สายชาร์จ, เมาส์, กระเป๋า)
- **รูปถ่ายสภาพตอนรับ:** ถ่ายจากกล้องมือถือ/แท็บเล็ต หรืออัปโหลดรูป (สูงสุด 5 รูปต่อใบงาน)
- **รหัสใบงาน (Job Number):** รันอัตโนมัติ เข้าใจง่าย เช่น `PR-2026-0001`
- **เอาต์พุต:** บันทึกลงระบบทันที + สามารถพิมพ์/แคปหน้าใบรับเครื่องให้ลูกค้าได้

### 2.2 คิวงานและสถานะการซ่อม (Job Board & Tracking)
- **สถานะมีเพียง 5 สถานะที่จำเป็นจริง:**
  1. `RECEIVED` (รับเครื่องแล้ว)
  2. `IN_PROGRESS` (กำลังตรวจเช็ค/กำลังซ่อม)
  3. `WAITING_PARTS` (รออะไหล่)
  4. `COMPLETED` (ซ่อมเสร็จ รอส่งมอบ)
  5. `DELIVERED` (ส่งมอบลูกค้าแล้ว / ปิดงาน)
  *(สถานะยกเลิก `CANCELLED` สามารถเลือกได้)*
- **ค้นหางานได้เร็ว (Instant Search):** ค้นจากเบอร์โทร, ชื่อลูกค้า, หรือรหัสใบงาน
- **บันทึกงานซ่อม:** ช่างบันทึกสิ่งที่ทำ (Technician Notes) และค่าใช้จ่าย (ค่าแรง + ค่าอะไหล่)

### 2.3 ปิดงานและส่งมอบ (Handover & Receipt)
- สรุปยอดเงินรวม
- บันทึกการส่งมอบ (วันเวลาที่ลูกค้ารับเครื่องคืน)
- แสดงหน้าใบสรุปงาน (Digital Receipt / Slip) สำหรับส่งให้ลูกค้าทาง LINE หรือพิมพ์เป็นกระดาษ

---

## 3. สิ่งที่ตัดทิ้งอย่างเด็ดขาด (Anti-Features / YAGNI List)

| สิ่งที่ตัดทิ้ง (Tech Debt จาก Parity เดิม) | เหตุผลที่ตัด | สิ่งที่ใช้แทน |
|---|---|---|
| ❌ Monorepo / pnpm workspace | โครงสร้างซับซ้อน overhead สูงเกินความจำเป็น | **Single Repo แบนราบไฟล์เดียว/โฟลเดอร์เดียว** |
| ❌ Multi-role Auth / Cloudflare Access ซับซ้อน | มีช่างใช้งานคนเดียว ไม่จำเป็นต้องมี RBAC | **รหัสผ่านเดียว (Single PIN/Password) หรือ Local session** |
| ❌ Cloudflare Multi-env (Workers + D1 + R2 + Workflows) แต่ Day 1 | Setup ยาก รัน offline ไม่ได้ ติด vendor-lock | **SQLite ไฟล์เดียว + Local/S3 storage ธรรมดา** |
| ❌ Custom Design System / Token ซับซ้อน | เปลืองแรงเขียน CSS และดูแล code token | **Native HTML + Utility CSS เรียบง่าย (เช่น Tailwind หรือ CSS พื้นฐาน)** |
| ❌ AI Runner Loops & Multi-agent review scripts | เป็นภาระในการบำรุงรักษาและรันงาน | **การพัฒนาแบบตรงไปตรงมา ทดสอบผ่าน runnable test 1 ตัว** |
| ❌ แผนงาน 10 Iterations ล่วงหน้า | Over-speculative วางแผนในสิ่งที่ยังไม่ได้ใช้ | **ทำ Phase 1 ให้ใช้ได้จริงก่อน แล้วจึงขยายตาม feedback** |

---

## 4. โครงสร้างข้อมูล (Minimal Schema)

ใช้ SQLite เพียง 3 ตารางหลัก:

```sql
-- ลูกค้า
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ใบงานซ่อม
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  device_type TEXT NOT NULL,
  brand_model TEXT NOT NULL,
  serial_number TEXT,
  symptoms TEXT NOT NULL,
  accessories TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  technician_notes TEXT,
  cost_parts REAL DEFAULT 0,
  cost_labor REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- รูปภาพประกอบใบงาน
CREATE TABLE job_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. สถาปัตยกรรมทางเทคนิค (The Boring Cloudflare Stack)

- **Full-stack Framework:** Next.js (App Router) — รวม Frontend และ API/Server Actions อยู่ในโปรเจกต์เดียว
- **Runtime & Deployment:** Cloudflare Pages / Workers (ผ่าน `@opennextjs/cloudflare`)
- **Database:** Cloudflare D1 (SQLite แท้บน Edge — ไม่ต้องรันเซิร์ฟเวอร์ฐานข้อมูลแยก, local dev ใช้ D1 local emulation)
- **Object Storage:** Cloudflare R2 (จัดเก็บรูปภาพสภาพเครื่องก่อน-หลังซ่อม ผ่าน S3 API/R2 binding)
- **โครงสร้างโปรเจกต์:** Single App แบนราบ (โฟลเดอร์เดียว, 1 `package.json`, 1 `wrangler.json`, ไม่มี Monorepo/pnpm workspace)
- **การทดสอบ:** Runnable self-check สคริปต์สั้นๆ 1 ไฟล์ ทดสอบ D1 queries และ core logic ไม่ต้องมี test framework ซับซ้อน

---

## 6. ลำดับการส่งมอบ (Immediate Next Step)

- **Sprint 1 (Functional Core):**
  1. สร้างโปรเจกต์ Single repo พร้อม SQLite schema
  2. ฟอร์มรับเครื่อง (Intake) + อัปโหลดรูปสภาพ
  3. หน้ารายการงานซ่อม (Job List) + อัปเดตสถานะ + บันทึกราคา
  4. หน้าใบรับเครื่อง/ใบส่งมอบ (Printable View)
