import { Google } from "arctic";
import { SignJWT, jwtVerify } from "jose";

export interface SessionPayload {
  userId: number;
  email: string;
  name: string;
  avatarUrl?: string;
}

const COOKIE_NAME = "parity_session";

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET environment variable is strictly required in production");
    }
    return new TextEncoder().encode("parity-dev-secret-only-for-local-2026");
  }
  return new TextEncoder().encode(secret);
}

// 1. Google OAuth Client (Arctic)
export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:5173/api/auth/google/callback";

  return new Google(clientId, clientSecret, redirectUri);
}

// 2. Session Token Operations (Jose Web Crypto)
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const secret = getJwtSecret();
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret);

    // Validate claims strictly before trusting them
    const userId = Number(payload.userId);
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const avatarUrl = typeof payload.avatarUrl === "string" ? payload.avatarUrl : undefined;

    if (!userId || isNaN(userId) || userId <= 0 || !email || !name) {
      return null;
    }

    return {
      userId,
      email,
      name,
      avatarUrl,
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

// 4. Resolve Current User (Strict Production Security: Zero Mock Bypass in Prod)
export async function getCurrentUser(request: Request): Promise<SessionPayload | null> {
  // Check session cookie first
  const token = getSessionCookie(request);
  if (token) {
    const session = await verifySessionToken(token);
    if (session) return session;
  }

  // SEC-01: In production, mock authentication is strictly forbidden!
  // Production deployments MUST NEVER accept MOCK_AUTH=true.
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  // Safe local dev / test mock bypass: ONLY active when MOCK_AUTH === "true" in non-production.
  if (process.env.MOCK_AUTH === "true") {
    return {
      userId: 1,
      email: "vivat@parity.local",
      name: "Vivat (Local Solo Worker)",
      avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=vivat",
    };
  }

  return null;
}

// 5. Helper to create Set-Cookie header strings
export function createSessionCookieHeader(token: string): string {
  const isProd = process.env.NODE_ENV === "production";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    30 * 24 * 60 * 60
  }${isProd ? "; Secure" : ""}`;
}

export function createClearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
