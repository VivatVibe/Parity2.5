import { NextResponse } from "next/server";
import { createClearSessionCookieHeader } from "@/src/lib/auth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url));
  response.headers.append("Set-Cookie", createClearSessionCookieHeader());
  return response;
}
