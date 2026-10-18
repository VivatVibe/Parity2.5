import { env } from "cloudflare:workers";
import { handleMaintenanceReconciliation } from "@/src/lib/storage";

export async function POST(request: Request) {
  const r2Binding = (env as any)?.PHOTOS || (env as any)?.R2;
  const cronSecret = (env as any)?.CRON_SECRET || process.env.CRON_SECRET;
  return handleMaintenanceReconciliation(request, env?.DB, r2Binding, cronSecret);
}


