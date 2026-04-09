import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { organization } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type OrgInsert = typeof organization.$inferInsert;
type OrgSelect = typeof organization.$inferSelect;

export function createOrganizationService(db: Database) {
  const crud = createCrudService<OrgInsert, OrgSelect>(db, organization);

  return {
    ...crud,

    async getBySlug(slug: string): Promise<OrgSelect | null> {
      const [row] = await db
        .select()
        .from(organization)
        .where(eq(organization.slug, slug));
      return row ?? null;
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
