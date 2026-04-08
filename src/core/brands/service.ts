import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { brand } from '@/core/db/schema';
import type { BrandFilter, CreateBrandInput, UpdateBrandInput } from './types';

export async function createBrand(input: CreateBrandInput) {
  const [created] = await db
    .insert(brand)
    .values({
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      name: input.name,
      colors: input.colors ?? null,
      fonts: input.fonts ?? null,
      toneOfVoice: input.toneOfVoice ?? null,
      styleGuide: input.styleGuide ?? null,
      logoUrl: input.logoUrl ?? null,
    })
    .returning();

  return created;
}

export async function getBrand(id: string) {
  const result = await db.query.brand.findFirst({
    where: eq(brand.id, id),
  });

  if (!result) {
    throw new Error(`Brand not found: ${id}`);
  }

  return result;
}

export async function listBrands(filters?: BrandFilter) {
  const conditions = [];

  if (filters?.orgId) {
    conditions.push(eq(brand.orgId, filters.orgId));
  }
  if (filters?.projectId) {
    conditions.push(eq(brand.projectId, filters.projectId));
  }

  return db
    .select()
    .from(brand)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(brand.name));
}

export async function updateBrand(id: string, updates: UpdateBrandInput) {
  const existing = await db.query.brand.findFirst({
    where: eq(brand.id, id),
  });

  if (!existing) {
    throw new Error(`Brand not found: ${id}`);
  }

  const [updated] = await db
    .update(brand)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(brand.id, id))
    .returning();

  return updated;
}

export async function deleteBrand(id: string) {
  const existing = await db.query.brand.findFirst({
    where: eq(brand.id, id),
  });

  if (!existing) {
    throw new Error(`Brand not found: ${id}`);
  }

  await db.delete(brand).where(eq(brand.id, id));

  return { deleted: true, id };
}
