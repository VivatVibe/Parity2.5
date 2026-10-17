import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import {
  initDatabase,
  getOrCreateUser,
  createClient,
  searchClients,
  createJob,
  getJobs,
  getJobById,
  getNextJobNumber,
} from "../src/lib/db";
import { JobInputSchema } from "../src/schemas/job";

/**
 * Lightweight in-memory D1 mock using Node 22 native DatabaseSync
 */
function createMockD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");

  return {
    prepare(query: string) {
      let boundValues: any[] = [];
      return {
        bind(...values: any[]) {
          boundValues = values;
          return this;
        },
        async first<T = any>() {
          const stmt = sqlite.prepare(query);
          return (stmt.get(...boundValues) as T) || null;
        },
        async all<T = any>() {
          const stmt = sqlite.prepare(query);
          const results = stmt.all(...boundValues) as T[];
          return { results, success: true, meta: {} as any };
        },
        async run() {
          const stmt = sqlite.prepare(query);
          stmt.run(...boundValues);
          return { success: true, meta: {} as any };
        },
      } as any;
    },
  } as unknown as D1Database;
}

async function runTicket2Verification() {
  console.log("🚀 Running Ticket 2 Self-Check Verification (Client Registry & Polymorphic Intake)...");

  const db = createMockD1();

  // 1. Initialize schema in SQLite
  await initDatabase(db);
  console.log("  ✓ D1 Schema Initialized successfully");

  // 2. Set up Tenants (User 1 and User 2)
  const user1 = await getOrCreateUser(db, "vivat@parity.local", "Vivat Solo Dev");
  const user2 = await getOrCreateUser(db, "other@parity.local", "Other Freelancer");
  assert.strictEqual(user1.id, 1);
  assert.strictEqual(user2.id, 2);
  console.log("  ✓ Multi-tenant users created (User 1, User 2)");

  // 3. Client Registry: Creation & Search with Tenant Isolation
  const client1A = await createClient(db, user1.id, {
    name: "สมชาย สายช่าง",
    phone: "0812345678",
    lineId: "somchai_it",
    notes: "ลูกค้าประจำ โน้ตบุ๊ก",
  });
  const client1B = await createClient(db, user1.id, {
    name: "สมหญิง กิจการดี",
    phone: "0899999999",
    lineId: "somying_biz",
  });
  const client2A = await createClient(db, user2.id, {
    name: "จอห์น โด",
    phone: "0823334444",
  });

  assert.strictEqual(client1A.name, "สมชาย สายช่าง");
  assert.strictEqual(client1B.name, "สมหญิง กิจการดี");

  // Search User 1 clients
  const searchByName = await searchClients(db, user1.id, "สมชาย");
  assert.strictEqual(searchByName.length, 1);
  assert.strictEqual(searchByName[0].name, "สมชาย สายช่าง");

  const searchByPhone = await searchClients(db, user1.id, "089");
  assert.strictEqual(searchByPhone.length, 1);
  assert.strictEqual(searchByPhone[0].name, "สมหญิง กิจการดี");

  // Isolation check: User 1 search MUST NOT return User 2's clients
  const searchCrossTenant = await searchClients(db, user1.id, "จอห์น");
  assert.strictEqual(searchCrossTenant.length, 0);
  console.log("  ✓ Client Registry creation, search, and tenant isolation verified");

  // 4. Form Coercion Verification via JobInputSchema (HTML form submissions pass strings)
  const coercedFormInput = JobInputSchema.parse({
    job_type: "REPAIR",
    client_id: String(client1A.id), // String coerced to number
    title: "ซ่อม ThinkPad T480 เปิดไม่ติด",
    total_quoted_amount: "3500", // String coerced to number
    metadata: {
      deviceModel: "ThinkPad T480",
      serialNumber: "PF123456",
      symptom: "ไฟไม่เข้าเครื่อง บอร์ดช็อต",
      accessories: "สายชาร์จ 65W",
      partsCost: "1200", // String coerced to number
    },
  });
  assert.strictEqual(coercedFormInput.client_id, client1A.id);
  assert.strictEqual(coercedFormInput.total_quoted_amount, 3500);
  assert.strictEqual((coercedFormInput.metadata as any).partsCost, 1200);
  console.log("  ✓ Zod z.coerce.number() form string handling verified");

  // 5. Polymorphic Intake & Atomic Number Generation
  // Job 1 (REPAIR for User 1) -> PR-0001
  const jobRepair1 = await createJob(db, user1.id, coercedFormInput);
  assert.strictEqual(jobRepair1.job_number, "PR-0001");
  assert.strictEqual(jobRepair1.job_type, "REPAIR");
  assert.strictEqual(jobRepair1.status, "RECEIVED");

  // Job 2 (REPAIR for User 1) -> PR-0002 (Atomic counter increment)
  const jobRepair2 = await createJob(db, user1.id, {
    job_type: "REPAIR",
    client_id: client1A.id,
    title: "เปลี่ยนจอ iPad Air 4",
    total_quoted_amount: 4500,
    metadata: {
      deviceModel: "iPad Air 4",
      symptom: "จอแตก ทัชสกรีนไม่ตอบสนอง",
      partsCost: 2800,
    },
  });
  assert.strictEqual(jobRepair2.job_number, "PR-0002");

  // Job 3 (PROJECT for User 1) -> PJ-0001
  const jobProject1 = await createJob(db, user1.id, {
    job_type: "PROJECT",
    client_id: client1B.id,
    title: "On-page SEO Audit + Performance",
    total_quoted_amount: 15000,
    metadata: {
      domainUrl: "https://somyingbiz.com",
      scopeSummary: "Audit 50 pages and fix Core Web Vitals",
      repoUrl: "https://github.com/somying/site",
      deliverables: "Google Sheet Report + Final PR",
    },
  });
  assert.strictEqual(jobProject1.job_number, "PJ-0001");
  assert.strictEqual(jobProject1.job_type, "PROJECT");

  // Job 4 (RETAINER for User 1) -> RT-0001
  const jobRetainer1 = await createJob(db, user1.id, {
    job_type: "RETAINER",
    client_id: client1B.id,
    title: "ดูแลระบบเซิร์ฟเวอร์และ SEO ประจำเดือน",
    total_quoted_amount: 8500,
    metadata: {
      billingCycleDay: 25,
      monthlyRate: 8500,
      serviceScope: "อัปเดตความปลอดภัย + สำรองข้อมูลรายสัปดาห์",
    },
  });
  assert.strictEqual(jobRetainer1.job_number, "RT-0001");
  assert.strictEqual(jobRetainer1.job_type, "RETAINER");
  assert.strictEqual(jobRetainer1.status, "ACTIVE"); // Retainers default to ACTIVE

  // User 2 creates a REPAIR job -> PR-0001 (Independent sequence per tenant!)
  const user2Job = await createJob(db, user2.id, {
    job_type: "REPAIR",
    client_id: client2A.id,
    title: "ซ่อมคอม User 2",
    metadata: {
      deviceModel: "Dell XPS",
      symptom: "แบตบวม",
      partsCost: 1500,
    },
  });
  assert.strictEqual(user2Job.job_number, "PR-0001");
  console.log("  ✓ Polymorphic job intake (REPAIR, PROJECT, RETAINER) and atomic counters verified");

  // 6. Verification of getJobById with Parsed Metadata
  const fetchedJob = await getJobById(db, user1.id, jobRepair1.id);
  assert.ok(fetchedJob !== null);
  assert.strictEqual(fetchedJob.client?.name, "สมชาย สายช่าง");
  assert.strictEqual(fetchedJob.parsedMetadata.deviceModel, "ThinkPad T480");
  assert.strictEqual(fetchedJob.parsedMetadata.partsCost, 1200);
  console.log("  ✓ getJobById correctly hydrates client data and parses polymorphic metadata");

  // 7. Security: Cross-Tenant client_id injection attempt
  // User 1 tries to use User 2's client (client2A)
  await assert.rejects(
    async () => {
      await createJob(db, user1.id, {
        job_type: "REPAIR",
        client_id: client2A.id, // Belongs to User 2!
        title: "Malicious cross-tenant attempt",
        metadata: {
          deviceModel: "Test",
          symptom: "Test",
          partsCost: 0,
        },
      });
    },
    (err: any) => {
      return err.message.includes(`Client ID ${client2A.id} not found or does not belong to user ${user1.id}`);
    }
  );
  console.log("  ✓ Cross-tenant client_id injection attempt successfully blocked!");

  console.log("🎉 All Ticket 2 assertions passed successfully!");
}

runTicket2Verification().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
