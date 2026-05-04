/**
 * Service factories barrel export.
 *
 * All services receive Database via DI. No singleton imports.
 * Usage: const svc = createIssueService(db);
 */

export { createGateService, type GateService } from '@/core/gates/service';
export { type BrandService, createBrandService } from './brand';
export { type ConfigService, createConfigService } from './config';
export { type CronService, createCronService } from './cron';
export { createDriverService, type DriverService } from './driver';
export { createIssueService, type IssueService } from './issue';
export {
  createIssueCatalogService,
  type IssueCatalogService,
} from './issue-catalog';
export {
  createIssueCommentService,
  type IssueCommentService,
} from './issue-comment';
export { createIssueEventService, type IssueEventService } from './issue-event';
export {
  createOrganizationService,
  type OrganizationService,
} from './organization';
export { createPersonaService, type PersonaService } from './persona';
export { createPipelineService, type PipelineService } from './pipeline';
export { createProjectService, type ProjectService } from './project';
export { createProviderService, type ProviderService } from './provider';
export { createRoutingService, type RoutingService } from './routing';
export { createSkillService, type SkillService } from './skill';
export { createTeamService, type TeamService } from './team';
export { createUserService, type UserService } from './user';
