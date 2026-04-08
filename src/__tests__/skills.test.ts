import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database module before importing service functions
vi.mock('@/core/db', () => {
  const rows: Record<string, unknown>[] = [];
  return {
    db: {
      insert: () => ({
        values: (val: Record<string, unknown>) => ({
          returning: () => {
            const row = {
              id: crypto.randomUUID(),
              version: 1,
              scope: 'project',
              tags: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...val,
            };
            rows.push(row);
            return [row];
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => rows.filter(() => true),
          orderBy: () => rows.filter(() => true),
        }),
      }),
      update: () => ({
        set: (updates: Record<string, unknown>) => ({
          where: () => ({
            returning: () => {
              if (rows.length === 0) return [];
              const row = { ...rows[0], ...updates };
              rows[0] = row;
              return [row];
            },
          }),
        }),
      }),
      delete: () => ({
        where: () => {
          rows.length = 0;
        },
      }),
      query: {
        skill: {
          findFirst: (_opts: { where: unknown }) => {
            return rows.length > 0 ? rows[0] : null;
          },
        },
      },
      __rows: rows,
    },
  };
});

describe('skill types', () => {
  it('CreateSkillInput accepts required and optional fields', () => {
    const input: import('@/core/skills/types').CreateSkillInput = {
      name: 'test-skill',
    };
    expect(input.name).toBe('test-skill');
    expect(input.description).toBeUndefined();
    expect(input.scope).toBeUndefined();
  });
});

describe('skill materializer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fluxaos-skills-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes skill files with frontmatter and prompt template', async () => {
    // Import the buildSkillFile helper indirectly through materializeSkills
    // Instead, test the file format by writing manually and checking structure
    const { materializeSkills } = await import('@/core/skills/materializer');

    // The mock db will return whatever rows exist
    // We need to set up mock data via the db mock
    const { db } = await import('@/core/db');
    const mockRows = (db as unknown as { __rows: unknown[] }).__rows;
    mockRows.length = 0;
    mockRows.push({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Code Review',
      version: 2,
      scope: 'project',
      tags: ['review', 'quality'],
      description: 'Reviews code for quality issues.',
      promptTemplate: 'Review the following code:\n\n{{code}}',
      projectId: 'proj-1',
    });

    // Override the select chain for materializer
    vi.spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: () => [...mockRows],
      }),
    } as never);

    const result = await materializeSkills('proj-1', tempDir);

    expect(result.written).toBe(1);
    expect(result.cleaned).toBe(0);

    const files = await readdir(tempDir);
    expect(files).toContain('code-review.md');

    const content = await readFile(join(tempDir, 'code-review.md'), 'utf-8');
    expect(content).toContain('id: 00000000-0000-0000-0000-000000000001');
    expect(content).toContain('name: Code Review');
    expect(content).toContain('version: 2');
    expect(content).toContain('tags: [review, quality]');
    expect(content).toContain('Reviews code for quality issues.');
    expect(content).toContain('Review the following code:');

    // Restore
    vi.mocked(db.select).mockRestore();
  });

  it('cleans stale files not matching current skills', async () => {
    // Write a stale file first
    await writeFile(join(tempDir, 'old-skill.md'), 'stale content');

    const { materializeSkills } = await import('@/core/skills/materializer');
    const { db } = await import('@/core/db');

    // Empty result set — no skills in DB
    vi.spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: () => [],
      }),
    } as never);

    const result = await materializeSkills('proj-1', tempDir);

    expect(result.written).toBe(0);
    expect(result.cleaned).toBe(1);

    const files = await readdir(tempDir);
    expect(files).not.toContain('old-skill.md');

    vi.mocked(db.select).mockRestore();
  });
});
