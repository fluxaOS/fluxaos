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

export const appRouter = router({
  organization: organizationRouter,
  project: projectRouter,
  issue: issueRouter,
  issueCatalog: issueCatalogRouter,
  skill: skillRouter,
  persona: personaRouter,
  pipeline: pipelineRouter,
});

export type AppRouter = typeof appRouter;
