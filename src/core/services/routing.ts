import { count, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { persona, routingProfile, routingRule } from '@/core/db/schema';
import { createCrudService, createVersionedCrudService } from './crud-factory';

type ProfileInsert = typeof routingProfile.$inferInsert;
type ProfileSelect = typeof routingProfile.$inferSelect;
type RuleInsert = typeof routingRule.$inferInsert;
type RuleSelect = typeof routingRule.$inferSelect;

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function createRoutingService(db: DbOrTx) {
  const profileCrud = createVersionedCrudService<ProfileInsert, ProfileSelect>(
    db as Database,
    routingProfile
  );
  const ruleCrud = createCrudService<RuleInsert, RuleSelect>(
    db as Database,
    routingRule
  );

  return {
    ...profileCrud,

    async listByOrg(orgId: string): Promise<ProfileSelect[]> {
      return db
        .select()
        .from(routingProfile)
        .where(eq(routingProfile.orgId, orgId));
    },

    /**
     * Count references to this routing profile across all FK-holding tables.
     * Used to produce meaningful delete-failure messages.
     */
    async countReferences(id: string): Promise<{ personas: number }> {
      const [p] = await db
        .select({ c: count() })
        .from(persona)
        .where(eq(persona.routingProfileId, id));
      return { personas: Number(p?.c ?? 0) };
    },

    rules: {
      ...ruleCrud,

      async listByProfile(profileId: string): Promise<RuleSelect[]> {
        return db
          .select()
          .from(routingRule)
          .where(eq(routingRule.profileId, profileId));
      },
    },
  };
}

export type RoutingService = ReturnType<typeof createRoutingService>;
