import { Google } from "arctic";
import { SignJWT, jwtVerify } from "jose";

export interface SessionPayload {
  userId: number;
  email: string;
  name: string;
  avatarUrl?: string;
}

const JWT_SECRET_STRING = process.env.JWT_SECRET || "parity-2-5-super-secret-jwt-key-2026-edge";
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING);
const COOKIE_NAME = "parity_session";

// 1. Google OAuth Client (Arctic)
export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:5173/api/auth/google/callback";

  return new Google(clientId, clientSecret, redirectUri);
}

// 2. Session Token Operations (Jose Web Crypto)
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as number,
      email: payload.email as string,
      name: payload.name as string,
      avatarUrl: payload.avatarUrl as string | undefined,
    };
  } catch (error) {
    return null;
  }
}

// 3. Extract Cookie from Request
export function getSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split("; ").map((c) => {
      const [key, ...v] = c.split("=");
      return [key, decodeURIComponent(v.join("="))];
    })
  );

  return cookies[COOKIE_NAME] || null;
}

// 4. Resolve Current User (With MOCK_AUTH bypass support)
export async function getCurrentUser(request: Request): Promise<SessionPayload | null> {
  // Check session cookie first
  const token = getSessionCookie(request);
  if (token) {
    const session = await verifySessionToken(token);
    if (session) return session;
  }

  // Local Dev Mock Auth Bypass
  const isMockAuth = process.env.MOCK_AUTH === "true" || process.env.NODE_ENV !== "production";
  if (isMockAuth) {
    return {
      userId: 1,
      email: "vivat@parity.local",
      name: "Vivat (Local Solo Worker)",
      avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=vivat",
    };
  }

  return null;
}

// 5. Helper to create Set-Cookie header string
export function createSessionCookieHeader(token: string): string {
  const isProd = process.env.NODE_ENV === "production";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    30 * 24 * 60 * 60
  }${isProd ? "; Secure" : ""}`;
}

export function createClearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
