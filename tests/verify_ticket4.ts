import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import {
  initDatabase,
  getOrCreateUser,
  createClient,
  createJob,
  getJobById,
  validatePhotoUploadQuota,
  createJobPhoto,
  getJobPhotos,
  getJobPhotoById,
  deleteJobPhoto,
} from "../src/lib/db";
import { putPhoto, getPhoto, deletePhoto, clearMemoryStorage } from "../src/lib/storage";

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

async function runTicket4Verification() {
  console.log("🚀 Running Ticket 4 Self-Check Verification (R2 Photos & Quota Enforcement)...");

  clearMemoryStorage();
  const db = createMockD1();
  await initDatabase(db);

  // 1. Setup multi-tenant users & clients
  const user1 = await getOrCreateUser(db, "vivat@parity.local", "Vivat Solo Dev");
  const user2 = await getOrCreateUser(db, "intruder@parity.local", "Intruder User");

  const client1 = await createClient(db, user1.id, {
    name: "คุณสมชาย เจ้าของเครื่อง",
  });
  const client2 = await createClient(db, user2.id, {
    name: "คุณวิชัย",
  });

  const job1 = await createJob(db, user1.id, {
    job_type: "REPAIR",
    client_id: client1.id,
    title: "ซ่อมจอ MacBook Pro M1",
    total_quoted_amount: 8500,
    metadata: {
      deviceModel: "MacBook Pro M1 13-inch",
      symptom: "จอแตกเป็นเส้น",
      partsCost: 5500,
    },
  });

  const job2 = await createJob(db, user2.id, {
    job_type: "REPAIR",
    client_id: client2.id,
    title: "ซ่อมคอม User 2",
    metadata: {
      deviceModel: "Dell Latitude",
      symptom: "คีย์บอร์ดเสีย",
      partsCost: 800,
    },
  });

  // 2. Storage Helper Test (put, get, delete with Uint8Array binary)
  const dummyBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]); // Mock image header
  const mockR2Key1 = `users/${user1.id}/jobs/${job1.id}/test-photo-1.webp`;

  await putPhoto(null, mockR2Key1, dummyBuffer, "image/webp");
  const fetched = await getPhoto(null, mockR2Key1);
  assert.ok(fetched !== null);
  assert.strictEqual(fetched.contentType, "image/webp");
  assert.strictEqual(fetched.data.length, dummyBuffer.length);
  console.log("  ✓ Zero-bloat Storage helper put & get operations verified");

  // 3. Max 5 Photos Quota Enforcement
  // Upload 5 photos sequentially
  const photos = [];
  for (let i = 1; i <= 5; i++) {
    const key = `users/${user1.id}/jobs/${job1.id}/photo-${i}.webp`;
    await putPhoto(null, key, dummyBuffer, "image/webp");
    const p = await createJobPhoto(db, user1.id, job1.id, key, `สภาพเครื่องมุมที่ ${i}`);
    photos.push(p);
  }
  assert.strictEqual(photos.length, 5);

  const photosInDb = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(photosInDb.length, 5);
  console.log("  ✓ Successfully uploaded 5 photos for Job 1");

  // Attempting 6th photo MUST throw quota error
  await assert.rejects(
    async () => {
      await createJobPhoto(
        db,
        user1.id,
        job1.id,
        `users/${user1.id}/jobs/${job1.id}/photo-6.webp`,
        "รูปที่ 6 เกินโควตา"
      );
    },
    (err: any) => {
      return err.message.includes("อัปโหลดรูปภาพได้สูงสุด 5 รูปต่อใบงาน (Max 5 photos reached)");
    }
  );
  // Validate that validatePhotoUploadQuota rejects BEFORE touching R2 (prevents orphaned files)
  await assert.rejects(
    async () => {
      await validatePhotoUploadQuota(db, user1.id, job1.id);
    },
    (err: any) => {
      return err.message.includes("อัปโหลดรูปภาพได้สูงสุด 5 รูปต่อใบงาน (Max 5 photos reached)");
    }
  );
  console.log("  ✓ validatePhotoUploadQuota strictly prevents orphaned R2 uploads!");
  console.log("  ✓ 6th photo strictly rejected by Max 5 Quota guard!");

  // 4. Cross-Tenant Security Gate:
  // User 2 (intruder) tries to upload a photo to User 1's job
  await assert.rejects(
    async () => {
      await createJobPhoto(
        db,
        user2.id, // User 2!
        job1.id, // Job 1 belongs to User 1!
        `users/${user2.id}/jobs/${job1.id}/malicious.webp`
      );
    },
    (err: any) => {
      return err.message.includes(`Job ID ${job1.id} not found or does not belong to user ${user2.id}`);
    }
  );

  // User 2 tries to delete User 1's photo
  await assert.rejects(
    async () => {
      await deleteJobPhoto(
        db,
        user2.id, // User 2!
        job1.id,
        photos[0].id // Photo belongs to User 1!
      );
    },
    (err: any) => {
      return err.message.includes(`Photo ID ${photos[0].id} not found or does not belong to user ${user2.id}`);
    }
  );

  // User 2 tries to fetch User 1's photo via tenant-scoped getter
  const unauthorizedPhoto = await getJobPhotoById(db, job1.id, photos[0].id, user2.id);
  assert.strictEqual(unauthorizedPhoto, null, "User 2 must not be able to get User 1's photo");
  console.log("  ✓ Cross-tenant photo upload, delete, and fetch strictly blocked!");

  // 5. Deleting a photo frees up a quota slot
  const photoToDelete = photos[0];
  const deleted = await deleteJobPhoto(db, user1.id, job1.id, photoToDelete.id);
  assert.strictEqual(deleted.id, photoToDelete.id);
  await deletePhoto(null, deleted.r2_key);

  const afterDeletePhotos = await getJobPhotos(db, user1.id, job1.id);
  assert.strictEqual(afterDeletePhotos.length, 4);

  // Now uploading a replacement 5th photo MUST succeed!
  const replacementKey = `users/${user1.id}/jobs/${job1.id}/replacement-photo.webp`;
  await putPhoto(null, replacementKey, dummyBuffer, "image/webp");
  const replacementPhoto = await createJobPhoto(
    db,
    user1.id,
    job1.id,
    replacementKey,
    "รูปใหม่แทนที่รูปเดิมที่ลบไป"
  );
  assert.ok(replacementPhoto.id > 0);

  const finalJob = await getJobById(db, user1.id, job1.id);
  assert.ok(finalJob !== null);
  assert.strictEqual(finalJob.photos.length, 5);
  console.log("  ✓ Deleting a photo successfully frees up a quota slot for a new photo");

  console.log("🎉 All Ticket 4 assertions passed successfully!");
}

runTicket4Verification().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
