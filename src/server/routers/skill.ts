import { publicProcedure, router } from '@/server/trpc';

export const skillRouter = router({
  list: publicProcedure.query(() => []),
});
