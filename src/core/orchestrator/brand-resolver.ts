import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand } from '@/core/db/schema';

type BrandSelect = typeof brand.$inferSelect;

async function findBrand(
  db: Database,
  brandId: string | null | undefined
): Promise<BrandSelect | null> {
  if (!brandId) return null;
  const [row] = await db.select().from(brand).where(eq(brand.id, brandId));
  return row ?? null;
}

export async function resolveStageBrand(
  db: Database,
  input: {
    personaBrandId: string | null | undefined;
    projectBrandId: string | null | undefined;
  }
): Promise<BrandSelect | null> {
  const personaBrand = await findBrand(db, input.personaBrandId);
  if (personaBrand) return personaBrand;
  return findBrand(db, input.projectBrandId);
}
