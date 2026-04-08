import { publicProcedure, router } from '@/server/trpc';

export const healthRouter = router({
  check: publicProcedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  })),
});
