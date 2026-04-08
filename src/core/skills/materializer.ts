import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { skill } from '@/core/db/schema';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildSkillFile(row: {
  id: string;
  name: string;
  version: number | null;
  scope: string;
  tags: unknown;
  description: string | null;
  promptTemplate: string | null;
}): string {
  const tagsArray = Array.isArray(row.tags) ? row.tags : [];
  const lines = [
    '---',
    `id: ${row.id}`,
    `name: ${row.name}`,
    `version: ${row.version ?? 1}`,
    `scope: ${row.scope}`,
    `tags: [${tagsArray.join(', ')}]`,
    '---',
    '',
  ];

  if (row.description) {
    lines.push(row.description, '');
  }

  if (row.promptTemplate) {
    lines.push(row.promptTemplate, '');
  }

  return lines.join('\n');
}

export async function materializeSkills(
  projectId: string,
  targetDir: string
): Promise<{ written: number; cleaned: number }> {
  await mkdir(targetDir, { recursive: true });

  const skills = await db
    .select()
    .from(skill)
    .where(eq(skill.projectId, projectId));

  const writtenFiles = new Set<string>();

  for (const row of skills) {
    const filename = `${slugify(row.name)}.md`;
    const filepath = join(targetDir, filename);
    await writeFile(filepath, buildSkillFile(row), 'utf-8');
    writtenFiles.add(filename);
  }

  // Clean stale files
  let cleaned = 0;
  const existing = await readdir(targetDir);
  for (const file of existing) {
    if (file.endsWith('.md') && !writtenFiles.has(file)) {
      await unlink(join(targetDir, file));
      cleaned++;
    }
  }

  return { written: skills.length, cleaned };
}
