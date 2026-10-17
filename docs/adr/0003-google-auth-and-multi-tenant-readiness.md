# ADR 0003: Google Authentication and Multi-Tenant Readiness

## Status
Accepted

## Context
ผู้ใช้ต้องการให้ระบบรองรับการเข้าสู่ระบบด้วย Google Account (OAuth) เพื่อความปลอดภัย ความสะดวกในการเข้าใช้งาน และ "เผื่อรองรับการนำไปจำหน่าย/เปิดให้ผู้อื่นใช้งานในอนาคต (Commercial SaaS / Multi-tenant readiness)" โดยไม่ต้องการให้เกิดหนี้ทางเทคจากโครงสร้างสิทธิ์ที่ซับซ้อนเกินความจำเป็นในปัจจุบัน

## Decisions
1. **Google OAuth 2.0 Authentication:**
   - ใช้งาน Google Identity ผ่าน OAuth 2.0 แบบมาตรฐาน
   - เก็บข้อมูลผู้ใช้ในตาราง `users` (`id`, `email`, `name`, `avatar_url`, `created_at`)
   - ยืนยันตัวตนด้วย Secure HTTP-only Cookie Session / JWT ที่เข้ารหัส
2. **Data Isolation by `user_id` (Multi-tenant Foundation):**
   - ทุกตารางข้อมูลทางธุรกิจ (`clients`, `jobs`, `job_photos`) จะมีฟิลด์ `user_id REFERENCES users(id)` กำกับไว้
   - ในปัจจุบัน: เมื่อผู้พัฒนาล็อกอินด้วย Google Account ข้อมูลทั้งหมดจะถูกผูกกับ `user_id` ของตนเอง
   - ในอนาคต: หากเปิดให้ผู้อื่นล็อกอิน ทุกคนจะมองเห็นเฉพาะข้อมูลของตนเองทันที โดยไม่ต้องแก้ไขสถาปัตยกรรมฐานข้อมูลใหม่

## Consequences
- โค้ดฐานข้อมูลเตรียมพร้อมสำหรับ Multi-tenancy ตั้งแต่วันแรกโดยไม่มี Overhead
- กระบวนการเข้าสู่ระบบปลอดภัย สะดวกบนมือถือและคอมพิวเตอร์
