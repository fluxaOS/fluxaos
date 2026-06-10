import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { organization, user } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type OrgInsert = typeof organization.$inferInsert;
type OrgSelect = typeof organization.$inferSelect;

export function createOrganizationService(db: Database) {
  const crud = createCrudService<OrgInsert, OrgSelect>(db, organization);

  return {
    ...crud,

    /**
     * Return the single org the given user belongs to.
     * This is the scoped replacement for the banned unscoped `list()`.
     */
    async listByUserId(userId: string): Promise<OrgSelect[]> {
      const rows = await db
        .select({ org: organization })
        .from(user)
        .innerJoin(organization, eq(user.orgId, organization.id))
        .where(eq(user.id, userId));
      return rows.map((r) => r.org);
    },

    /**
     * Return all orgs (LAN-bypass / admin-only path).
     * Only used when the viewer has no associated user row (homelab bypass).
     */
    async listAll(): Promise<OrgSelect[]> {
      return db.select().from(organization);
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
