/**
 * Root tRPC router — merges all domain routers.
 */
import { router } from './trpc';
import { organizationRouter } from './routers/organization';
import { projectRouter } from './routers/project';
import { issueRouter } from './routers/issue';
import { issueCatalogRouter } from './routers/issue-catalog';
import { skillRouter } from './routers/skill';
import { personaRouter } from './routers/persona';
import { pipelineRouter } from './routers/pipeline';
import { gateRouter } from './routers/gate';
import { providerRouter } from './routers/provider';
import { routingRouter } from './routers/routing';
import { driverRouter } from './routers/driver';
import { systemRouter } from './routers/system';

export const appRouter = router({
  organization: organizationRouter,
  project: projectRouter,
  issue: issueRouter,
  issueCatalog: issueCatalogRouter,
  skill: skillRouter,
  persona: personaRouter,
  pipeline: pipelineRouter,
  gate: gateRouter,
  provider: providerRouter,
  routing: routingRouter,
  driver: driverRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
