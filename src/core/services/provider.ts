import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { provider, model } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type ProviderInsert = typeof provider.$inferInsert;
type ProviderSelect = typeof provider.$inferSelect;
type ModelInsert = typeof model.$inferInsert;
type ModelSelect = typeof model.$inferSelect;

export function createProviderService(db: Database) {
  const providerCrud = createCrudService<ProviderInsert, ProviderSelect>(db, provider);
  const modelCrud = createCrudService<ModelInsert, ModelSelect>(db, model);

  return {
    ...providerCrud,

    async listByOrg(orgId: string): Promise<ProviderSelect[]> {
      return db.select().from(provider).where(eq(provider.orgId, orgId));
    },

    models: {
      ...modelCrud,

      async listByProvider(providerId: string): Promise<ModelSelect[]> {
        return db.select().from(model).where(eq(model.providerId, providerId));
      },
    },
  };
}

export type ProviderService = ReturnType<typeof createProviderService>;
