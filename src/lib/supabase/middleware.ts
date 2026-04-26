/**
 * Supabase session management for Next.js middleware/proxy.
 * Refreshes the session on every request and redirects unauthenticated
 * users to /login.
 */
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase config: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set.'
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
 * Homelab-only auth bypass: when FLUXAOS_LAN_AUTH_BYPASS=1 is set, skip the
 * /login redirect. Intended ONLY for dev servers on an isolated LAN where
 * TCP reachability itself is the access boundary (the app is bound to a
 * private IP behind a firewall; external clients can't open a socket at
 * all). Do NOT set this flag in any environment reachable from the
 * public internet.
 *
 * Design rationale: earlier versions of this check tried to match the
 * client IP against a CIDR prefix using `x-forwarded-for` / `x-real-ip` /
 * `host` headers. On our homelab setup there is no reverse proxy, so the
 * forwarded headers are absent and `host` is the address the client
 * dialed (client-controlled and therefore spoofable). A broken IP check
 * is worse than no IP check — the flag itself is the access control.
 *
 * Flag is unset by default (including .env.example); production Vercel
 * deployments inherit the unset default and behavior is unchanged.
 *
 * Unused `_request` kept for parity with updateSession's caller shape in
 * case a future version needs per-request context.
 */
function isLanBypass(_request: NextRequest): boolean {
  return process.env.FLUXAOS_LAN_AUTH_BYPASS === '1';
}
