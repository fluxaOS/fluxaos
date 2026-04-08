import { publicProcedure, router } from '@/server/trpc';

export const organizationRouter = router({
  list: publicProcedure.query(() => []),
});
