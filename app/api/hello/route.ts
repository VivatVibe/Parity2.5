import { env } from "cloudflare:workers";

export async function GET() {
  const hasDB = typeof env.DB !== "undefined";
  const hasPhotos = typeof env.PHOTOS !== "undefined";

  return Response.json({
    message: "Parity 2.5 API is alive",
    d1_connected: hasDB,
    r2_connected: hasPhotos,
  });
}
