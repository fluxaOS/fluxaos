import { publicProcedure, router } from '@/server/trpc';

export const providerRouter = router({
  list: publicProcedure.query(() => []),
});
