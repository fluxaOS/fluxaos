/**
 * Service factories barrel export.
 *
 * All services receive Database via DI. No singleton imports.
 * Usage: const svc = createIssueService(db);
 */
export { createOrganizationService, type OrganizationService } from './organization';
export { createProjectService, type ProjectService } from './project';
export { createIssueService, type IssueService } from './issue';
export { createSkillService, type SkillService } from './skill';
export { createPersonaService, type PersonaService } from './persona';
export { createPipelineService, type PipelineService } from './pipeline';
export { createProviderService, type ProviderService } from './provider';
export { createRoutingService, type RoutingService } from './routing';
export { createUserService, type UserService } from './user';
export { createIssueCatalogService, type IssueCatalogService } from './issue-catalog';
export { createIssueCommentService, type IssueCommentService } from './issue-comment';
export { createIssueEventService, type IssueEventService } from './issue-event';
export { createGateService, type GateService } from '@/core/gates/service';
