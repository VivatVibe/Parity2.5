import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "parity-app",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-17",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    triggers: [
      { type: "scheduled", schedule: "0 3 * * *" }, // Daily cron trigger at 03:00 UTC
    ],
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: "parity-db", id: "00000000-0000-0000-0000-000000000000" }),
      PHOTOS: bindings.r2({ name: "parity-photos" }),
    },
  }),
});
