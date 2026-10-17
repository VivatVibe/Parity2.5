import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import {
  initDatabase,
  getOrCreateUser,
  createClient,
  createJob,
  addJobPayment,
  getDashboardData,
} from "../src/lib/db";

/**
 * Lightweight in-memory D1 mock with query counter to verify Zero N+1 queries
 */
function createInstrumentedMockD1(): { db: D1Database; getQueryCount: () => number; resetQueryCount: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  let queryCount = 0;

  const db = {
    prepare(query: string) {
      let boundValues: any[] = [];
      return {
        bind(...values: any[]) {
          boundValues = values;
          return this;
        },
        async first<T = any>() {
          queryCount++;
          const stmt = sqlite.prepare(query);
          return (stmt.get(...boundValues) as T) || null;
        },
        async all<T = any>() {
          queryCount++;
          const stmt = sqlite.prepare(query);
          const results = stmt.all(...boundValues) as T[];
          return { results, success: true, meta: {} as any };
        },
        async run() {
          queryCount++;
          const stmt = sqlite.prepare(query);
          stmt.run(...boundValues);
          return { success: true, meta: {} as any };
        },
      } as any;
    },
  } as unknown as D1Database;

  return {
    db,
    getQueryCount: () => queryCount,
    resetQueryCount: () => {
      queryCount = 0;
    },
  };
}

