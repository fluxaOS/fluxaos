import { publicProcedure, router } from '@/server/trpc';

export const projectRouter = router({
  list: publicProcedure.query(() => []),
});
