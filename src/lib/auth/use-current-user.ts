'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type UseCurrentUserResult = {
  userId: string | null;
  isLoading: boolean;
};

/**
 * Subscribe to the Supabase auth session and return the current user ID.
 *
 * Returns `{ userId: null }` when no session exists — which includes
 * dev sessions running under FLUXAOS_LAN_AUTH_BYPASS (middleware skips
 * the /login redirect but no actual session cookie is created).
 *
 * Callers should pass the returned `userId` to `hasFeature(userId, ...)`
 * — `hasFeature` accepts `null` (equivalent to an anonymous user).
 */
export function useCurrentUser(): UseCurrentUserResult {
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUserId(data.user?.id ?? null);
      setIsLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUserId(session?.user?.id ?? null);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { userId, isLoading };
}
