import { publicProcedure, router } from '@/server/trpc';

export const issueRouter = router({
  list: publicProcedure.query(() => []),
});
