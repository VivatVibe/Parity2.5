import { reconcileR2Storage } from "./lib/storage";
import { cleanupOrphanedPhotos } from "./lib/db";

// Lazy-load or fallback fetch handler for hybrid Node testing and Vite bundling
let fetchHandler: any = null;
export function resetFetchHandlerForTesting() {
  fetchHandler = null;
}
export async function resolveFetchHandler() {
  if (!fetchHandler) {
    try {
      // In Vite/Cloudflare build, 'vinext/server/fetch-handler' is resolved by the Vite plugin
      const mod = await import("vinext/server/fetch-handler");
      fetchHandler = mod.default || mod;
    } catch (err) {
      // R7-B1: Fail closed in production. Never return a synthetic success response in production.
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "Production fetch handler initialization failed: cannot load 'vinext/server/fetch-handler'"
        );
      }
      // Fallback in Node test harness / development
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
  // R7-A3: Fail-closed runtime verification.
  // In Cloudflare Workers, throwing from a scheduled event notifies the runtime of a failed cron job.
  if (!env?.DB) {
    throw new Error("Scheduled maintenance failed: D1 database binding 'DB' is missing");
  }

  const r2Binding = env?.PHOTOS || env?.R2;
  if (!r2Binding) {
    throw new Error("Scheduled maintenance failed: R2 storage binding ('PHOTOS' or 'R2') is missing");
  }

  // 1. Sweeper execution: Purges expired reservations (>5m), PENDING_DELETE rows, and stale leases
  const sweeperResult = await cleanupOrphanedPhotos(env.DB, r2Binding);

  // 2. Cross-service storage reconciler: Purges confirmed unreferenced R2 objects older than grace period
  const reconcilerResult = await reconcileR2Storage(r2Binding, env.DB, {
    prefix: "users/",
    safetyGracePeriodMs: 60 * 60 * 1000, // 1 hour safety grace period
  });

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
