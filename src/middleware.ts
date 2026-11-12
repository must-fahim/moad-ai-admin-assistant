import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/health"]);

async function hasSession(token: string | undefined) {
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = await hasSession(request.cookies.get("moad_session")?.value);
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!signedIn && !isPublic) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
