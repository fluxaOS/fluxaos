import type { Database } from '@/core/db/connection';
import type { brand } from '@/core/db/schema';
import { createBrandService } from '@/core/services';
import type { ScopeContext } from '@/core/services/resolve-scoped';

type BrandSelect = typeof brand.$inferSelect;

async function findBrand(
  db: Database,
  scope: ScopeContext,
  brandId: string | null | undefined
): Promise<BrandSelect | null> {
  if (!brandId) return null;
  return createBrandService(db).resolveEffectiveById(brandId, scope);
}

export async function resolveStageBrand(
  db: Database,
  scope: ScopeContext,
  input: {
    personaBrandId: string | null | undefined;
    projectBrandId: string | null | undefined;
  }
): Promise<BrandSelect | null> {
  const personaBrand = await findBrand(db, scope, input.personaBrandId);
  if (personaBrand) return personaBrand;
  return findBrand(db, scope, input.projectBrandId);
}
