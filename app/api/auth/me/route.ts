import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { env } from "cloudflare:workers";
import { initDatabase, getOrCreateUser } from "@/src/lib/db";

export async function GET(request: Request) {
  try {
    if (env.DB) {
      await initDatabase(env.DB);
    }

    const session = await getCurrentUser(request);
    if (!session) {
      return NextResponse.json({ authenticated: false, user: null }, { status: 401 });
    }

    // Ensure user exists in D1 database
    let userRecord = session;
    if (env.DB) {
      const dbUser = await getOrCreateUser(env.DB, session.email, session.name, session.avatarUrl);
      userRecord = {
        userId: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        avatarUrl: dbUser.avatar_url,
      };
    }

    return NextResponse.json({
      authenticated: true,
      user: userRecord,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
