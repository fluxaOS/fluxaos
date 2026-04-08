import { publicProcedure, router } from '@/server/trpc';

export const personaRouter = router({
  list: publicProcedure.query(() => []),
});
