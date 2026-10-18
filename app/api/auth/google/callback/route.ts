import { getGoogleOAuthClient, createSessionToken, createSessionCookieHeader } from "@/src/lib/auth";
import { getOrCreateUser } from "@/src/lib/db";
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
    if (!env.DB) {
      return NextResponse.json({ error: "D1 database connection unavailable" }, { status: 500 });
    }

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

    // Fail closed: User must be stored in D1
    const user = await getOrCreateUser(env.DB, profile.email, profile.name || profile.email, profile.picture);

    // Create Session Token
    const sessionToken = await createSessionToken({
      userId: user.id,
      email: profile.email,
      name: profile.name || profile.email,
      avatarUrl: profile.picture,
    });

    // Redirect to home with session cookie and clear one-time OAuth state cookies
    const response = NextResponse.redirect(new URL("/", request.url));
    const isProd = process.env.NODE_ENV === "production";
    response.headers.append("Set-Cookie", createSessionCookieHeader(sessionToken));
    response.headers.append(
      "Set-Cookie",
      `google_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`
    );
    response.headers.append(
      "Set-Cookie",
      `google_code_verifier=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`
    );

    return response;
  } catch (error: any) {
    console.error("OAuth Callback Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
