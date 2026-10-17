import { getGoogleOAuthClient, createSessionToken, createSessionCookieHeader } from "@/src/lib/auth";
import { getOrCreateUser, initDatabase } from "@/src/lib/db";
import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Read cookies from request
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader.split("; ").map((c) => {
      const [key, ...v] = c.split("=");
      return [key, decodeURIComponent(v.join("="))];
    })
  );

  const storedState = cookies["google_oauth_state"];
  const codeVerifier = cookies["google_code_verifier"];

  if (!code || !state || !storedState || !codeVerifier || state !== storedState) {
    return NextResponse.json({ error: "Invalid or expired OAuth state" }, { status: 400 });
  }

  try {
    const google = getGoogleOAuthClient();
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const accessToken = tokens.accessToken();

    // Fetch user profile from Google
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileResponse.ok) {
      throw new Error("Failed to fetch Google profile");
    }

    const profile: { email: string; name: string; picture?: string } = await profileResponse.json();

    if (!profile.email) {
      throw new Error("No email returned from Google");
    }

    // Ensure database is initialized & upsert user
    if (env.DB) {
      await initDatabase(env.DB);
    }

    let userId = 1;
    if (env.DB) {
      const user = await getOrCreateUser(env.DB, profile.email, profile.name || profile.email, profile.picture);
      userId = user.id;
    }

    // Create Session Token
    const sessionToken = await createSessionToken({
      userId,
      email: profile.email,
      name: profile.name || profile.email,
      avatarUrl: profile.picture,
    });

    // Redirect to home with session cookie
    const response = NextResponse.redirect(new URL("/", request.url));
    response.headers.append("Set-Cookie", createSessionCookieHeader(sessionToken));

    return response;
  } catch (error: any) {
    console.error("OAuth Callback Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
