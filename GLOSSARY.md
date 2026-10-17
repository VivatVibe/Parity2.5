# Domain Glossary: Parity 2.5

คำศัพท์และโมเดลโดเมนหลักสำหรับ Parity 2.5 (Universal Solo-Worker Hub)

---

### Core Entities

#### User (ผู้ใช้งาน / เจ้าของระบบ)
เจ้าของบัญชีที่ล็อกอินเข้าใช้งานระบบผ่าน Google OAuth ในอนาคตสามารถรองรับผู้ใช้งานหลายคน (Multi-tenant) โดยที่ทุกคนมี `user_id` แยกจากกันเด็ดขาด
- **ฟิลด์สำคัญ:** `id`, `email`, `name`, `avatar_url`, `created_at`

#### Client (ลูกค้า)
ผู้ว่าจ้างหรือผู้ส่งเครื่องมาซ่อม เชื่อมโยงกับ `user_id` หนึ่ง Client สามารถมีได้หลาย Job ทั้งงานซ่อม งานโปรเจกต์ และงานรายเดือน
- **ฟิลด์สำคัญ:** `id`, `user_id`, `name`, `phone`, `line_id` / `contact_channel`, `notes`

#### Job (ใบงาน / จ็อบบริการ)
หน่วยการทำงานหลักในระบบที่เชื่อมโยงกับ Client หนึ่งราย และมี `user_id` กำกับ มีประเภทงานกำกับด้วย `JobType`
- **ฟิลด์แกนร่วม:** `id`, `user_id`, `job_number`, `client_id`, `job_type`, `title`, `status`, `created_at`, `due_date`, `total_amount`, `paid_amount`

#### JobType (ประเภทงาน)
ระบุลักษณะของงานเพื่อเลือกแสดงข้อมูลเฉพาะ:
- **`REPAIR` (งานซ่อมคอม/อุปกรณ์):** 
  - **ฟิลด์เฉพาะ:** `device_type`, `brand_model`, `serial_number`, `symptoms`, `accessories`, `cost_parts`, `cost_labor`
  - **ไฟล์แนบ:** รูปถ่ายสภาพเครื่องก่อน-หลังซ่อม (สูงสุด 5 รูป จัดเก็บใน Cloudflare R2)
- **`PROJECT` (งานออนไลน์เป็นจ็อบ):** 
  - **ฟิลด์เฉพาะ:** `website_url`, `scope_notes`, `due_date`, `deliverable_url` (ลิงก์ Google Drive, Figma, หรือ Report)
- **`RETAINER` (งานบริการรายเดือน เช่น SEO / ดูแลเว็บ):** 
  - **ฟิลด์เฉพาะ:** `website_url`, `billing_cycle_day` (วันที่ตัดรอบบิล เช่น ทุกวันที่ 1 หรือ 25), `monthly_rate`, `scope_notes`
  - **พฤติกรรม:** เป็นงานต่อเนื่อง อยู่ในสถานะ `ACTIVE` เสมอ และระบบจะแสดง Badge เตือนตามเก็บเงินเมื่อถึงรอบบิล

#### JobStatus (สถานะงาน)
วงจรชีวิตของงาน:
- `RECEIVED` (รับงานแล้ว / รอดำเนินการ)
- `IN_PROGRESS` (กำลังดำเนินการ / กำลังซ่อม / กำลังทำ SEO)
- `WAITING` (รอข้อมูลจากลูกค้า หรือ รออะไหล่)
- `COMPLETED` (งานเสร็จสิ้น / รอส่งมอบหรือส่งรีพอร์ต)
- `DELIVERED` (ส่งมอบงานแล้ว / ปิดจ็อบ)
- `CANCELLED` (ยกเลิกงาน)
- `ACTIVE` (เฉพาะ `RETAINER`: กำลังดูแลต่อเนื่องตามรอบบิล)

#### Billing & Digital Slip (การเงินและสลิปดิจิทัล)
- **Manual Payment Recording:** บันทึกยอดรวม (`total_amount`), เงินมัดจำ/เงินที่รับแล้ว (`paid_amount`), และยอดคงค้างชำระ
- **Digital Slip:** การแสดงผลสรุปใบงานในรูปแบบการ์ดที่กระชับ สวยงาม เหมาะสำหรับการแคปหน้าจอเพื่อส่งให้ลูกค้าทาง LINE หรือพิมพ์ใบเสร็จรับเงิน/ใบส่งมอบ
