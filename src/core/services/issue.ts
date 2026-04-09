import { eq, desc } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issue, issueEvent } from '@/core/db/schema';
import { createCrudService } from './crud-factory';
import type { IssueState } from '@/core/issues/types';
import { VALID_TRANSITIONS } from '@/core/issues/types';

type IssueInsert = typeof issue.$inferInsert;
type IssueSelect = typeof issue.$inferSelect;
type IssueEventInsert = typeof issueEvent.$inferInsert;
type IssueEventSelect = typeof issueEvent.$inferSelect;

export function createIssueService(db: Database) {
  const crud = createCrudService<IssueInsert, IssueSelect>(db, issue);

  return {
    ...crud,

    async listByProject(projectId: string): Promise<IssueSelect[]> {
      return db
        .select()
        .from(issue)
        .where(eq(issue.projectId, projectId))
        .orderBy(desc(issue.createdAt));
    },

    async transition(id: string, newState: IssueState): Promise<IssueSelect | null> {
      const current = await crud.getById(id);
      if (!current) return null;

      const allowed = VALID_TRANSITIONS[current.state as IssueState];
      if (!allowed?.includes(newState)) {
        throw new Error(
          `Invalid transition: ${current.state} → ${newState}. ` +
            `Allowed: [${allowed?.join(', ') ?? 'none'}]`,
        );
      }

      return crud.update(id, { state: newState });
    },

    async addComment(
      issueId: string,
      payload: { text: string; author?: string },
    ): Promise<IssueEventSelect> {
      const [row] = await db
        .insert(issueEvent)
        .values({
          issueId,
          type: 'comment',
          payload,
        })
        .returning();
      return row;
    },

    async updateComment(
      eventId: string,
      payload: { text: string },
    ): Promise<IssueEventSelect | null> {
      const [row] = await db
        .update(issueEvent)
        .set({ payload })
        .where(eq(issueEvent.id, eventId))
        .returning();
      return row ?? null;
    },

    async deleteComment(eventId: string): Promise<void> {
      await db.delete(issueEvent).where(eq(issueEvent.id, eventId));
    },

    async listEvents(issueId: string): Promise<IssueEventSelect[]> {
      return db
        .select()
        .from(issueEvent)
        .where(eq(issueEvent.issueId, issueId))
        .orderBy(desc(issueEvent.timestamp));
    },
  };
}

export type IssueService = ReturnType<typeof createIssueService>;