async function runTicket5Verification() {
  console.log("🚀 Running Ticket 5 Self-Check Verification (Mission Control 3-Zone Dashboard & Retainer Radar)...");

  const { db, getQueryCount, resetQueryCount } = createInstrumentedMockD1();
  await initDatabase(db);

  // 1. Setup multi-tenant data
  const user1 = await getOrCreateUser(db, "vivat@parity.local", "Vivat Solo Dev");
  const user2 = await getOrCreateUser(db, "rival@parity.local", "Rival Freelancer");

  const client1A = await createClient(db, user1.id, {
    name: "คุณสมศักดิ์ คอมพิวเตอร์",
    phone: "081-444-5555",
  });
  const client1B = await createClient(db, user1.id, {
    name: "บริษัท ดิจิทัลคลินิก จำกัด",
    phone: "089-777-8888",
  });
  const client2 = await createClient(db, user2.id, {
    name: "ลูกค้าคนอื่นของ User 2",
    phone: "099-000-0000",
  });

  const currentMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

  // 2. Populate Zone 1: Repairs
  const repair1 = await createJob(db, user1.id, {
    job_type: "REPAIR",
    client_id: client1A.id,
    title: "ซ่อมบอร์ด ThinkPad X1",
    total_quoted_amount: 4500,
    metadata: {
      deviceModel: "ThinkPad X1 Carbon Gen 9",
      symptom: "เปิดไม่ติด มีไฟกระพริบ 3 ครั้ง",
      partsCost: 1500,
    },
  });

  // 3. Populate Zone 2: Projects
  const project1 = await createJob(db, user1.id, {
    job_type: "PROJECT",
    client_id: client1B.id,
    title: "พัฒนาเว็บแอปคลินิกทันตกรรม",
    due_date: "2026-10-31",
    total_quoted_amount: 25000,
    metadata: {
      domainUrl: "https://dentalclinic.co.th",
      scopeSummary: "ระบบจองคิวออนไลน์ 3 สาขา",
      deliverables: "Next.js App + Database",
    },
  });

  // 4. Populate Zone 3: Retainers (1 Paid for current month, 1 Unpaid)
  const retainerPaid = await createJob(db, user1.id, {
    job_type: "RETAINER",
    client_id: client1B.id,
    title: "ดูแลระบบเซิร์ฟเวอร์ & SEO ประจำเดือน (Paid)",
    total_quoted_amount: 10000,
    metadata: {
      billingCycleDay: 1,
      monthlyRate: 10000,
      serviceScope: "Uptime 99.9% + Security Updates",
    },
  });

  const retainerUnpaid = await createJob(db, user1.id, {
    job_type: "RETAINER",
    client_id: client1A.id,
    title: "ดูแลเว็บร้านค้าออนไลน์ (Unpaid)",
    total_quoted_amount: 6000,
    metadata: {
      billingCycleDay: 25,
      monthlyRate: 6000,
      serviceScope: "อัปเดตสต็อกและสำรองข้อมูล",
    },
  });

  // User 2's job (Must be isolated from User 1)
  await createJob(db, user2.id, {
    job_type: "REPAIR",
    client_id: client2.id,
    title: "งานลับของ User 2",
    total_quoted_amount: 99999,
    metadata: {
      deviceModel: "Super Secret Server",
      symptom: "Classified",
      partsCost: 0,
    },
  });

  // 5. Record Payments
  // Record partial deposit for repair1 (1,500 THB)
  await addJobPayment(db, user1.id, {
    jobId: repair1.id,
    amount: 1500,
    partsCost: 800,
    paymentType: "DEPOSIT",
  });

  // Record milestone for project1 (10,000 THB)
  await addJobPayment(db, user1.id, {
    jobId: project1.id,
    amount: 10000,
    partsCost: 0,
    paymentType: "MILESTONE",
  });

  // Record retainer cycle for retainerPaid (10,000 THB for current month)
  await addJobPayment(db, user1.id, {
    jobId: retainerPaid.id,
    amount: 10000,
    paymentType: "RETAINER_CYCLE",
    billingPeriod: currentMonth,
  });

  // 6. Test Zero N+1 Query Architecture
  resetQueryCount();
  const dashboard = await getDashboardData(db, user1.id);
  const totalQueriesFired = getQueryCount();

  // Exactly 2 SQL queries: 1 for monthly KPIs, 1 for aggregated jobs + clients + payments
  assert.strictEqual(
    totalQueriesFired,
    2,
    `Dashboard must fire exactly 2 aggregated SQL queries, fired: ${totalQueriesFired}`
  );
  console.log("  ✓ Zero N+1 query architecture verified (fired exactly 2 SQL queries for full dashboard)");

  // 7. Verify KPI Summary
  // Monthly revenue = 1,500 (deposit) + 10,000 (project) + 10,000 (retainer) = 21,500 THB
  assert.strictEqual(dashboard.kpis.monthlyRevenue, 21500);
  // Monthly parts cost = 800
  // Monthly profit = 21,500 - 800 = 20,700 THB
  assert.strictEqual(dashboard.kpis.monthlyProfit, 20700);
  assert.strictEqual(dashboard.kpis.activeJobsCount, 4);
  // Unpaid balance due:
  // repair1 balance: 4,500 - 1,500 = 3,000
  // project1 balance: 25,000 - 10,000 = 15,000
  // retainerPaid balance: 0 (paid for current cycle)
  // retainerUnpaid balance: 6,000
  // total unpaid balance = 3,000 + 15,000 + 0 + 6,000 = 24,000
  assert.strictEqual(dashboard.kpis.unpaidBalanceDue, 24000);
  console.log("  ✓ Dashboard KPI financial calculations verified");

  // 8. Verify Zone Categorization
  assert.strictEqual(dashboard.zones.repairs.length, 1);
  assert.strictEqual(dashboard.zones.projects.length, 1);
  assert.strictEqual(dashboard.zones.retainers.length, 2);

  // Project progress percent = (10,000 / 25,000) * 100 = 40%
  assert.strictEqual(dashboard.zones.projects[0].paymentProgress, 40);

  // Retainer Radar sorting: UNPAID must be on top!
  assert.strictEqual(
    dashboard.zones.retainers[0].id,
    retainerUnpaid.id,
    "Unpaid retainer must be sorted on top of Retainer Radar"
  );
  assert.strictEqual(dashboard.zones.retainers[0].currentCyclePaid, false);
  assert.strictEqual(dashboard.zones.retainers[1].currentCyclePaid, true);
  console.log("  ✓ Retainer Radar accurately sorts unpaid retainers to the top");

  // 9. Instant Search Verification
  // Search by deviceModel inside JSON metadata
  const searchByDevice = await getDashboardData(db, user1.id, "ThinkPad");
  assert.strictEqual(searchByDevice.zones.repairs.length, 1);
  assert.strictEqual(searchByDevice.zones.projects.length, 0);

  // Search by domainUrl inside JSON metadata
  const searchByDomain = await getDashboardData(db, user1.id, "dentalclinic");
  assert.strictEqual(searchByDomain.zones.projects.length, 1);
  assert.strictEqual(searchByDomain.zones.repairs.length, 0);

  // Search by client phone
  const searchByPhone = await getDashboardData(db, user1.id, "081-444");
  assert.strictEqual(searchByPhone.zones.repairs.length, 1);
  assert.strictEqual(searchByPhone.zones.retainers.length, 1);

  // Search by job number
  const searchByJobNum = await getDashboardData(db, user1.id, "PJ-0001");
  assert.strictEqual(searchByJobNum.zones.projects.length, 1);
  console.log("  ✓ Global instant search across job number, client, phone, and JSON metadata verified");

  // 10. Strict Tenant Isolation
  // User 1 must NEVER see User 2's jobs
  const user1Dashboard = await getDashboardData(db, user1.id);
  const foundUser2InUser1 = [
    ...user1Dashboard.zones.repairs,
    ...user1Dashboard.zones.projects,
    ...user1Dashboard.zones.retainers,
  ].some((j) => j.title.includes("User 2") || j.user_id === user2.id);
  assert.strictEqual(foundUser2InUser1, false);

  // User 2 dashboard only sees their own 1 job
  const user2Dashboard = await getDashboardData(db, user2.id);
  assert.strictEqual(user2Dashboard.zones.repairs.length, 1);
  assert.strictEqual(user2Dashboard.zones.repairs[0].title, "งานลับของ User 2");
  assert.strictEqual(user2Dashboard.zones.projects.length, 0);
  assert.strictEqual(user2Dashboard.zones.retainers.length, 0);
  console.log("  ✓ Strict tenant boundary on Dashboard confirmed");

  console.log("🎉 All Ticket 5 assertions passed successfully!");
}

runTicket5Verification().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
