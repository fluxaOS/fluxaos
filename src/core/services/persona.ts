import { desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { persona } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type PersonaInsert = typeof persona.$inferInsert;
type PersonaSelect = typeof persona.$inferSelect;

export function createPersonaService(db: Database) {
  const crud = createCrudService<PersonaInsert, PersonaSelect>(db, persona);

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
  };
}

export type PersonaService = ReturnType<typeof createPersonaService>;
