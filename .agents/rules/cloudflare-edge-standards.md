# Cloudflare Workers & D1 Edge Standards

When writing backend, database, or API code for this project, you MUST strictly adhere to the following edge constraints:

1. **Polymorphic Data (SQLite JSON + Zod):**
   - Store domain variations inside a single `metadata TEXT` column as JSON.
   - Always validate and parse using Zod Discriminated Unions in `src/schemas/`.
   - Never create 1:1 relational extension tables for variants.

2. **Payments & Cashflow (Decoupled Ledger):**
   - Record every transaction in `job_payments`. Never mutate or overwrite payments on the parent `jobs` entity.
   - Always track `parts_cost` for hardware repairs (net profit calculation) and `billing_period` (`YYYY-MM`) for retainers.

3. **Edge Authentication:**
   - Use `arctic` (OAuth 2.0) + `jose` (Web Crypto stateless JWT/cookies) for session management.
   - Never use `next-auth` or heavy Node-specific auth adapters.
   - Always respect the `MOCK_AUTH=true` local development bypass.

4. **Uploads & R2 Storage:**
   - Mobile camera uploads must be compressed via HTML5 Canvas in the browser (<300KB WebP/JPEG, max 1280px) before uploading to Cloudflare R2.
   - Workers should only handle pre-signed URLs or lightweight compressed payloads to avoid memory and payload limits.

5. **Concurrency & Sequential Numbers:**
   - Generate sequential job identifiers via the `job_counters` table using `INSERT ... ON CONFLICT(user_id, prefix) DO UPDATE SET seq = seq + 1 RETURNING seq`.
   - Never calculate `SELECT MAX(id) + 1` in application code.

6. **Strict Multi-Tenant Partitioning:**
   - Every database query touching `clients`, `jobs`, `job_payments`, or `job_photos` must require `userId` as its first parameter and filter with `WHERE user_id = ?`.
