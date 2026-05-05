import { and, count, desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { nextRevisionNumber } from '@/core/db/revision';
import {
  personaSkill,
  skill,
  skillRevision,
  stageRun,
} from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type SkillInsert = typeof skill.$inferInsert;
type SkillSelect = typeof skill.$inferSelect;

/**
 * The service accepts either a top-level Database handle or a transaction
 * handle (from `db.transaction(async (tx) => ...)`). Callers that need
 * atomicity across multiple service calls (e.g., skill.delete's FK guard
 * + version-locked delete in `src/server/routers/skill.ts`) pass the tx.
 */
type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function createSkillService(db: DbOrTx) {
  const crud = createCrudService<SkillInsert, SkillSelect>(
    db as Database,
    skill
  );

  return {
    ...crud,

    async listByProject(projectId: string): Promise<SkillSelect[]> {
      return db
        .select()
        .from(skill)
        .where(eq(skill.projectId, projectId))
        .orderBy(desc(skill.createdAt));
    },

    async listGlobal(): Promise<SkillSelect[]> {
      return db
        .select()
        .from(skill)
        .where(eq(skill.scope, 'global'))
        .orderBy(desc(skill.createdAt));
    },

    /**
     * Optimistic-lock update. Returns null if the expected version is stale.
     * Bumps version on success and writes a skill_revision snapshot of the
     * post-update state (FLX-13). Snapshot is best-effort within the same
     * connection — if the caller passes a transaction handle, both writes
     * are atomic; otherwise the snapshot still occurs but in a separate
     * statement (acceptable since we never roll back a successful update).
     */
    async updateWithVersion(
      id: string,
      expectedVersion: number,
      data: Partial<SkillInsert>,
      snapshotBy: string | null = null
    ): Promise<SkillSelect | null> {
      const [row] = await db
        .update(skill)
        .set({
          ...data,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(skill.id, id), eq(skill.version, expectedVersion)))
        .returning();
      if (!row) return null;
      await snapshotSkillRevision(db, row as SkillSelect, snapshotBy);
      return row as SkillSelect;
    },

    /**
     * List revisions for a skill, newest first.
     */
    async listRevisions(skillId: string) {
      return db
        .select()
        .from(skillRevision)
        .where(eq(skillRevision.skillId, skillId))
        .orderBy(desc(skillRevision.revisionNumber));
    },

    /**
     * Revert a skill to the snapshotted state of a prior revision. Writes
     * a NEW revision capturing the reverted state (so history is
     * append-only). Bumps the row's optimistic version. Throws if the
     * caller's expectedVersion is stale or the requested revision doesn't
     * exist.
     */
    async revertToRevision(
      id: string,
      expectedVersion: number,
      revisionNumber: number,
      snapshotBy: string | null = null
    ): Promise<SkillSelect | null> {
      const [target] = await db
        .select()
        .from(skillRevision)
        .where(
          and(
            eq(skillRevision.skillId, id),
            eq(skillRevision.revisionNumber, revisionNumber)
          )
        );
      if (!target) {
        throw new Error(`Revision ${revisionNumber} not found for skill ${id}`);
      }
      const [row] = await db
        .update(skill)
        .set({
          name: target.name,
          scope: target.scope,
          description: target.description,
          promptTemplate: target.promptTemplate,
          inputSchema: target.inputSchema,
          outputSchema: target.outputSchema,
          tags: target.tags,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(skill.id, id), eq(skill.version, expectedVersion)))
        .returning();
      if (!row) return null;
      await snapshotSkillRevision(db, row as SkillSelect, snapshotBy);
      return row as SkillSelect;
    },

    /**
     * Count references to this skill across all FK-holding tables.
     * Used to produce meaningful delete-failure messages.
     *
     * FLX-153: pipeline_stage.skill_id was removed — pipelineStages is always 0.
     */
    async countReferences(id: string): Promise<{
      pipelineStages: number;
      stageRuns: number;
      personaSkills: number;
    }> {
      const [sr] = await db
        .select({ c: count() })
        .from(stageRun)
        .where(eq(stageRun.skillId, id));
      const [psk] = await db
        .select({ c: count() })
        .from(personaSkill)
        .where(eq(personaSkill.skillId, id));
      return {
        pipelineStages: 0,
        stageRuns: Number(sr?.c ?? 0),
        personaSkills: Number(psk?.c ?? 0),
      };
    },

    /**
     * Optimistic-lock delete. Returns true if the row was deleted at the
     * expected version; false if version was stale (no row deleted).
     */
    async deleteWithVersion(
      id: string,
      expectedVersion: number
    ): Promise<boolean> {
      const result = await db
        .delete(skill)
        .where(and(eq(skill.id, id), eq(skill.version, expectedVersion)))
        .returning({ id: skill.id });
      return result.length > 0;
    },
  };
}

export type SkillService = ReturnType<typeof createSkillService>;

/**
 * Append a skill_revision row capturing the current row state. Computes
 * the next revision_number atomically via a `(SELECT max+1 …)` subquery
 * so concurrent saves on the same skill cannot collide on the unique
 * (skill_id, revision_number) index.
 */
async function snapshotSkillRevision(
  db: DbOrTx,
  row: SkillSelect,
  snapshotBy: string | null
): Promise<void> {
  await db.insert(skillRevision).values({
    skillId: row.id,
    revisionNumber: nextRevisionNumber(
      skillRevision,
      skillRevision.skillId,
      row.id
    ),
    name: row.name,
    scope: row.scope,
    description: row.description,
    promptTemplate: row.promptTemplate,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    tags: row.tags,
    snapshotBy,
  });
}
