/**
 * Integration tests: CRUD services against real Supabase Postgres.
 *
 * These are NOT mocks. Every test hits the real database.
 * Cleanup runs after each test to prevent data pollution.
 */
import 'dotenv/config';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  createOrganizationService,
  createProjectService,
  createIssueService,
  createSkillService,
  createPersonaService,
  createPipelineService,
} from '@/core/services';
import type { Database } from '@/core/db/connection';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

// Track IDs for cleanup
const cleanup: { table: string; id: string }[] = [];

afterAll(async () => {
  // Clean up in reverse order (child records first)
  const { eq } = await import('drizzle-orm');
  const schema = await import('@/core/db/schema');

  const tableMap: Record<string, any> = {
    pipelineStage: schema.pipelineStage,
    pipeline: schema.pipeline,
    issueEvent: schema.issueEvent,
    issue: schema.issue,
    skill: schema.skill,
    persona: schema.persona,
    project: schema.project,
    organization: schema.organization,
  };

  for (const { table, id } of cleanup.reverse()) {
    const t = tableMap[table];
    if (t) {
      await db.delete(t).where(eq(t.id, id)).catch(() => {});
    }
  }
});

describe('organization service', () => {
  it('creates and reads back an organization', async () => {
    const svc = createOrganizationService(db);
    const slug = `test-org-${Date.now()}`;
    const org = await svc.create({ name: 'Test Org', slug, settings: {} });
    cleanup.push({ table: 'organization', id: org.id });

    expect(org.name).toBe('Test Org');
    expect(org.slug).toBe(slug);

    const found = await svc.getById(org.id);
    expect(found?.id).toBe(org.id);

    const bySlug = await svc.getBySlug(slug);
    expect(bySlug?.id).toBe(org.id);
  });
});

describe('project service', () => {
  it('creates a project under an org', async () => {
    const orgSvc = createOrganizationService(db);
    const projSvc = createProjectService(db);

    const org = await orgSvc.create({ name: 'Proj Test Org', slug: `pto-${Date.now()}`, settings: {} });
    cleanup.push({ table: 'organization', id: org.id });

    const proj = await projSvc.create({ orgId: org.id, name: 'Test Project', slug: 'test-proj' });
    cleanup.push({ table: 'project', id: proj.id });

    expect(proj.orgId).toBe(org.id);
    expect(proj.name).toBe('Test Project');

    const list = await projSvc.listByOrg(org.id);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some(p => p.id === proj.id)).toBe(true);
  });
});

describe('issue service', () => {
  it('creates, transitions, comments on an issue', async () => {
    const orgSvc = createOrganizationService(db);
    const projSvc = createProjectService(db);
    const issueSvc = createIssueService(db);

    const org = await orgSvc.create({ name: 'Issue Test Org', slug: `ito-${Date.now()}`, settings: {} });
    cleanup.push({ table: 'organization', id: org.id });

    const proj = await projSvc.create({ orgId: org.id, name: 'Issue Proj', slug: 'issue-proj' });
    cleanup.push({ table: 'project', id: proj.id });

    // Create
    const issue = await issueSvc.create({
      projectId: proj.id,
      title: 'Test Issue',
      description: 'Integration test issue',
      priority: 'high',
      type: 'bug',
    });
    cleanup.push({ table: 'issue', id: issue.id });
    expect(issue.state).toBe('open');

    // Transition
    const transitioned = await issueSvc.transition(issue.id, 'in_progress');
    expect(transitioned?.state).toBe('in_progress');

    // Invalid transition should throw (in_progress → closed → in_progress is not allowed)
    await issueSvc.transition(issue.id, 'closed');
    await expect(issueSvc.transition(issue.id, 'in_progress')).rejects.toThrow('Invalid transition');
    // Reopen for the rest of the test
    await issueSvc.transition(issue.id, 'open');

    // Add comment
    const comment = await issueSvc.addComment(issue.id, { text: 'Test comment', author: 'test' });
    cleanup.push({ table: 'issueEvent', id: comment.id });
    expect(comment.type).toBe('comment');

    // List events
    const events = await issueSvc.listEvents(issue.id);
    expect(events.length).toBe(1);

    // Update comment
    const updated = await issueSvc.updateComment(comment.id, { text: 'Updated comment' });
    expect((updated?.payload as any).text).toBe('Updated comment');

    // Delete comment
    await issueSvc.deleteComment(comment.id);
    const eventsAfter = await issueSvc.listEvents(issue.id);
    expect(eventsAfter.length).toBe(0);
    // Remove from cleanup since we already deleted it
    cleanup.pop();
  });
});

