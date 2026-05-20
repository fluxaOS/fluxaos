import { count, desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { persona, pipelineStage } from '@/core/db/schema';
import { createVersionedCrudService } from './crud-factory';
import {
  resolveScoped,
  resolveScopedAll,
  type ScopeContext,
} from './resolve-scoped';

type PersonaInsert = typeof persona.$inferInsert;
type PersonaSelect = typeof persona.$inferSelect;
type PersonaCreateInput = PersonaInsert & { scope?: 'global' | 'project' };

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function createPersonaService(db: DbOrTx) {
  const crud = createVersionedCrudService<PersonaInsert, PersonaSelect>(
    db as Database,
    persona
  );

  return {
    ...crud,

    async create(data: PersonaCreateInput): Promise<PersonaSelect> {
      const { scope: _scope, ...insert } = data;
      const scopedData =
        insert.projectId !== undefined && insert.projectId !== null
          ? {
              ...insert,
              kind: 'project',
              orgId: null,
              teamId: null,
              userId: null,
            }
          : {
              ...insert,
              kind: 'catalog',
              orgId: null,
              teamId: null,
              userId: null,
              projectId: null,
            };
      return crud.create(scopedData);
    },

    async listByProject(projectId: string): Promise<PersonaSelect[]> {
      return db
        .select()
        .from(persona)
        .where(eq(persona.projectId, projectId))
        .orderBy(desc(persona.createdAt));
    },

    async listEffective(scope: ScopeContext): Promise<PersonaSelect[]> {
      return resolveScopedAll<PersonaSelect>(
        db as Database,
        persona,
        scope,
        'name'
      );
    },

    async resolveEffectiveById(
      id: string,
      scope: ScopeContext
    ): Promise<PersonaSelect | null> {
      const base = await crud.getById(id);
      if (!base) return null;
      return resolveScoped<PersonaSelect>(
        db as Database,
        persona,
        scope,
        eq(persona.name, base.name)
      );
    },

    async listGlobal(): Promise<PersonaSelect[]> {
      return db
        .select()
        .from(persona)
        .where(eq(persona.kind, 'catalog'))
        .orderBy(desc(persona.createdAt));
    },

    /**
     * Count references to this persona across all FK-holding tables.
     * Used to produce meaningful delete-failure messages.
     */
    async countReferences(id: string): Promise<{ pipelineStages: number }> {
      const [ps] = await db
        .select({ c: count() })
        .from(pipelineStage)
        .where(eq(pipelineStage.personaId, id));
      return { pipelineStages: Number(ps?.c ?? 0) };
    },
  };
}

export type PersonaService = ReturnType<typeof createPersonaService>;
