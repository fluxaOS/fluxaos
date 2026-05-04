import { and, count, desc, eq, isNull, or } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand, persona } from '@/core/db/schema';
import { createVersionedCrudService } from './crud-factory';

type BrandInsert = typeof brand.$inferInsert;
type BrandSelect = typeof brand.$inferSelect;

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function createBrandService(db: DbOrTx) {
  const crud = createVersionedCrudService<BrandInsert, BrandSelect>(
    db as Database,
    brand
  );

  return {
    ...crud,

    async countReferences(id: string): Promise<{ personas: number }> {
      const [p] = await db
        .select({ c: count() })
        .from(persona)
        .where(eq(persona.brandId, id));
      return { personas: Number(p?.c ?? 0) };
    },

    async listByOrg(orgId: string): Promise<BrandSelect[]> {
      return db
        .select()
        .from(brand)
        .where(eq(brand.orgId, orgId))
        .orderBy(desc(brand.createdAt));
    },

    async listByProject(projectId: string): Promise<BrandSelect[]> {
      return db
        .select()
        .from(brand)
        .where(eq(brand.projectId, projectId))
        .orderBy(desc(brand.createdAt));
    },

    async listVisibleToProject(
      orgId: string,
      projectId: string
    ): Promise<BrandSelect[]> {
      return db
        .select()
        .from(brand)
        .where(
          and(
            eq(brand.orgId, orgId),
            or(isNull(brand.projectId), eq(brand.projectId, projectId))
          )
        )
        .orderBy(desc(brand.createdAt));
    },
  };
}

export type BrandService = ReturnType<typeof createBrandService>;