describe('skill service', () => {
  it('creates and lists skills', async () => {
    const orgSvc = createOrganizationService(db);
    const projSvc = createProjectService(db);
    const skillSvc = createSkillService(db);

    const org = await orgSvc.create({ name: 'Skill Test Org', slug: `sto-${Date.now()}`, settings: {} });
    cleanup.push({ table: 'organization', id: org.id });

    const proj = await projSvc.create({ orgId: org.id, name: 'Skill Proj', slug: 'skill-proj' });
    cleanup.push({ table: 'project', id: proj.id });

    const skill = await skillSvc.create({
      scope: 'project',
      projectId: proj.id,
      name: 'Test Skill',
      description: 'A test skill',
      promptTemplate: 'Do the thing: {{input}}',
    });
    cleanup.push({ table: 'skill', id: skill.id });

    expect(skill.name).toBe('Test Skill');
    expect(skill.version).toBe(1);

    const list = await skillSvc.listByProject(proj.id);
    expect(list.some(s => s.id === skill.id)).toBe(true);
  });
});

describe('persona service', () => {
  it('creates and lists personas', async () => {
    const orgSvc = createOrganizationService(db);
    const projSvc = createProjectService(db);
    const personaSvc = createPersonaService(db);

    const org = await orgSvc.create({ name: 'Persona Test Org', slug: `pers-${Date.now()}`, settings: {} });
    cleanup.push({ table: 'organization', id: org.id });

    const proj = await projSvc.create({ orgId: org.id, name: 'Persona Proj', slug: 'persona-proj' });
    cleanup.push({ table: 'project', id: proj.id });

    const persona = await personaSvc.create({
      scope: 'project',
      projectId: proj.id,
      name: 'Researcher',
      soul: 'You are a thorough researcher who finds answers.',
    });
    cleanup.push({ table: 'persona', id: persona.id });

    expect(persona.name).toBe('Researcher');
    expect(persona.soul).toBe('You are a thorough researcher who finds answers.');

    const list = await personaSvc.listByProject(proj.id);
    expect(list.some(p => p.id === persona.id)).toBe(true);
  });
});

describe('pipeline service', () => {
  it('creates pipeline with stages', async () => {
    const orgSvc = createOrganizationService(db);
    const projSvc = createProjectService(db);
    const pipeSvc = createPipelineService(db);

    const org = await orgSvc.create({ name: 'Pipe Test Org', slug: `pipe-${Date.now()}`, settings: {} });
    cleanup.push({ table: 'organization', id: org.id });

    const proj = await projSvc.create({ orgId: org.id, name: 'Pipe Proj', slug: 'pipe-proj' });
    cleanup.push({ table: 'project', id: proj.id });

    const pipeline = await pipeSvc.create({
      projectId: proj.id,
      name: 'Test Pipeline',
      description: 'Integration test pipeline',
      isDefault: true,
    });
    cleanup.push({ table: 'pipeline', id: pipeline.id });

    const stage = await pipeSvc.stages.create({
      pipelineId: pipeline.id,
      name: 'research',
      sortOrder: 1,
      gateMode: 'auto',
      harness: 'claude-code',
      timeoutSec: 300,
      maxRetries: 1,
    });
    cleanup.push({ table: 'pipelineStage', id: stage.id });

    const stages = await pipeSvc.stages.listByPipeline(pipeline.id);
    expect(stages.length).toBe(1);
    expect(stages[0].name).toBe('research');
  });
});
