import { asc, eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { project } from '@/core/db/schema';
import type { CreateProjectInput, UpdateProjectInput } from './types';

export async function createProject(input: CreateProjectInput) {
  const [created] = await db
    .insert(project)
    .values({
      orgId: input.orgId,
      name: input.name,
      slug: input.slug,
      repoUrl: input.repoUrl ?? null,
    })
    .returning();

  return created;
}

export async function getProject(id: string) {
  const result = await db.query.project.findFirst({
    where: eq(project.id, id),
  });

  if (!result) {
    throw new Error(`Project not found: ${id}`);
  }

  return result;
}

export async function listProjects(orgId: string) {
  return db
    .select()
    .from(project)
    .where(eq(project.orgId, orgId))
    .orderBy(asc(project.name));
}

export async function updateProject(id: string, updates: UpdateProjectInput) {
  const [updated] = await db
    .update(project)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(project.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Project not found: ${id}`);
  }

  return updated;
}
