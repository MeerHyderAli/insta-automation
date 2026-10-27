import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optional Basic Auth for the dashboard. Enabled only when both
 * DASHBOARD_USERNAME and DASHBOARD_PASSWORD are set. The webhook and health
 * routes are excluded — Meta cannot send Basic Auth credentials.
 */
function safeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export function middleware(request: NextRequest) {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!username || !password) return NextResponse.next();

  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice('Basic '.length));
      const separator = decoded.indexOf(':');
      const providedUser = decoded.slice(0, separator);
      const providedPassword = decoded.slice(separator + 1);
      if (safeEqual(providedUser, username) && safeEqual(providedPassword, password)) {
        return NextResponse.next();
      }
    } catch {
      // Malformed credentials fall through to 401.
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Dashboard"' },
  });
}

export const config = {
  matcher: [
    '/((?!api/webhook|api/health|privacy|terms|data-deletion|app-icon\\.png|_next/static|_next/image|favicon.ico|icon.svg).*)',
  ],
};
