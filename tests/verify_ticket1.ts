import assert from "node:assert";
import {
  RepairMetadataSchema,
  ProjectMetadataSchema,
  RetainerMetadataSchema,
  JobInputSchema,
  parseJobMetadata,
} from "../src/schemas/job";
import { createSessionToken, verifySessionToken } from "../src/lib/auth";

async function runTicket1Verification() {
  console.log("🚀 Running Ticket 1 Self-Check Verification...");

  // 1. Verify Repair Zod Schema
  const validRepair = RepairMetadataSchema.parse({
    deviceModel: "ThinkPad X1 Carbon",
    serialNumber: "SN123456",
    symptom: "คีย์บอร์ดพิมพ์ไม่ติดบางปุ่ม",
    accessories: "สายชาร์จ 65W",
    partsCost: 800,
  });
  assert.strictEqual(validRepair.deviceModel, "ThinkPad X1 Carbon");
  assert.strictEqual(validRepair.partsCost, 800);

  // 2. Verify Project Zod Schema
  const validProject = ProjectMetadataSchema.parse({
    domainUrl: "https://example.com",
    scopeSummary: "On-page SEO Audit + Speed Optimization",
    deliverables: "Google Sheet Report",
  });
  assert.strictEqual(validProject.domainUrl, "https://example.com");

  // 3. Verify Retainer Zod Schema
  const validRetainer = RetainerMetadataSchema.parse({
    billingCycleDay: 25,
    monthlyRate: 8500,
    serviceScope: "ดูแลระบบ WordPress ประจำเดือน + Backups",
  });
  assert.strictEqual(validRetainer.billingCycleDay, 25);
  assert.strictEqual(validRetainer.monthlyRate, 8500);

  // 4. Verify Discriminated Union Parsing
  const parsedJob = JobInputSchema.parse({
    job_type: "RETAINER",
    client_id: 1,
    title: "ดูแลเว็บรายเดือนร้านกาแฟ",
    metadata: {
      billingCycleDay: 1,
      monthlyRate: 5000,
      serviceScope: "SEO + Web Maintenance",
    },
  });
  assert.strictEqual(parsedJob.job_type, "RETAINER");

  // Verify Discriminated Union rejects invalid metadata
  assert.throws(() => {
    JobInputSchema.parse({
      job_type: "REPAIR",
      client_id: 1,
      title: "Invalid repair",
      metadata: {
        // Missing required symptom and deviceModel
        partsCost: 100,
      },
    });
  });

  // 5. Verify Edge Jose Auth Token Creation & Verification
  const payload = {
    userId: 42,
    email: "test@parity.local",
    name: "Tester",
  };
  const token = await createSessionToken(payload);
  assert.ok(typeof token === "string" && token.length > 20);

  const decoded = await verifySessionToken(token);
  assert.ok(decoded !== null);
  assert.strictEqual(decoded.userId, 42);
  assert.strictEqual(decoded.email, "test@parity.local");

  console.log("✅ All Ticket 1 assertions passed successfully!");
}

runTicket1Verification().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
