import { asc, eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { model, provider } from '@/core/db/schema';
import type {
  CreateModelInput,
  CreateProviderInput,
  UpdateModelInput,
  UpdateProviderInput,
} from './types';

export async function createProvider(input: CreateProviderInput) {
  const [created] = await db
    .insert(provider)
    .values({
      orgId: input.orgId,
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl ?? null,
      apiKeyRef: input.apiKeyRef ?? null,
    })
    .returning();

  return created;
}

export async function getProvider(id: string) {
  const result = await db.query.provider.findFirst({
    where: eq(provider.id, id),
    with: { models: true },
  });

  if (!result) {
    throw new Error(`Provider not found: ${id}`);
  }

  return result;
}

export async function listProviders(orgId: string) {
  return db
    .select()
    .from(provider)
    .where(eq(provider.orgId, orgId))
    .orderBy(asc(provider.name));
}

export async function updateProvider(id: string, updates: UpdateProviderInput) {
  const existing = await db.query.provider.findFirst({
    where: eq(provider.id, id),
  });

  if (!existing) {
    throw new Error(`Provider not found: ${id}`);
  }

  const [updated] = await db
    .update(provider)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(provider.id, id))
    .returning();

  return updated;
}

export async function deleteProvider(id: string) {
  const existing = await db.query.provider.findFirst({
    where: eq(provider.id, id),
  });

  if (!existing) {
    throw new Error(`Provider not found: ${id}`);
  }

  // Cascade delete models
  await db.delete(model).where(eq(model.providerId, id));
  await db.delete(provider).where(eq(provider.id, id));

  return { deleted: true, id };
}

export async function createModel(input: CreateModelInput) {
  const [created] = await db
    .insert(model)
    .values({
      providerId: input.providerId,
      name: input.name,
      identifier: input.identifier,
      capabilities: input.capabilities ?? null,
      costPer1kInput: input.costPer1kInput ?? null,
      costPer1kOutput: input.costPer1kOutput ?? null,
    })
    .returning();

  return created;
}

export async function getModel(id: string) {
  const result = await db.query.model.findFirst({
    where: eq(model.id, id),
  });

  if (!result) {
    throw new Error(`Model not found: ${id}`);
  }

  return result;
}

export async function listModels(providerId: string) {
  return db
    .select()
    .from(model)
    .where(eq(model.providerId, providerId))
    .orderBy(asc(model.name));
}

export async function updateModel(id: string, updates: UpdateModelInput) {
  const existing = await db.query.model.findFirst({
    where: eq(model.id, id),
  });

  if (!existing) {
    throw new Error(`Model not found: ${id}`);
  }

  const [updated] = await db
    .update(model)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(model.id, id))
    .returning();

  return updated;
}

export async function deleteModel(id: string) {
  const existing = await db.query.model.findFirst({
    where: eq(model.id, id),
  });

  if (!existing) {
    throw new Error(`Model not found: ${id}`);
  }

  await db.delete(model).where(eq(model.id, id));

  return { deleted: true, id };
}
