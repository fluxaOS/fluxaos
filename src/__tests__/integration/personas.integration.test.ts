import { afterAll, describe, expect, it } from 'vitest';
import {
  attachSkill,
  createPersona,
  detachSkill,
  getPersona,
  listPersonaSkills,
  listPersonas,
  updatePersona,
} from '@/core/personas';
import { createSkill } from '@/core/skills';
import { cleanup, SEED_PROJECT_ID } from './setup';

const personaIds: string[] = [];
const skillIds: string[] = [];

afterAll(async () => {
  await cleanup({ personaIds, skillIds });
});

describe('personas integration', () => {
  let parentId: string;
  let childId: string;
  let skillId: string;

  it('creates a global parent persona', async () => {
    const parent = await createPersona({
      name: 'Global Researcher',
      scope: 'global',
      soul: 'You are a thorough researcher who values accuracy.',
      identity: { style: 'academic', depth: 'deep' },
    });

    expect(parent.id).toBeDefined();
    expect(parent.name).toBe('Global Researcher');
    expect(parent.scope).toBe('global');
    parentId = parent.id;
    personaIds.push(parent.id);
  });

  it('creates a child persona inheriting from parent', async () => {
    const child = await createPersona({
      name: 'Project Researcher',
      scope: 'project',
      projectId: SEED_PROJECT_ID,
      parentPersonaId: parentId,
      identity: { style: 'practical', framework: 'react' },
    });

    expect(child.id).toBeDefined();
    expect(child.parentPersonaId).toBe(parentId);
    childId = child.id;
    // Insert child before parent so cleanup deletes child first
    personaIds.unshift(child.id);
  });

  it('resolves inheritance — merges parent + child', async () => {
    const resolved = await getPersona(childId, true);

    // Soul comes from parent (child has none)
    expect(resolved.soul).toBe(
      'You are a thorough researcher who values accuracy.'
    );

    // Identity merges: child overrides parent's 'style', adds 'framework', keeps parent's 'depth'
    expect(resolved.identity).toBeDefined();
    const identity = resolved.identity as Record<string, unknown>;
    expect(identity.style).toBe('practical'); // child wins
    expect(identity.depth).toBe('deep'); // from parent
    expect(identity.framework).toBe('react'); // child-only
  });

  it('lists personas filtered by scope', async () => {
    const globals = await listPersonas({ scope: 'global' });
    expect(globals.some((p) => p.id === parentId)).toBe(true);
    expect(globals.some((p) => p.id === childId)).toBe(false);

    const projectPersonas = await listPersonas({
      projectId: SEED_PROJECT_ID,
    });
    expect(projectPersonas.some((p) => p.id === childId)).toBe(true);
  });

  it('updates a persona', async () => {
    const updated = await updatePersona(childId, {
      soul: 'You are a fast, practical researcher.',
    });
    expect(updated.soul).toBe('You are a fast, practical researcher.');
  });

  it('resolved persona now uses child soul after update', async () => {
    const resolved = await getPersona(childId, true);
    expect(resolved.soul).toBe('You are a fast, practical researcher.');
  });

  it('attaches a skill to a persona', async () => {
    const skill = await createSkill({
      name: 'Integration Persona Skill',
      projectId: SEED_PROJECT_ID,
    });
    skillId = skill.id;
    skillIds.push(skill.id);

    const binding = await attachSkill(childId, skillId, {
      temperature: 0.7,
    });
    expect(binding.personaId).toBe(childId);
    expect(binding.skillId).toBe(skillId);
    expect(binding.enabled).toBe(true);
  });

  it('lists persona skills', async () => {
    const skills = await listPersonaSkills(childId);
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills.some((s) => s.skillId === skillId)).toBe(true);
  });

  it('resolved persona includes attached skills', async () => {
    const resolved = await getPersona(childId, true);
    expect(resolved.skills.length).toBeGreaterThanOrEqual(1);
    expect(resolved.skills.some((s) => s.skillId === skillId)).toBe(true);
  });

  it('detaches a skill from a persona', async () => {
    const result = await detachSkill(childId, skillId);
    expect(result.detached).toBe(true);

    const skills = await listPersonaSkills(childId);
    expect(skills.some((s) => s.skillId === skillId)).toBe(false);
  });
});
