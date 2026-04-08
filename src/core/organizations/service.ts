import { asc, eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { organization } from '@/core/db/schema';
import type { CreateOrganizationInput, UpdateOrganizationInput } from './types';

export async function createOrganization(input: CreateOrganizationInput) {
  const [created] = await db
    .insert(organization)
    .values({
      name: input.name,
      slug: input.slug,
      settings: input.settings ?? null,
    })
    .returning();

  return created;
}

export async function getOrganization(id: string) {
  const result = await db.query.organization.findFirst({
    where: eq(organization.id, id),
  });

  if (!result) {
    throw new Error(`Organization not found: ${id}`);
  }

  return result;
}

export async function listOrganizations() {
  return db.select().from(organization).orderBy(asc(organization.name));
}

export async function updateOrganization(
  id: string,
  updates: UpdateOrganizationInput
) {
  const [updated] = await db
    .update(organization)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(organization.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Organization not found: ${id}`);
  }

  return updated;
}
