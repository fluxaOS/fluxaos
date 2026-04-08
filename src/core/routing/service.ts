import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '@/core/db';
import { routingProfile, routingRule } from '@/core/db/schema';
import type {
  CreateRoutingProfileInput,
  CreateRoutingRuleInput,
  UpdateRoutingProfileInput,
  UpdateRoutingRuleInput,
} from './types';

export async function createRoutingProfile(input: CreateRoutingProfileInput) {
  // If setting as default, unset other defaults for the same org
  if (input.isDefault) {
    await db
      .update(routingProfile)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(routingProfile.orgId, input.orgId),
          eq(routingProfile.isDefault, true)
        )
      );
  }

  const [created] = await db
    .insert(routingProfile)
    .values({
      orgId: input.orgId,
      name: input.name,
      description: input.description ?? null,
      isDefault: input.isDefault ?? false,
    })
    .returning();

  return created;
}

export async function getRoutingProfile(id: string) {
  const result = await db.query.routingProfile.findFirst({
    where: eq(routingProfile.id, id),
    with: { rules: true },
  });

  if (!result) {
    throw new Error(`Routing profile not found: ${id}`);
  }

  return result;
}

export async function listRoutingProfiles(orgId: string) {
  return db
    .select()
    .from(routingProfile)
    .where(eq(routingProfile.orgId, orgId))
    .orderBy(asc(routingProfile.name));
}

export async function updateRoutingProfile(
  id: string,
  updates: UpdateRoutingProfileInput
) {
  const existing = await db.query.routingProfile.findFirst({
    where: eq(routingProfile.id, id),
  });

  if (!existing) {
    throw new Error(`Routing profile not found: ${id}`);
  }

  // If setting as default, unset other defaults for the same org
  if (updates.isDefault) {
    await db
      .update(routingProfile)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(routingProfile.orgId, existing.orgId),
          eq(routingProfile.isDefault, true),
          ne(routingProfile.id, id)
        )
      );
  }

  const [updated] = await db
    .update(routingProfile)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(routingProfile.id, id))
    .returning();

  return updated;
}

export async function deleteRoutingProfile(id: string) {
  const existing = await db.query.routingProfile.findFirst({
    where: eq(routingProfile.id, id),
  });

  if (!existing) {
    throw new Error(`Routing profile not found: ${id}`);
  }

  // Cascade delete rules
  await db.delete(routingRule).where(eq(routingRule.profileId, id));
  await db.delete(routingProfile).where(eq(routingProfile.id, id));

  return { deleted: true, id };
}

export async function createRoutingRule(input: CreateRoutingRuleInput) {
  const [created] = await db
    .insert(routingRule)
    .values({
      profileId: input.profileId,
      stageName: input.stageName ?? null,
      allowedModelsPattern: input.allowedModelsPattern ?? null,
      preferredHarness: input.preferredHarness ?? null,
      fallbackHarness: input.fallbackHarness ?? null,
      sortStrategy: input.sortStrategy ?? 'quality',
      maxCostUsd: input.maxCostUsd ?? null,
    })
    .returning();

  return created;
}

export async function updateRoutingRule(
  id: string,
  updates: UpdateRoutingRuleInput
) {
  const existing = await db.query.routingRule.findFirst({
    where: eq(routingRule.id, id),
  });

  if (!existing) {
    throw new Error(`Routing rule not found: ${id}`);
  }

  const [updated] = await db
    .update(routingRule)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(routingRule.id, id))
    .returning();

  return updated;
}

export async function deleteRoutingRule(id: string) {
  const existing = await db.query.routingRule.findFirst({
    where: eq(routingRule.id, id),
  });

  if (!existing) {
    throw new Error(`Routing rule not found: ${id}`);
  }

  await db.delete(routingRule).where(eq(routingRule.id, id));

  return { deleted: true, id };
}

export async function listRoutingRules(profileId: string) {
  return db
    .select()
    .from(routingRule)
    .where(eq(routingRule.profileId, profileId))
    .orderBy(asc(routingRule.stageName));
}
