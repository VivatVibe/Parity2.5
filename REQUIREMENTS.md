# Parity 2.5 — Requirements & Blueprint (Universal Solo Hub)
> **ปรัชญา:** "Boring, Lean, Zero-bloat" (Ponytail Senior Dev Mode) + **Ai-Hero (Matt Pocock)** Domain Modeling + **Edge Survival Architecture**

---

## 1. Core Problem & User
- **ปัญหาหลัก:** ผู้ประกอบการคนเดียว (Solo Worker / Freelancer) ที่ให้บริการหลายรูปแบบ ทั้ง **งานซ่อมคอม/ฮาร์ดแวร์**, **งานออนไลน์รายโปรเจกต์ (SEO/Web)**, และ **งานบริการรายเดือน (Monthly Retainer/Web Care)** ต้องการระบบเดียวที่จัดการลูกค้า ติดตามสถานะงาน ไม่ให้งานตกหล่น และตามเก็บเงินได้ครบถ้วน
- **ผู้ใช้งาน:** เจ้าของระบบล็อกอินผ่าน Google Account รองรับการขยายเป็น Multi-tenant ในอนาคตเพื่อนำไปจำหน่ายให้ผู้อื่นได้
- **ประเภทงานที่รองรับ:**
  1. `REPAIR`: งานซ่อมคอมพิวเตอร์ / โน้ตบุ๊ก / อุปกรณ์ IT (รับเครื่อง, อาการ, อะไหล่, รูปถ่ายสภาพ)
  2. `PROJECT`: งานออนไลน์เป็นจ็อบ เช่น ทำ SEO Audit, ปรับแต่ง On-page, ขึ้นเว็บไซต์ใหม่
  3. `RETAINER`: งานดูแลรายเดือน เช่น ดูแลเว็บไซต์ประจำเดือน, ทำ SEO ประจำเดือน (มีรอบบิลเก็บเงิน)

---

## 2. ขอบเขตฟังก์ชันหลัก (Core Workflows)

### 2.1 การเข้าสู่ระบบและความปลอดภัย (Authentication)
- ล็อกอินด้วย **Google OAuth 2.0** ผ่าน **Arctic** (Zero-bloat OAuth for Edge) + **Jose** (Stateless encrypted cookie session ผ่าน Web Crypto API) พร้อมตัวแปร `MOCK_AUTH=true` สำหรับ local dev
- ข้อมูลทั้งหมดถูกแยกตาม `user_id` อย่างเด็ดขาด (Data Isolation) ทุก Repository query ต้องรับ `userId` เป็นพารามิเตอร์แรก (`WHERE user_id = ?`)

### 2.2 หน้าแรกของระบบ (Unified Mission Control Dashboard)
- แบ่งเป็น 3 โซนเห็นภาพรวมทันที:
  1. 🔧 **Active Repairs:** งานซ่อมที่กำลังตรวจเช็ค/รออะไหล่/รอส่งมอบ
  2. 💻 **Active Projects:** งานโปรเจกต์ SEO ที่กำลังทำ เรียงตาม Deadline
  3. 📅 **Due Retainers:** งานบริการรายเดือนที่ถึงรอบบิลของเดือนนี้ (คำนวณจากการตรวจว่าเดือน `YYYY-MM` ปัจจุบันมี record ใน `job_payments` หรือยัง)
- **ปุ่มเปิดงานด่วน:** `[+ เปิดใบงานใหม่]` ด้านล่าง กดเลือกประเภทงานแล้วบันทึกเสร็จใน 10 วินาที
- **ค้นหาด่วน (Quick Search):** ค้นจากชื่อลูกค้า, เบอร์โทร, รหัสงาน, หรือ URL เว็บไซต์

### 2.3 รับงาน / เปิดจ็อบ (Job Intake)
- เลือกลูกค้าเดิม หรือสร้างลูกค้าใหม่ในฟอร์มเดียวกัน
- **เลือกประเภทงาน (`JobType`):** ข้อมูลเฉพาะบันทึกเป็น JSON ลงคอลัมน์ `jobs.metadata` โดยตรวจสอบความถูกต้องด้วย **Zod Discriminated Union**:
  - `REPAIR`: `{ deviceModel, serialNumber, symptom, accessories, partsCost }`
  - `PROJECT`: `{ domainUrl, scopeSummary, repoUrl, deliverables }`
  - `RETAINER`: `{ billingCycleDay, monthlyRate, serviceScope }`
- ออกรหัสงานแบบ Atomic ผ่านตาราง `job_counters`: `PR-0001` (Repair), `PJ-0001` (Project), `RT-0001` (Retainer)

