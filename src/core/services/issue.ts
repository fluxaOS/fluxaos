/**
 * Issue service — the core service for issue lifecycle management.
 *
 * 100% database-driven: no hardcoded enums, states, or transitions.
 * Uses optimistic concurrency (version field) on all mutations.
 * Issue numbers are allocated with FOR UPDATE locking.
 * Body HTML is rendered at write time from markdown.
 */
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import {
  configEntry,
  issue,
  issueEvent,
  issueState,
  issueStatus,
  issueTransition,
} from '@/core/db/schema';
import { renderMarkdown } from '@/core/markdown';

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

// ─── Inferred types ──────────────────────────────────────────────────────────

type IssueInsert = typeof issue.$inferInsert;
type IssueSelect = typeof issue.$inferSelect;
type IssueStateSelect = typeof issueState.$inferSelect;

// ─── Input types ─────────────────────────────────────────────────────────────

interface CreateIssueInput {
  projectId: string;
  title: string;
  bodyMd?: string;
  typeId: string;
  priorityId: string;
  assignee?: string;
  labels?: unknown[];
  author?: string;
  parentIssueId?: string;
}

interface ListIssueFilters {
  isClosed?: boolean;
  typeId?: string;
  stateId?: string;
  priorityId?: string;
  assignee?: string;
  search?: string;
}

interface UpdateFieldsInput {
  title?: string;
  bodyMd?: string;
  typeId?: string;
  priorityId?: string;
  assignee?: string | null;
  labels?: unknown[];
}

// ─── Service factory ─────────────────────────────────────────────────────────

