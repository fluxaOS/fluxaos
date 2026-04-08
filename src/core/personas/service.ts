import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { persona, personaSkill, skill } from '@/core/db/schema';
import type {
  CreatePersonaInput,
  PersonaFilter,
  ResolvedPersona,
  UpdatePersonaInput,
} from './types';

const MAX_INHERITANCE_DEPTH = 3;

export async function createPersona(input: CreatePersonaInput) {
  const [created] = await db
    .insert(persona)
    .values({
      name: input.name,
      scope: input.scope ?? 'project',
      projectId: input.projectId ?? null,
      soul: input.soul ?? null,
      identity: input.identity ?? null,
      brandId: input.brandId ?? null,
      routingProfileId: input.routingProfileId ?? null,
      parentPersonaId: input.parentPersonaId ?? null,
    })
    .returning();

  return created;
}

export async function getPersona(id: string) {
  const result = await db.query.persona.findFirst({
    where: eq(persona.id, id),
  });

  if (!result) {
    throw new Error(`Persona not found: ${id}`);
  }

  return result;
}

type PersonaRow = typeof persona.$inferSelect;

export async function resolvePersona(id: string): Promise<ResolvedPersona> {
  const chain: PersonaRow[] = [];
  let currentId: string | null = id;
  let depth = 0;

  while (currentId && depth < MAX_INHERITANCE_DEPTH) {
    const row: PersonaRow | undefined = await db.query.persona.findFirst({
      where: eq(persona.id, currentId),
    });

    if (!row) {
      if (depth === 0) throw new Error(`Persona not found: ${id}`);
      break;
    }

    chain.push(row);
    currentId = row.parentPersonaId;
    depth++;
  }

  // Merge: deepest parent first, child overrides win
  const reversed = [...chain].reverse();

  let mergedSoul: string | null = null;
  let mergedIdentity: Record<string, unknown> = {};
  let mergedBrandId: string | null = null;
  let mergedRoutingProfileId: string | null = null;

  for (const p of reversed) {
    if (p.soul) mergedSoul = p.soul;
    if (p.identity) {
      mergedIdentity = {
        ...mergedIdentity,
        ...(p.identity as Record<string, unknown>),
      };
    }
    if (p.brandId) mergedBrandId = p.brandId;
    if (p.routingProfileId) mergedRoutingProfileId = p.routingProfileId;
  }

  // Collect skills from all personas in chain, child configOverrides win
  const skillMap = new Map<
    string,
    {
      skillId: string;
      skillName: string;
      enabled: boolean | null;
      configOverrides: unknown;
    }
  >();

  for (const p of reversed) {
    const bindings = await db
      .select({
        skillId: personaSkill.skillId,
        skillName: skill.name,
        enabled: personaSkill.enabled,
        configOverrides: personaSkill.configOverrides,
      })
      .from(personaSkill)
      .innerJoin(skill, eq(personaSkill.skillId, skill.id))
      .where(eq(personaSkill.personaId, p.id));

    for (const b of bindings) {
      skillMap.set(b.skillId, b);
    }
  }

  const self = chain[0];
  return {
    id: self.id,
    name: self.name,
    scope: self.scope,
    projectId: self.projectId,
    soul: mergedSoul,
    identity: mergedIdentity,
    brandId: mergedBrandId,
    routingProfileId: mergedRoutingProfileId,
    parentPersonaId: self.parentPersonaId,
    skills: Array.from(skillMap.values()),
    createdAt: self.createdAt,
    updatedAt: self.updatedAt,
  };
}

export async function listPersonas(filters?: PersonaFilter) {
  const conditions = [];

  if (filters?.projectId) {
    conditions.push(eq(persona.projectId, filters.projectId));
  }
  if (filters?.scope) {
    conditions.push(eq(persona.scope, filters.scope));
  }

  return db
    .select()
    .from(persona)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(persona.name));
}

export async function updatePersona(id: string, updates: UpdatePersonaInput) {
  const existing = await db.query.persona.findFirst({
    where: eq(persona.id, id),
  });

  if (!existing) {
    throw new Error(`Persona not found: ${id}`);
  }

  const [updated] = await db
    .update(persona)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(persona.id, id))
    .returning();

  return updated;
}

export async function deletePersona(id: string) {
  const existing = await db.query.persona.findFirst({
    where: eq(persona.id, id),
  });

  if (!existing) {
    throw new Error(`Persona not found: ${id}`);
  }

  // Cascade delete personaSkill records
  await db.delete(personaSkill).where(eq(personaSkill.personaId, id));
  await db.delete(persona).where(eq(persona.id, id));

  return { deleted: true, id };
}

export async function attachSkill(
  personaId: string,
  skillId: string,
  configOverrides?: Record<string, unknown>
) {
  const [created] = await db
    .insert(personaSkill)
    .values({
      personaId,
      skillId,
      enabled: true,
      configOverrides: configOverrides ?? null,
    })
    .returning();

  return created;
}

export async function detachSkill(personaId: string, skillId: string) {
  await db
    .delete(personaSkill)
    .where(
      and(
        eq(personaSkill.personaId, personaId),
        eq(personaSkill.skillId, skillId)
      )
    );

  return { detached: true, personaId, skillId };
}

export async function listPersonaSkills(personaId: string) {
  return db
    .select({
      skillId: personaSkill.skillId,
      skillName: skill.name,
      enabled: personaSkill.enabled,
      configOverrides: personaSkill.configOverrides,
    })
    .from(personaSkill)
    .innerJoin(skill, eq(personaSkill.skillId, skill.id))
    .where(eq(personaSkill.personaId, personaId));
}
