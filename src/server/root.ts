import { brandRouter } from '@/server/routers/brand';
import { healthRouter } from '@/server/routers/health';
import { issueRouter } from '@/server/routers/issue';
import { organizationRouter } from '@/server/routers/organization';
import { personaRouter } from '@/server/routers/persona';
import { pipelineRouter } from '@/server/routers/pipeline';
import { projectRouter } from '@/server/routers/project';
import { providerRouter } from '@/server/routers/provider';
import { routingRouter } from '@/server/routers/routing';
import { skillRouter } from '@/server/routers/skill';
import { router } from '@/server/trpc';

export const appRouter = router({
  health: healthRouter,
  organization: organizationRouter,
  project: projectRouter,
  pipeline: pipelineRouter,
  issue: issueRouter,
  persona: personaRouter,
  skill: skillRouter,
  provider: providerRouter,
  routing: routingRouter,
  brand: brandRouter,
});

export type AppRouter = typeof appRouter;