export function createIssueService(db: DbOrTx) {
  // ── Helpers ──────────────────────────────────────────────────────────────

  async function resolveInitialState(
    projectId: string
  ): Promise<IssueStateSelect> {
    const [state] = await db
      .select()
      .from(issueState)
      .where(
        and(
          eq(issueState.projectId, projectId),
          eq(issueState.isTerminal, false),
          eq(issueState.isActive, true)
        )
      )
      .orderBy(issueState.sortOrder)
      .limit(1);

    if (!state) {
      throw new Error(
        `No active non-terminal state found for project ${projectId}. Run seed or configure issue states.`
      );
    }
    return state;
  }

  async function resolveInitialStatusId(projectId: string): Promise<string> {
    // 1. Read config key
    const [config] = await db
      .select()
      .from(configEntry)
      .where(
        and(
          eq(configEntry.projectId, projectId),
          eq(configEntry.key, 'issues.status.on_create_key')
        )
      );

    if (!config) {
      throw new Error(
        `Missing config: issues.status.on_create_key for project ${projectId}. Run seed.`
      );
    }

    const statusKey = config.value as string;

    // 2. Resolve key → statusId
    const [status] = await db
      .select()
      .from(issueStatus)
      .where(
        and(
          eq(issueStatus.projectId, projectId),
          eq(issueStatus.key, statusKey)
        )
      );

    if (!status) {
      throw new Error(
        `Status '${statusKey}' not found for project ${projectId}. Check issue_status catalog.`
      );
    }

    return status.id;
  }

  async function recordEvent(
    issueId: string,
    actor: string,
    type: string,
    payload: Record<string, unknown>
  ) {
    await db.insert(issueEvent).values({
      issueId,
      actor,
      type,
      payload,
    });
  }

  async function findTerminalState(
    projectId: string
  ): Promise<IssueStateSelect> {
    const [state] = await db
      .select()
      .from(issueState)
      .where(
        and(
          eq(issueState.projectId, projectId),
          eq(issueState.isTerminal, true),
          eq(issueState.isActive, true)
        )
      )
      .orderBy(issueState.sortOrder)
      .limit(1);

    if (!state) {
      throw new Error(
        `No active terminal state found for project ${projectId}. Check issue_state catalog.`
      );
    }
    return state;
  }

  async function findNonTerminalState(
    projectId: string
  ): Promise<IssueStateSelect> {
    const [state] = await db
      .select()
      .from(issueState)
      .where(
        and(
          eq(issueState.projectId, projectId),
          eq(issueState.isTerminal, false),
          eq(issueState.isActive, true)
        )
      )
      .orderBy(issueState.sortOrder)
      .limit(1);

    if (!state) {
      throw new Error(
        `No active non-terminal state found for project ${projectId}. Check issue_state catalog.`
      );
    }
    return state;
  }

  async function resolveStatusByConfigKey(
    projectId: string,
    configKey: string
  ): Promise<string> {
    const [config] = await db
      .select()
      .from(configEntry)
      .where(
        and(
          eq(configEntry.projectId, projectId),
          eq(configEntry.key, configKey)
        )
      );

    if (!config) {
      throw new Error(
        `Missing config: ${configKey} for project ${projectId}. Run seed.`
      );
    }

    const statusKey = config.value as string;
    const [status] = await db
      .select()
      .from(issueStatus)
      .where(
        and(
          eq(issueStatus.projectId, projectId),
          eq(issueStatus.key, statusKey)
        )
      );

    if (!status) {
      throw new Error(
        `Status '${statusKey}' not found for project ${projectId}.`
      );
    }

    return status.id;
  }

  async function resolveStateByConfigKey(
    projectId: string,
    configKey: string
  ): Promise<IssueStateSelect> {
    const [config] = await db
      .select()
      .from(configEntry)
      .where(
        and(
          eq(configEntry.projectId, projectId),
          eq(configEntry.key, configKey)
        )
      );

    if (!config) {
      throw new Error(
        `Missing config: ${configKey} for project ${projectId}. Run seed.`
      );
    }

    const stateKey = config.value as string;
    return findStateByKey(projectId, stateKey);
  }

  async function findStateByKey(
    projectId: string,
    key: string
  ): Promise<IssueStateSelect> {
    const [state] = await db
      .select()
      .from(issueState)
      .where(
        and(
          eq(issueState.projectId, projectId),
          eq(issueState.key, key),
          eq(issueState.isActive, true)
        )
      );

    if (!state) {
      throw new Error(`State '${key}' not found for project ${projectId}.`);
    }

    return state;
  }

  function assertVersion(current: IssueSelect, expected: number) {
    if (current.version !== expected) {
      throw new Error(
        `VERSION_CONFLICT: Expected version ${expected}, but issue has version ${current.version}. Reload and retry.`
      );
    }
  }

  /**
   * Epic auto-close: when a child transitions to a terminal state, check
   * whether the parent now has zero open children; if so, close the parent
   * via the same close path operators use. Fire-and-forget from transition()
   * and stateOverride(). Only runs when the child's new state is terminal
   * (guard is the caller's responsibility).
   *
   * Concurrency: two children closing simultaneously both see "0 open" and
   * both try to close the parent. Optimistic-lock VERSION_CONFLICT on the
   * second write — catch, re-read, retry once. If still conflicting or the
   * parent was closed by the other writer in the meantime, log+return.
   *
   * Recurses naturally: close() → stateOverride() → maybeAutoCloseParent()
   * for the grandparent, and so on up the tree.
   */
  async function maybeAutoCloseParent(childId: string): Promise<void> {
    const [child] = await db.select().from(issue).where(eq(issue.id, childId));
    if (!child?.parentIssueId) return;

    const parentId = child.parentIssueId;

    const attempt = async (): Promise<
      'closed' | 'already_closed' | 'has_open' | 'conflict'
    > => {
      const [parent] = await db
        .select()
        .from(issue)
        .where(eq(issue.id, parentId));
      if (!parent) return 'already_closed';
      if (parent.isClosed) return 'already_closed';

      const [{ openCount }] = (await db.execute(
        sql`SELECT COUNT(*)::int AS "openCount" FROM issue WHERE parent_issue_id = ${parentId} AND is_closed = false`
      )) as unknown as Array<{ openCount: number }>;

      if (openCount > 0) return 'has_open';

      try {
        const terminalState = await findTerminalState(parent.projectId);
        const [updated] = await db
          .update(issue)
          .set({
            stateId: terminalState.id,
            isClosed: true,
            closedAt: new Date(),
            version: parent.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(issue.id, parentId), eq(issue.version, parent.version)))
          .returning();
        if (!updated) return 'conflict';

        await recordEvent(parentId, 'orchestrator', 'state_changed', {
          from_state: parent.stateId,
          to_state: terminalState.id,
          user: 'orchestrator',
          override: true,
          reason: 'auto_close_all_children_closed',
          last_child: childId,
        });

        // Grandparent propagation — the parent we just closed may itself
        // have a parent. Run the same check one level up.
        await maybeAutoCloseParent(parentId);
        return 'closed';
      } catch (err) {
        console.error('[epic] auto-close failed:', err);
        return 'conflict';
      }
    };

    const first = await attempt();
    if (first === 'conflict') {
      const second = await attempt();
      if (second === 'conflict') {
        console.warn(
          `[epic] parent ${parentId} auto-close raced twice — manual close may be required`
        );
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    async create(data: CreateIssueInput): Promise<IssueSelect> {
      const [initialState, statusId] = await Promise.all([
        resolveInitialState(data.projectId),
        resolveInitialStatusId(data.projectId),
      ]);

      const actor = data.author ?? 'system';
      const bodyHtml = data.bodyMd ? renderMarkdown(data.bodyMd) : null;

      // Validate parent (if supplied) exists and is in the same project.
      // The DB trigger enforces this as a backstop, but doing it in JS gives
      // the caller a clean error instead of a raw trigger exception.
      if (data.parentIssueId) {
        const [parent] = await db
          .select({ projectId: issue.projectId })
          .from(issue)
          .where(eq(issue.id, data.parentIssueId));
        if (!parent) {
          throw new Error(`Parent issue ${data.parentIssueId} not found.`);
        }
        if (parent.projectId !== data.projectId) {
          throw new Error(
            `CROSS_PROJECT_PARENT: Parent issue ${data.parentIssueId} belongs to a different project.`
          );
        }
      }

      const result = await db.transaction(async (tx) => {
        // Allocate number with FOR UPDATE lock
        const rows = await tx.execute(
          sql`SELECT COALESCE(MAX(number), 0) + 1 AS "nextNumber" FROM (SELECT number FROM issue WHERE project_id = ${data.projectId} FOR UPDATE) AS locked`
        );
        const nextNumber = Number(
          (rows as unknown as Array<{ nextNumber: number }>)[0].nextNumber
        );

        const [created] = await tx
          .insert(issue)
          .values({
            projectId: data.projectId,
            number: nextNumber,
            title: data.title,
            bodyMd: data.bodyMd ?? null,
            bodyHtml,
            stateId: initialState.id,
            statusId,
            typeId: data.typeId,
            priorityId: data.priorityId,
            isClosed: false,
            assignee: data.assignee ?? null,
            author: actor,
            labels: data.labels ?? [],
            parentIssueId: data.parentIssueId ?? null,
          })
          .returning();

        await tx.insert(issueEvent).values({
          issueId: created.id,
          actor,
          type: 'issue_created',
          payload: { author: actor },
        });

        return created;
      });

      return result;
    },

    async listByProject(
      projectId: string,
      filters?: ListIssueFilters
    ): Promise<IssueSelect[]> {
      const conditions = [eq(issue.projectId, projectId)];

      if (filters?.isClosed !== undefined) {
        conditions.push(eq(issue.isClosed, filters.isClosed));
      }
      if (filters?.typeId) {
        conditions.push(eq(issue.typeId, filters.typeId));
      }
      if (filters?.stateId) {
        conditions.push(eq(issue.stateId, filters.stateId));
      }
      if (filters?.priorityId) {
        conditions.push(eq(issue.priorityId, filters.priorityId));
      }
      if (filters?.assignee) {
        conditions.push(eq(issue.assignee, filters.assignee));
      }
      if (filters?.search) {
        conditions.push(ilike(issue.title, `%${filters.search}%`));
      }

      return db
        .select()
        .from(issue)
        .where(and(...conditions))
        .orderBy(desc(issue.createdAt));
    },

    async getById(
      id: string,
      projectId: string
    ): Promise<(IssueSelect & { hasOpenChildren: boolean }) | null> {
      const [row] = await db
        .select()
        .from(issue)
        .where(and(eq(issue.id, id), eq(issue.projectId, projectId)));
      if (!row) return null;
      const [{ openCount }] = (await db.execute(
        sql`SELECT COUNT(*)::int AS "openCount" FROM issue WHERE parent_issue_id = ${id} AND is_closed = false`
      )) as unknown as Array<{ openCount: number }>;
      return { ...row, hasOpenChildren: openCount > 0 };
    },

    async getByNumber(
      projectId: string,
      number: number
    ): Promise<IssueSelect | null> {
      const [row] = await db
        .select()
        .from(issue)
        .where(and(eq(issue.projectId, projectId), eq(issue.number, number)));
      return row ?? null;
    },

    async updateFields(
      id: string,
      fields: UpdateFieldsInput,
      version: number,
      projectId: string,
      userId?: string
    ): Promise<IssueSelect> {
      const whereClause = and(eq(issue.id, id), eq(issue.projectId, projectId));
      const current = await db
        .select()
        .from(issue)
        .where(whereClause)
        .then(([r]) => r ?? null);

      if (!current) {
        throw new Error(`Issue ${id} not found.`);
      }

      assertVersion(current, version);

      // Build update payload
      const updates: Record<string, unknown> = {
        version: version + 1,
        updatedAt: new Date(),
      };

      if (fields.title !== undefined) updates.title = fields.title;
      if (fields.typeId !== undefined) updates.typeId = fields.typeId;
      if (fields.priorityId !== undefined)
        updates.priorityId = fields.priorityId;
      if (fields.assignee !== undefined) updates.assignee = fields.assignee;
      if (fields.labels !== undefined) updates.labels = fields.labels;
      if (fields.bodyMd !== undefined) {
        updates.bodyMd = fields.bodyMd;
        updates.bodyHtml = fields.bodyMd ? renderMarkdown(fields.bodyMd) : null;
      }

      const [updated] = await db
        .update(issue)
        .set(updates as Partial<IssueInsert>)
        .where(and(eq(issue.id, id), eq(issue.version, version)))
        .returning();

      if (!updated) {
        throw new Error(
          `VERSION_CONFLICT: Issue ${id} was modified concurrently. Reload and retry.`
        );
      }

      // Build changes for event
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const trackableFields = [
        'title',
        'bodyMd',
        'typeId',
        'priorityId',
        'assignee',
        'labels',
      ] as const;

      for (const key of trackableFields) {
        if (fields[key] !== undefined) {
          const oldVal = current[key];
          const newVal = fields[key];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            changes[key] = { from: oldVal, to: newVal };
          }
        }
      }

      const actor = userId ?? 'system';
      if (Object.keys(changes).length > 0) {
        await recordEvent(id, actor, 'fields_updated', {
          changes,
          user: actor,
        });
      }

      return updated;
    },

    async transition(
      id: string,
      toStateId: string,
      version: number,
      projectId: string,
      userId?: string
    ): Promise<IssueSelect> {
      const whereClause = and(eq(issue.id, id), eq(issue.projectId, projectId));
      const current = await db
        .select()
        .from(issue)
        .where(whereClause)
        .then(([r]) => r ?? null);

      if (!current) {
        throw new Error(`Issue ${id} not found.`);
      }

      assertVersion(current, version);

      // FLX-77: free state→state. issue_transition rows stay in DB as advisory
      // hint for orchestrator + future role-gated lock-down. Operator-driven
      // transitions accept any target state.
      const [targetState] = await db
        .select()
        .from(issueState)
        .where(eq(issueState.id, toStateId));

      if (!targetState) {
        throw new Error(`Target state ${toStateId} not found.`);
      }

      const [updated] = await db
        .update(issue)
        .set({
          stateId: toStateId,
          isClosed: targetState.isTerminal,
          closedAt: targetState.isTerminal ? new Date() : null,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(issue.id, id), eq(issue.version, version)))
        .returning();

      if (!updated) {
        throw new Error(
          `VERSION_CONFLICT: Issue ${id} was modified concurrently. Reload and retry.`
        );
      }

      const actor = userId ?? 'system';
      await recordEvent(id, actor, 'state_changed', {
        from_state: current.stateId,
        to_state: toStateId,
        user: actor,
      });

      // R-EPIC: when a child transitions to terminal, maybe auto-close parent.
      if (targetState.isTerminal) {
        await maybeAutoCloseParent(id);
      }

      return updated;
    },

    async stateOverride(
      id: string,
      toStateId: string,
      version: number,
      userId?: string
    ): Promise<IssueSelect> {
      const current = await db
        .select()
        .from(issue)
        .where(eq(issue.id, id))
        .then(([r]) => r ?? null);

      if (!current) {
        throw new Error(`Issue ${id} not found.`);
      }

      assertVersion(current, version);

      // No transition graph validation — direct override
      const [targetState] = await db
        .select()
        .from(issueState)
        .where(eq(issueState.id, toStateId));

      if (!targetState) {
        throw new Error(`Target state ${toStateId} not found.`);
      }

      const [updated] = await db
        .update(issue)
        .set({
          stateId: toStateId,
          isClosed: targetState.isTerminal,
          closedAt: targetState.isTerminal ? new Date() : null,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(issue.id, id), eq(issue.version, version)))
        .returning();

      if (!updated) {
        throw new Error(
          `VERSION_CONFLICT: Issue ${id} was modified concurrently. Reload and retry.`
        );
      }

      const actor = userId ?? 'system';
      await recordEvent(id, actor, 'state_changed', {
        from_state: current.stateId,
        to_state: toStateId,
        user: actor,
        override: true,
      });

      // R-EPIC: when a child transitions to terminal, maybe auto-close parent.
      if (targetState.isTerminal) {
        await maybeAutoCloseParent(id);
      }

      return updated;
    },

    async close(
      id: string,
      version: number,
      userId?: string
    ): Promise<IssueSelect> {
      const current = await db
        .select()
        .from(issue)
        .where(eq(issue.id, id))
        .then(([r]) => r ?? null);

      if (!current) {
        throw new Error(`Issue ${id} not found.`);
      }

      const terminalState = await findTerminalState(current.projectId);
      return this.stateOverride(id, terminalState.id, version, userId);
    },

    async reopen(
      id: string,
      version: number,
      userId?: string
    ): Promise<IssueSelect> {
      const current = await db
        .select()
        .from(issue)
        .where(eq(issue.id, id))
        .then(([r]) => r ?? null);

      if (!current) {
        throw new Error(`Issue ${id} not found.`);
      }

      const nonTerminalState = await findNonTerminalState(current.projectId);
      return this.stateOverride(id, nonTerminalState.id, version, userId);
    },

    async updateStatus(
      id: string,
      statusId: string,
      actor: string,
      version: number,
      reason?: string
    ): Promise<IssueSelect> {
      const [updated] = await db
        .update(issue)
        .set({
          statusId,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(issue.id, id), eq(issue.version, version)))
        .returning();

      if (!updated) {
        throw new Error(
          `VERSION_CONFLICT: Issue ${id} was modified concurrently (expected version ${version}). Reload and retry.`
        );
      }

      await recordEvent(id, actor, 'status_changed', { statusId, reason });
      return updated;
    },

    async getStateByKey(
      projectId: string,
      key: string
    ): Promise<IssueStateSelect> {
      return findStateByKey(projectId, key);
    },

    async getStatusIdByConfigKey(
      projectId: string,
      configKey: string
    ): Promise<string> {
      return resolveStatusByConfigKey(projectId, configKey);
    },

    async getStateByConfigKey(
      projectId: string,
      configKey: string
    ): Promise<IssueStateSelect> {
      return resolveStateByConfigKey(projectId, configKey);
    },

    async delete(id: string, projectId: string): Promise<void> {
      await db
        .delete(issue)
        .where(and(eq(issue.id, id), eq(issue.projectId, projectId)));
    },

    async getChildren(parentId: string): Promise<IssueSelect[]> {
      return db
        .select()
        .from(issue)
        .where(eq(issue.parentIssueId, parentId))
        .orderBy(issue.number);
    },

    async getParent(childId: string): Promise<IssueSelect | null> {
      const [child] = await db
        .select({ parentIssueId: issue.parentIssueId })
        .from(issue)
        .where(eq(issue.id, childId));
      if (!child?.parentIssueId) return null;
      const [parent] = await db
        .select()
        .from(issue)
        .where(eq(issue.id, child.parentIssueId));
      return parent ?? null;
    },

    async hasOpenChildren(parentId: string): Promise<boolean> {
      const [{ openCount }] = (await db.execute(
        sql`SELECT COUNT(*)::int AS "openCount" FROM issue WHERE parent_issue_id = ${parentId} AND is_closed = false`
      )) as unknown as Array<{ openCount: number }>;
      return openCount > 0;
    },

    async countChildren(
      parentId: string
    ): Promise<{ open: number; closed: number }> {
      const [row] = (await db.execute(
        sql`SELECT
              COUNT(*) FILTER (WHERE is_closed = false)::int AS "open",
              COUNT(*) FILTER (WHERE is_closed = true)::int AS "closed"
            FROM issue WHERE parent_issue_id = ${parentId}`
      )) as unknown as Array<{ open: number; closed: number }>;
      return { open: row?.open ?? 0, closed: row?.closed ?? 0 };
    },

    /**
     * Bulk query for list pages: returns a Map of parentId → openChildCount
     * for every parent that has at least one child in the given project.
     * Used by the issues list to render the "↳" and "(N open)" indicators
     * without per-row roundtrips.
     */
    async openChildCountsByProject(
      projectId: string
    ): Promise<Map<string, number>> {
      const rows = (await db.execute(
        sql`SELECT parent_issue_id AS "parentId", COUNT(*) FILTER (WHERE is_closed = false)::int AS "openCount"
            FROM issue
            WHERE project_id = ${projectId} AND parent_issue_id IS NOT NULL
            GROUP BY parent_issue_id`
      )) as unknown as Array<{ parentId: string; openCount: number }>;
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.parentId, r.openCount);
      return map;
    },

    async getValidTransitions(issueId: string): Promise<
      Array<{
        id: string;
        key: string;
        displayName: string;
        color: string;
        isTerminal: boolean;
      }>
    > {
      const current = await db
        .select()
        .from(issue)
        .where(eq(issue.id, issueId))
        .then(([r]) => r ?? null);

      if (!current) {
        throw new Error(`Issue ${issueId} not found.`);
      }

      // Get transitions from current state, join with target state info
      const transitions = await db
        .select({
          id: issueState.id,
          key: issueState.key,
          displayName: issueState.displayName,
          color: issueState.color,
          isTerminal: issueState.isTerminal,
        })
        .from(issueTransition)
        .innerJoin(issueState, eq(issueTransition.toStateId, issueState.id))
        .where(
          and(
            eq(issueTransition.projectId, current.projectId),
            eq(issueTransition.fromStateId, current.stateId),
            eq(issueTransition.isActive, true)
          )
        )
        .orderBy(issueTransition.sortOrder);

      return transitions;
    },
  };
}

export type IssueService = ReturnType<typeof createIssueService>;
