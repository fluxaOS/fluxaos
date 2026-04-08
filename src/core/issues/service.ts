import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { issue, issueEvent } from '@/core/db/schema';
import type { CreateIssueInput, IssueState, UpdateIssueInput } from './types';
import { VALID_TRANSITIONS } from './types';

export async function createIssue(input: CreateIssueInput) {
  const [created] = await db
    .insert(issue)
    .values({
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'medium',
      type: input.type ?? 'task',
      createdBy: input.createdBy ?? null,
      source: input.source ?? 'internal',
    })
    .returning();

  await db.insert(issueEvent).values({
    issueId: created.id,
    type: 'created',
    payload: { title: created.title },
  });

  return created;
}

export async function getIssue(id: string) {
  const result = await db.query.issue.findFirst({
    where: eq(issue.id, id),
    with: { events: { orderBy: [desc(issueEvent.timestamp)] } },
  });

  if (!result) {
    throw new Error(`Issue not found: ${id}`);
  }

  return result;
}

export async function listIssues(
  projectId: string,
  filters?: { state?: IssueState; type?: string }
) {
  const conditions = [eq(issue.projectId, projectId)];

  if (filters?.state) {
    conditions.push(eq(issue.state, filters.state));
  }
  if (filters?.type) {
    conditions.push(eq(issue.type, filters.type));
  }

  return db
    .select()
    .from(issue)
    .where(and(...conditions))
    .orderBy(desc(issue.createdAt));
}

export async function updateIssue(id: string, updates: UpdateIssueInput) {
  const [updated] = await db
    .update(issue)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(issue.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Issue not found: ${id}`);
  }

  await db.insert(issueEvent).values({
    issueId: id,
    type: 'updated',
    payload: updates,
  });

  return updated;
}

export async function transitionIssue(id: string, newState: IssueState) {
  const existing = await db.query.issue.findFirst({
    where: eq(issue.id, id),
  });

  if (!existing) {
    throw new Error(`Issue not found: ${id}`);
  }

  const currentState = existing.state as IssueState;
  const allowed = VALID_TRANSITIONS[currentState];

  if (!allowed.includes(newState)) {
    throw new Error(
      `Invalid transition: ${currentState} → ${newState}. Allowed: ${allowed.join(', ')}`
    );
  }

  const [updated] = await db
    .update(issue)
    .set({ state: newState, updatedAt: new Date() })
    .where(eq(issue.id, id))
    .returning();

  await db.insert(issueEvent).values({
    issueId: id,
    type: 'state_changed',
    payload: { from: currentState, to: newState },
  });

  return updated;
}
