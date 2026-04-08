import { publicProcedure, router } from '@/server/trpc';

export const pipelineRouter = router({
  list: publicProcedure.query(() => []),
});
