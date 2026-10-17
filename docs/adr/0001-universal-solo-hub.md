# ADR 0001: Universal Solo Hub Architecture & Stack

## Status
Accepted

## Context
ผู้พัฒนาเปลี่ยนบริบทการทำงานจากช่างซ่อมคอมพิวเตอร์อย่างเดียว ไปสู่การรับงานหลากหลายรูปแบบ (งานซ่อมฮาร์ดแวร์, งานโปรเจกต์ออนไลน์ SEO/ทำเว็บ, และงานบริการรายเดือน Retainer) โดยมีเป้าหมายหลักคือ "หนีหนี้ทางเทค" ที่เคยเกิดขึ้นใน Parity 2.0 (ซึ่งมี monorepo, 10-iteration mega plan, และสถาปัตยกรรมที่ซับซ้อนเกินจำเป็น)

## Decision
1. **Domain Model:** ใช้รูปแบบ **Unified Job Model** โดยมี `clients` และ `jobs` เป็นแกนกลาง และแยกฟิลด์เฉพาะทางตาม `job_type` (`REPAIR`, `PROJECT`, `RETAINER`) ไม่สร้างระบบแยก 3 แอป เพื่อลดความซ้ำซ้อนของโค้ด
2. **Tech Stack:**
   - Framework: Next.js (App Router)
   - Runtime: Cloudflare Workers / Pages
   - Storage/DB: Cloudflare D1 (SQLite) + Cloudflare R2
   - Issue Tracking: GitHub Issues (`VivatVibe/Parity2.5`)
   - Development Skills: Matt Pocock's Ai-Hero methodologies (`setup-matt-pocock-skills`, `grill-with-docs`, `to-spec`, `to-tickets`, `tdd`)

## Consequences
- โครงสร้างโปรเจกต์เรียบง่ายเป็น Single app แบนราบ ไม่มี monorepo
- สามารถรองรับงานทั้ง 3 ประเภทได้ในฐานข้อมูลและ UI เดียวกัน
- ติดตามตั๋วงานผ่าน GitHub Issues ทำให้สามารถรีวิวข้ามระบบได้ง่าย
