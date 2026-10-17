import { generateState, generateCodeVerifier } from "arctic";
import { getGoogleOAuthClient } from "@/src/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const google = getGoogleOAuthClient();
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);

    const response = NextResponse.redirect(url);
    const isProd = process.env.NODE_ENV === "production";

    response.cookies.set("google_oauth_state", state, {
      path: "/",
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 600,
    });

    response.cookies.set("google_code_verifier", codeVerifier, {
      path: "/",
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 600,
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
