/**
 * Supabase session management for Next.js middleware/proxy.
 * Refreshes the session on every request and redirects unauthenticated
 * users to /login.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase config: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set.',
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh the session — MUST happen before any other Supabase calls.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    !isLanBypass(request)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

/**
 * Homelab-only auth bypass: when FLUXAOS_LAN_AUTH_BYPASS=1 is set AND the
 * request comes from an allowlisted private CIDR, skip the login redirect.
 * Default allowlist is 192.168.54.0/24 (override with FLUXAOS_LAN_AUTH_BYPASS_CIDR).
 * Flag is unset in production; this is safe by default.
 */
function isLanBypass(request: NextRequest): boolean {
  if (process.env.FLUXAOS_LAN_AUTH_BYPASS !== '1') return false;
  const prefix = process.env.FLUXAOS_LAN_AUTH_BYPASS_CIDR ?? '192.168.54.';
  const candidates = [
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    request.headers.get('x-real-ip'),
    request.headers.get('host')?.split(':')[0],
  ].filter((v): v is string => Boolean(v));
  return candidates.some((ip) => ip.startsWith(prefix));
}
