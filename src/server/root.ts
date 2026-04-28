/**
 * Root tRPC router — merges all domain routers.
 */

import { configRouter } from './routers/config';
import { cronRouter } from './routers/cron';
import { driverRouter } from './routers/driver';
import { gateRouter } from './routers/gate';
import { issueRouter } from './routers/issue';
import { issueCatalogRouter } from './routers/issue-catalog';
import { missionRouter } from './routers/mission-control';
import { organizationRouter } from './routers/organization';
import { personaRouter } from './routers/persona';
import { pipelineRouter } from './routers/pipeline';
import { projectRouter } from './routers/project';
import { providerRouter } from './routers/provider';
import { routingRouter } from './routers/routing';
import { skillRouter } from './routers/skill';
import { systemRouter } from './routers/system';
import { teamRouter } from './routers/team';
import { userRouter } from './routers/user';
import { router } from './trpc';

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
  config: configRouter,
  cron: cronRouter,
  system: systemRouter,
  team: teamRouter,
  user: userRouter,
  mission: missionRouter,
});

export type AppRouter = typeof appRouter;
