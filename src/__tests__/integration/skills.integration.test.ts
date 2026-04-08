import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  materializeSkills,
  updateSkill,
} from '@/core/skills';
import { cleanup, SEED_PROJECT_ID } from './setup';

const skillIds: string[] = [];
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'fluxaos-int-skills-'));
});

afterAll(async () => {
  await cleanup({ skillIds });
  await rm(tempDir, { recursive: true, force: true });
});

describe('skills integration', () => {
  let createdId: string;

  it('creates a skill in the real database', async () => {
    const skill = await createSkill({
      name: 'Integration Test Skill',
      projectId: SEED_PROJECT_ID,
      description: 'A skill for testing',
      promptTemplate: 'Do the thing: {{input}}',
      tags: ['test', 'integration'],
    });

    expect(skill.id).toBeDefined();
    expect(skill.name).toBe('Integration Test Skill');
    expect(skill.version).toBe(1);
    createdId = skill.id;
    skillIds.push(skill.id);
  });

  it('retrieves the skill by id', async () => {
    const skill = await getSkill(createdId);
    expect(skill.id).toBe(createdId);
    expect(skill.description).toBe('A skill for testing');
  });

  it('lists skills for the project', async () => {
    const skills = await listSkills({ projectId: SEED_PROJECT_ID });
    const found = skills.find((s) => s.id === createdId);
    expect(found).toBeDefined();
  });

  it('updates the skill and increments version', async () => {
    const updated = await updateSkill(createdId, {
      description: 'Updated description',
    });
    expect(updated.description).toBe('Updated description');
    expect(updated.version).toBe(2);
  });

  it('materializes skills to disk', async () => {
    const result = await materializeSkills(SEED_PROJECT_ID, tempDir);
    expect(result.written).toBeGreaterThanOrEqual(1);

    const files = await readdir(tempDir);
    expect(files).toContain('integration-test-skill.md');
  });

  it('deletes the skill', async () => {
    const result = await deleteSkill(createdId);
    expect(result.deleted).toBe(true);
    // Remove from cleanup list since already deleted
    const idx = skillIds.indexOf(createdId);
    if (idx >= 0) skillIds.splice(idx, 1);

    await expect(getSkill(createdId)).rejects.toThrow('Skill not found');
  });
});