### 2.4 การเงินและบัญชีรายรับ (`job_payments` Ledger)
- แยกประวัติการชำระเงินลงตาราง `job_payments` เพื่อให้งาน Retainer มีประวัติรายเดือนต่อเนื่อง และงาน Project รองรับมัดจำ/Milestone
- บันทึก `parts_cost` (ต้นทุนอะไหล่) ในแต่ละรายการ เพื่อคำนวณกำไรสุทธิที่แท้จริง
- หน้าจอ **Mobile Digital Slip**: สรุปข้อมูลงานและยอดเงินสำหรับการแคปส่ง LINE หรือสั่งพิมพ์ใบรับเครื่อง/ใบเสร็จ

### 2.5 อัปโหลดรูปภาพสภาพเครื่อง (Cloudflare R2)
- สำหรับงาน `REPAIR`: ถ่ายรูปจากกล้องมือถือสูงสุด 5 รูป
- บีบอัดรูปภาพฝั่งเบราว์เซอร์ด้วย **HTML5 Canvas** (ความกว้างสูงสุด 1280px, WebP/JPEG คุณภาพ 0.75, ขนาด < 300KB ต่อรูป) ก่อนส่งเข้า R2 เพื่อไม่ให้ติด Payload Limit ของ Cloudflare Workers

---

## 3. สถาปัตยกรรมทางเทคนิค (The Edge Stack)

- **Framework:** Next.js (App Router)
- **Runtime:** Cloudflare Pages / Workers
- **Database:** Cloudflare D1 (SQLite) — ไร้ Sub-tables เชื่อมด้วย JSON Metadata + Zod
- **Object Storage:** Cloudflare R2 — เก็บรูปถ่ายสภาพเครื่องที่บีบอัดแล้ว
- **Auth:** Arctic + Jose (Edge-native, Zero NextAuth bloat)
- **Issue Tracker:** GitHub Issues (`VivatVibe/Parity2.5`)
- **Development Skills:** Matt Pocock's Ai-Hero skill suite (`setup-matt-pocock-skills`, `grill-with-docs`, `to-spec`, `to-tickets`, `tdd`, `code-review`)

---

## 4. โครงสร้างข้อมูล (D1 SQLite Schema)

ดูรายละเอียดสมบูรณ์ใน [`migrations/0001_init.sql`](file:///Users/vivat/Documents/Parity2.5/migrations/0001_init.sql)

- `users` (id, email, name, avatar_url, created_at)
- `clients` (id, user_id, name, phone, line_id, notes, created_at)
- `jobs` (id, user_id, client_id, job_number, job_type, title, status, due_date, total_quoted_amount, metadata, created_at, updated_at)
- `job_counters` (user_id, prefix, seq) — Atomic sequence generation
- `job_payments` (id, job_id, user_id, amount, parts_cost, payment_type, billing_period, paid_at, note)
- `job_photos` (id, job_id, user_id, r2_key, caption, created_at)

---

## 5. แผนการส่งมอบ Tracer-bullet Tickets (Cashflow-First Order)

1. **Ticket 1: Core Schema & Edge OAuth (`arctic` + `jose`)**
   - *Blocked by:* None
   - *Deliverable:* D1 migration + Zod schemas + Edge Google OAuth + Mock Auth bypass + Tracer-bullet UI page ยิง D1 ทดสอบครบวงจร
2. **Ticket 2: Client Registry & Polymorphic Job Intake Form**
   - *Blocked by:* Ticket 1
   - *Deliverable:* ฟอร์มรับงานเดียวสลับฟิลด์ตาม `JobType` ผ่าน Zod + สร้าง/ค้นหาลูกค้า + Atomic counter `PR-` / `PJ-` / `RT-`
3. **Ticket 3: Financial Ledger (`job_payments`) & Mobile Digital Slip**
   - *Blocked by:* Ticket 2
   - *Deliverable:* หน้าบันทึกการรับเงิน/ต้นทุนอะไหล่ + การ์ด Mobile Digital Slip สวยงามสำหรับแคปส่ง LINE / พิมพ์ใบเสร็จ
4. **Ticket 4: Client-Compressed Photo Upload to Cloudflare R2**
   - *Blocked by:* Ticket 2
   - *Deliverable:* ถ่ายรูปสภาพเครื่องกล้องมือถือ + บีบอัดภาพด้วย Canvas ใน Browser (<300KB) อัปโหลดขึ้น R2
5. **Ticket 5: Mission Control 3-Zone Dashboard & Retainer Billing Radar**
   - *Blocked by:* Ticket 3
   - *Deliverable:* กระดาน 3 โซน (Active Repairs, Projects, Due Retainers คำนวณจากรอบบิลเดือนปัจจุบัน) + เปลี่ยนสถานะ + ค้นหาด่วน
