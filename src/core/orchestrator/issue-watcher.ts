/**
 * IssueWatcher — subscribes to Supabase Realtime INSERT + UPDATE on the
 * `issue` table and auto-dispatches a pipeline_run whenever:
 *
 *   1. The issue's statusId resolves to the "open" status (config key
 *      `issues.status.on_create_key`).
 *   2. No active (non-terminal) pipeline_run exists for the issue.
 *   3. The issue's project has a `defaultPipelineId` configured.
 *   4. The issue is not already being dispatched (in-memory dedupe set).
 *
 * The inserted pipeline_run sits at `status = 'pending'`; the existing
 * EventOrchestrator Realtime subscription picks it up automatically.
 */
import { and, eq, notInArray } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import {
  configEntry,
  issue,
  issueStatus,
  pipelineRun,
  project,
} from '@/core/db/schema';
import type { ConsoleLogger } from '@/core/logger/console';
import type { Unsubscribe } from '@/core/ports/auth';
import type { RealtimeProvider } from '@/core/ports/realtime';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Shape of an issue row as delivered by Supabase Realtime.
 * Realtime sends DB column names (snake_case), not Drizzle field names.
 */
interface IssueRealtimeRow {
  id: string;
  project_id: string;
  number: number;
  status_id: string;
  state_id: string;
  is_closed: boolean;
}

/** Terminal pipeline_run statuses — runs in these states are done. */
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'];

export interface IssueWatcher {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createIssueWatcher(
  db: Database,
  realtime: RealtimeProvider,
  logger: ConsoleLogger
): IssueWatcher {
  let unsubscribeInsert: Unsubscribe | null = null;
  let unsubscribeUpdate: Unsubscribe | null = null;
  let isRunning = false;

  /** Issue IDs currently being dispatched — prevents concurrent double-inserts. */
  const inFlight = new Set<string>();

  // ─── Realtime Subscription ────────────────────────────────────────────

  function start(): void {
    if (isRunning) return;
    isRunning = true;

    unsubscribeInsert = realtime.subscribeToTable<IssueRealtimeRow>(
      'issue-watcher-insert',
      'issue',
      'INSERT',
      (payload) => {
        handleIssueEvent(payload.new).catch(logError('insert'));
      }
    );

    unsubscribeUpdate = realtime.subscribeToTable<IssueRealtimeRow>(
      'issue-watcher-update',
      'issue',
      'UPDATE',
      (payload) => {
        handleIssueEvent(payload.new).catch(logError('update'));
      }
    );
  }

  function stop(): void {
    isRunning = false;
    unsubscribeInsert?.();
    unsubscribeInsert = null;
    unsubscribeUpdate?.();
    unsubscribeUpdate = null;
  }

  function logError(context: string) {
    return (err: unknown) => {
      logger.error({
        event: 'issue_watcher.error',
        context,
        error: err instanceof Error ? err.message : String(err),
      });
    };
  }

  // ─── Dispatch Logic ───────────────────────────────────────────────────

  async function handleIssueEvent(row: IssueRealtimeRow): Promise<void> {
    const issueId = row.id;
    const projectId = row.project_id;

    // Deduplicate — skip if already being dispatched.
    if (inFlight.has(issueId)) {
      logger.info({
        event: 'issue_watcher.skipped',
        reason: 'already_in_flight',
        issueId,
      });
      return;
    }

    inFlight.add(issueId);
    try {
      await dispatch(issueId, projectId, row);
    } finally {
      inFlight.delete(issueId);
    }
  }

  async function dispatch(
    issueId: string,
    projectId: string,
    row: IssueRealtimeRow
  ): Promise<void> {
    // Guard: skip closed issues.
    if (row.is_closed) {
      logger.info({
        event: 'issue_watcher.skipped',
        reason: 'issue_closed',
        issueId,
      });
      return;
    }

    // Guard 1: status must resolve to the "open" status key.
    const openStatusId = await resolveOpenStatusId(projectId);
    if (!openStatusId) {
      logger.info({
        event: 'issue_watcher.skipped',
        reason: 'config_missing',
        issueId,
        projectId,
      });
      return;
    }

    if (row.status_id !== openStatusId) {
      logger.info({
        event: 'issue_watcher.skipped',
        reason: 'status_not_open',
        issueId,
        statusId: row.status_id,
        openStatusId,
      });
      return;
    }

    // Guard 2: no active (non-terminal) pipeline_run for this issue.
    const activeRuns = await db
      .select({ id: pipelineRun.id })
      .from(pipelineRun)
      .where(
        and(
          eq(pipelineRun.issueId, issueId),
          notInArray(pipelineRun.status, TERMINAL_RUN_STATUSES)
        )
      );

    if (activeRuns.length > 0) {
      logger.info({
        event: 'issue_watcher.skipped',
        reason: 'active_run_exists',
        issueId,
        activeRunId: activeRuns[0]?.id,
      });
      return;
    }

    // Guard 3: project must have a defaultPipelineId.
    const [proj] = await db
      .select({ defaultPipelineId: project.defaultPipelineId })
      .from(project)
      .where(eq(project.id, projectId));

    if (!proj?.defaultPipelineId) {
      logger.info({
        event: 'issue_watcher.skipped',
        reason: 'no_default_pipeline',
        issueId,
        projectId,
      });
      return;
    }

    const pipelineId = proj.defaultPipelineId;

    // All guards passed — insert the pipeline_run at pending.
    const [run] = await db
      .insert(pipelineRun)
      .values({
        pipelineId,
        issueId,
        status: 'pending',
      })
      .returning();

    if (!run) {
      logger.error({
        event: 'issue_watcher.error',
        context: 'insert_pipeline_run',
        error: 'insert returned no row',
        issueId,
        pipelineId,
      });
      return;
    }

    logger.info({
      event: 'issue_watcher.dispatched',
      issueId,
      pipelineId,
      runId: run.id,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Resolve the UUID of the "open" issue status for the given project.
   * Uses config key `issues.status.on_create_key` — the same key used when
   * issues are created to mark their initial status.
   * Returns null when config is missing (fail-safe skip).
   */
  async function resolveOpenStatusId(
    projectId: string
  ): Promise<string | null> {
    try {
      const CONFIG_KEY = 'issues.status.on_create_key';

      const [config] = await db
        .select({ value: configEntry.value })
        .from(configEntry)
        .where(
          and(
            eq(configEntry.projectId, projectId),
            eq(configEntry.key, CONFIG_KEY)
          )
        );

      if (!config || typeof config.value !== 'string') return null;

      // config.value is stored as a JSON string (e.g. `"open"`), strip quotes.
      const statusKey = config.value.replace(/^"|"$/g, '');

      const [status] = await db
        .select({ id: issueStatus.id })
        .from(issueStatus)
        .where(
          and(
            eq(issueStatus.projectId, projectId),
            eq(issueStatus.key, statusKey)
          )
        );

      return status?.id ?? null;
    } catch {
      return null;
    }
  }

  return {
    start,
    stop,
    get running() {
      return isRunning;
    },
  };
}
