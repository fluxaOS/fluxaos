import { and, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { project } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type ProjectInsert = typeof project.$inferInsert;
type ProjectSelect = typeof project.$inferSelect;

export function createProjectService(db: Database) {
  const crud = createCrudService<ProjectInsert, ProjectSelect>(db, project);

  return {
    ...crud,

    async listByOrg(orgId: string): Promise<ProjectSelect[]> {
      return db.select().from(project).where(eq(project.orgId, orgId));
    },

    async listByUser(userId: string): Promise<ProjectSelect[]> {
      return db.select().from(project).where(eq(project.userId, userId));
    },

    async getBySlug(
      orgId: string,
      slug: string
    ): Promise<ProjectSelect | null> {
      const [row] = await db
        .select()
        .from(project)
        .where(and(eq(project.orgId, orgId), eq(project.slug, slug)));
      return row ?? null;
    },

    async getFirstBySlug(slug: string): Promise<ProjectSelect | null> {
      const [row] = await db
        .select()
        .from(project)
        .where(eq(project.slug, slug))
        .limit(1);
      return row ?? null;
    },

    async getByUserSlug(
      userId: string,
      slug: string
    ): Promise<ProjectSelect | null> {
      const [row] = await db
        .select()
        .from(project)
        .where(and(eq(project.userId, userId), eq(project.slug, slug)));
      return row ?? null;
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
