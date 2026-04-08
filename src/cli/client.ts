import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@/server/root';

const DEFAULT_URL = 'http://localhost:3000/api/trpc';

export function createCLIClient(baseUrl?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl ?? DEFAULT_URL,
      }),
    ],
  });
}

export type CLIClient = ReturnType<typeof createCLIClient>;
