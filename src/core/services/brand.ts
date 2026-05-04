import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand } from '@/core/db/schema';
import { createVersionedCrudService } from './crud-factory';

type BrandInsert = typeof brand.$inferInsert;
type BrandSelect = typeof brand.$inferSelect;

export function createBrandService(db: Database) {
  const crud = createVersionedCrudService<BrandInsert, BrandSelect>(db, brand);

  return {
    ...crud,

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
