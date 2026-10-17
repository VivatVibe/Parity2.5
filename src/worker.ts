import { reconcileR2Storage } from "./lib/storage";
import { cleanupOrphanedPhotos } from "./lib/db";

// Lazy-load or fallback fetch handler for hybrid Node testing and Vite bundling
let fetchHandler: any = null;
async function resolveFetchHandler() {
  if (!fetchHandler) {
    try {
      // In Vite/Cloudflare build, 'vinext/server/fetch-handler' is resolved by the Vite plugin
      const mod = await import("vinext/server/fetch-handler");
      fetchHandler = mod.default || mod;
    } catch {
      // Fallback in Node test harness
      fetchHandler = async (req: Request) => new Response("OK", { status: 200 });
    }
  }
  return fetchHandler;
}

/**
 * Cloudflare Worker Scheduled Event Handler for periodic maintenance.
 * Invoked by Cloudflare Cron Triggers (e.g. daily at 03:00 UTC).
 */
export async function handleScheduledEvent(
  event: any,
  env: any,
  ctx?: any
): Promise<{ sweeper: any; reconciler: any }> {
  const r2Binding = env?.PHOTOS || env?.R2;
  let sweeperResult = { cleanedCount: 0, failedCount: 0, skippedCount: 0 };
  let reconcilerResult = {
    scannedCount: 0,
    deletedOrphans: [] as string[],
    failedDeletions: [] as { key: string; error: string }[],
    truncated: false,
  };

  if (env?.DB) {
    // 1. Sweeper execution: Purges expired reservations (>5m), PENDING_DELETE rows, and stale leases
    sweeperResult = await cleanupOrphanedPhotos(env.DB, r2Binding);

    // 2. Cross-service storage reconciler: Purges confirmed unreferenced R2 objects older than grace period
    if (r2Binding) {
      reconcilerResult = await reconcileR2Storage(r2Binding, env.DB, {
        prefix: "users/",
        safetyGracePeriodMs: 60 * 60 * 1000, // 1 hour safety grace period
      });
    }
  }

  return { sweeper: sweeperResult, reconciler: reconcilerResult };
}

export default {
  // 1. HTTP Request Handler (Next.js / Vinext SSR & API Routes)
  async fetch(request: Request, env: any, ctx: any) {
    const handler = await resolveFetchHandler();
    return (handler as any).fetch ? (handler as any).fetch(request, env, ctx) : (handler as any)(request, env, ctx);
  },

  // 2. Cloudflare Scheduled Cron Event Handler
  async scheduled(event: any, env: any, ctx: any) {
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(handleScheduledEvent(event, env, ctx));
    } else {
      await handleScheduledEvent(event, env, ctx);
    }
  },
};
