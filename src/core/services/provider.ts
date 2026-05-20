import { count, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { model, provider } from '@/core/db/schema';
import { createCrudService, createVersionedCrudService } from './crud-factory';
import {
  resolveScoped,
  resolveScopedAll,
  type ScopeContext,
} from './resolve-scoped';

type ProviderInsert = typeof provider.$inferInsert;
type ProviderSelect = typeof provider.$inferSelect;
type ModelInsert = typeof model.$inferInsert;
type ModelSelect = typeof model.$inferSelect;

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function createProviderService(db: DbOrTx) {
  const providerCrud = createVersionedCrudService<
    ProviderInsert,
    ProviderSelect
  >(db as Database, provider);
  const modelCrud = createCrudService<ModelInsert, ModelSelect>(
    db as Database,
    model
  );

  return {
    ...providerCrud,

    async listByOrg(orgId: string): Promise<ProviderSelect[]> {
      return db.select().from(provider).where(eq(provider.orgId, orgId));
    },

    async listEffective(scope: ScopeContext): Promise<ProviderSelect[]> {
      return resolveScopedAll<ProviderSelect>(
        db as Database,
        provider,
        scope,
        'name'
      );
    },

    async resolveEffectiveById(
      id: string,
      scope: ScopeContext
    ): Promise<ProviderSelect | null> {
      const base = await providerCrud.getById(id);
      if (!base) return null;
      return resolveScoped<ProviderSelect>(
        db as Database,
        provider,
        scope,
        eq(provider.name, base.name)
      );
    },

    async countReferences(id: string): Promise<{ models: number }> {
      const [m] = await db
        .select({ c: count() })
        .from(model)
        .where(eq(model.providerId, id));
      return { models: Number(m?.c ?? 0) };
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
