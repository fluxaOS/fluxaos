'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { useState } from 'react';
import { bootstrapClient } from '@/config/bootstrap-client';
import { trpc } from './client';

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL is not set. tRPC provider cannot construct an absolute URL for SSR. ' +
        'Set NEXT_PUBLIC_APP_URL in your environment (e.g. http://192.168.54.101:3004 for dev, ' +
        'https://uat-flux.jdp21.com for UAT).'
    );
  }
  return url;
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  // Initialize the client adapter registry (once). bootstrapClient()
  // registers only browser-safe adapters (auth, realtime). Server-only
  // adapters (database, queue, executor, stdoutParser) live in the
  // separate server-side registry instance populated by bootstrap().
  useState(() => {
    bootstrapClient();
  });

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
