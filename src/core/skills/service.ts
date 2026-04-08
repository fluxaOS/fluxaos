import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { skill } from '@/core/db/schema';
import type { CreateSkillInput, SkillFilter, UpdateSkillInput } from './types';

export async function createSkill(input: CreateSkillInput) {
  const [created] = await db
    .insert(skill)
    .values({
      name: input.name,
      description: input.description ?? null,
      promptTemplate: input.promptTemplate ?? null,
      inputSchema: input.inputSchema ?? null,
      outputSchema: input.outputSchema ?? null,
      tags: input.tags ?? null,
      scope: input.scope ?? 'project',
      projectId: input.projectId ?? null,
    })
    .returning();

  return created;
}

export async function getSkill(id: string) {
  const result = await db.query.skill.findFirst({
    where: eq(skill.id, id),
  });

  if (!result) {
    throw new Error(`Skill not found: ${id}`);
  }

  return result;
}

export async function listSkills(filters?: SkillFilter) {
  const conditions = [];

  if (filters?.projectId) {
    conditions.push(eq(skill.projectId, filters.projectId));
  }
  if (filters?.scope) {
    conditions.push(eq(skill.scope, filters.scope));
  }

  return db
    .select()
    .from(skill)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(skill.name));
}

export async function updateSkill(id: string, updates: UpdateSkillInput) {
  const existing = await db.query.skill.findFirst({
    where: eq(skill.id, id),
  });

  if (!existing) {
    throw new Error(`Skill not found: ${id}`);
  }

  const [updated] = await db
    .update(skill)
    .set({
      ...updates,
      version: (existing.version ?? 1) + 1,
      updatedAt: new Date(),
    })
    .returning();

  return updated;
}

export async function deleteSkill(id: string) {
  const existing = await db.query.skill.findFirst({
    where: eq(skill.id, id),
  });

  if (!existing) {
    throw new Error(`Skill not found: ${id}`);
  }

  await db.delete(skill).where(eq(skill.id, id));

  return { deleted: true, id };
}
