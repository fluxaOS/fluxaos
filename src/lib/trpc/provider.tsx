'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './client';
import { bootstrap } from '@/config/bootstrap';

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  return 'http://localhost:3000';
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  // Initialize the adapter registry on the client (once).
  // bootstrap() only registers factories; the database/queue factories
  // read server-only env vars but are never invoked from the browser.
  useState(() => { bootstrap(); });

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: false,
      },
    },
  }));

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
