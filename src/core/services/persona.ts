import { count, desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { persona, pipelineStage } from '@/core/db/schema';
import { createVersionedCrudService } from './crud-factory';

type PersonaInsert = typeof persona.$inferInsert;
type PersonaSelect = typeof persona.$inferSelect;

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function createPersonaService(db: DbOrTx) {
  const crud = createVersionedCrudService<PersonaInsert, PersonaSelect>(
    db as Database,
    persona
  );

  return {
    ...crud,

    async listByProject(projectId: string): Promise<PersonaSelect[]> {
      return db
        .select()
        .from(persona)
        .where(eq(persona.projectId, projectId))
        .orderBy(desc(persona.createdAt));
    },

    async listGlobal(): Promise<PersonaSelect[]> {
      return db
        .select()
        .from(persona)
        .where(eq(persona.scope, 'global'))
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
