import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type BrandInsert = typeof brand.$inferInsert;
type BrandSelect = typeof brand.$inferSelect;

export function createBrandService(db: Database) {
  const crud = createCrudService<BrandInsert, BrandSelect>(db, brand);

  return {
    ...crud,

    async listByOrg(orgId: string): Promise<BrandSelect[]> {
      return db.select().from(brand).where(eq(brand.orgId, orgId));
    },
  };
}

export type BrandService = ReturnType<typeof createBrandService>;
