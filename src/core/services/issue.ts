import { eq, desc } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issue, issueEvent } from '@/core/db/schema';
import { createCrudService } from './crud-factory';
import type { IssueState } from '@/core/issues/types';
import { VALID_TRANSITIONS } from '@/core/issues/types';

type IssueInsert = typeof issue.$inferInsert;
type IssueSelect = typeof issue.$inferSelect;
type IssueEventSelect = typeof issueEvent.$inferSelect;

export function createIssueService(db: Database) {
  const crud = createCrudService<IssueInsert, IssueSelect>(db, issue);

  async function addEvent(
    issueId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<IssueEventSelect> {
    const [row] = await db
      .insert(issueEvent)
      .values({ issueId, type, payload })
      .returning();
    return row;
  }

  return {
    ...crud,

    async listByProject(projectId: string): Promise<IssueSelect[]> {
      return db
        .select()
        .from(issue)
        .where(eq(issue.projectId, projectId))
        .orderBy(desc(issue.createdAt));
    },

    async transition(
      id: string,
      newState: IssueState,
      userId?: string,
    ): Promise<IssueSelect | null> {
      const current = await crud.getById(id);
      if (!current) return null;

      const oldState = current.state as IssueState;
      const allowed = VALID_TRANSITIONS[oldState];
      if (!allowed?.includes(newState)) {
        throw new Error(
          `Invalid transition: ${oldState} → ${newState}. ` +
            `Allowed: [${allowed?.join(', ') ?? 'none'}]`,
        );
      }

      const updated = await crud.update(id, { state: newState });

      // System comment on state change
      await addEvent(id, 'state_change', {
        from: oldState,
        to: newState,
        user: userId ?? 'system',
      });

      return updated;
    },

    async updateFields(
      id: string,
      fields: Partial<Pick<IssueInsert, 'title' | 'description' | 'priority' | 'type'>>,
      userId?: string,
    ): Promise<IssueSelect | null> {
      const current = await crud.getById(id);
      if (!current) return null;

      const updated = await crud.update(id, fields);

      // System comment on field changes
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && current[key as keyof typeof current] !== value) {
          changes[key] = { from: current[key as keyof typeof current], to: value };
        }
      }
      if (Object.keys(changes).length > 0) {
        await addEvent(id, 'fields_updated', {
          changes,
          user: userId ?? 'system',
        });
      }

      return updated;
    },

    async addComment(
      issueId: string,
      payload: { text: string; author: string },
    ): Promise<IssueEventSelect> {
      return addEvent(issueId, 'comment', payload);
    },

    async updateComment(
      eventId: string,
      payload: { text: string; editedBy: string },
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
        .orderBy(issueEvent.timestamp);
    },
  };
}

export type IssueService = ReturnType<typeof createIssueService>;
