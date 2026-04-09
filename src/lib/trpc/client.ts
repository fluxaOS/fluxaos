import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@/server/root';

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  return 'http://localhost:3000';
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
    }),
  ],
});
