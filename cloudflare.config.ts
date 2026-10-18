import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: process.env.WORKER_NAME || "parity-app",
    entrypoint: "src/worker.ts",
    compatibilityDate: "2026-10-17",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    triggers: [
      { type: "scheduled", schedule: "0 3 * * *" }, // Daily cron trigger at 03:00 UTC
    ],
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({
        name: "parity-db",
        ...(process.env.D1_DATABASE_ID ? { id: process.env.D1_DATABASE_ID } : {}),
      }),
      PHOTOS: bindings.r2({ name: process.env.R2_BUCKET_NAME || "parity-photos" }),
    },
  }),
});
