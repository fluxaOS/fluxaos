import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { routingProfile, routingRule } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type ProfileInsert = typeof routingProfile.$inferInsert;
type ProfileSelect = typeof routingProfile.$inferSelect;
type RuleInsert = typeof routingRule.$inferInsert;
type RuleSelect = typeof routingRule.$inferSelect;

export function createRoutingService(db: Database) {
  const profileCrud = createCrudService<ProfileInsert, ProfileSelect>(
    db,
    routingProfile
  );
  const ruleCrud = createCrudService<RuleInsert, RuleSelect>(db, routingRule);

  return {
    ...profileCrud,

    async listByOrg(orgId: string): Promise<ProfileSelect[]> {
      return db
        .select()
        .from(routingProfile)
        .where(eq(routingProfile.orgId, orgId));
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
