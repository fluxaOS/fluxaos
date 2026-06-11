/**
 * IssueWatcher — subscribes to Supabase Realtime INSERT + UPDATE on the
 * `issue` table and auto-dispatches a pipeline_run whenever:
 *
 *   1. The issue's project has a `defaultPipelineId` configured.
 *   2. The issue's statusId resolves to the "open" status (config key
 *      `issues.status.on_create_key`).
 *   3. No active (non-terminal) pipeline_run exists for the issue.
 *   4. The issue is not already being dispatched (in-memory dedupe set).
 *
 * The inserted pipeline_run sits at `status = 'pending'`; the existing
 * EventOrchestrator Realtime subscription picks it up automatically.
 *
 * FLX-270 — fail-fast contract (Invariant 9 / ARCHITECTURAL_STANDARDS §2):
 *   - `start()` VALIDATES the dispatch config for every auto-dispatch-enabled
 *     project (defaultPipelineId set) before subscribing. Missing/unparsable
 *     `issues.status.on_create_key` or a failed status lookup throws
 *     `IssueWatcherConfigError` — the daemon refuses to start.
 *   - Watch-time failures (config deleted mid-flight, DB errors during a
 *     lookup) are never swallowed: the error boundary logs
 *     `issue_watcher.fatal` and invokes the injected `onFatal` (the daemon
 *     exits non-zero). No catch-and-continue, no silent null.
 */
import { and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import {
  CONFIG_KEY,
  PIPELINE_RUN_STATUS,
  PIPELINE_RUN_TERMINAL,
} from '@/core/constants';
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

export interface IssueWatcher {
  /**
   * Validate dispatch config for every auto-dispatch-enabled project, then
   * subscribe and run the startup sweep. Rejects with
   * `IssueWatcherConfigError` when any enabled project's config is
   * missing/invalid — callers (the daemon) must treat that as fatal.
   */
  start(): Promise<void>;
  stop(): void;
  readonly running: boolean;
}

/**
 * Error raised when the auto-dispatch config for a project is missing or
 * invalid: no `issues.status.on_create_key` config_entry row, a non-string
 * value, or no issue_status row matching the configured key. Thrown at
 * `start()` (daemon refuses to boot) and at watch time (escalated via
 * `onFatal`) — per ARCHITECTURAL_STANDARDS.md §2 there is no fallback.
 */
export class IssueWatcherConfigError extends Error {
  readonly projectId: string;
  constructor(projectId: string, detail: string) {
    super(
      `Auto-dispatch config invalid for project ${projectId}: ${detail}. ` +
        `Every project with a default pipeline must have a ` +
        `'${CONFIG_KEY.issueStatusOnCreate}' config_entry row whose value ` +
        `names an existing issue_status key. Run \`npm run db:seed\` or fix ` +
        `the row, then restart the daemon.`
    );
    this.name = 'IssueWatcherConfigError';
    this.projectId = projectId;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createIssueWatcher(
  db: Database,
  realtime: RealtimeProvider,
  logger: ConsoleLogger,
  /**
   * Invoked when a watch-time dispatch fails (config error, DB error). The
   * daemon passes a handler that logs and exits non-zero — errors here must
   * never be silently absorbed.
   */
  onFatal: (err: unknown) => void
): IssueWatcher {
  let unsubscribeInsert: Unsubscribe | null = null;
  let unsubscribeUpdate: Unsubscribe | null = null;
  let isRunning = false;

  /** Issue IDs currently being dispatched — prevents concurrent double-inserts. */
  const inFlight = new Set<string>();

  // ─── Realtime Subscription ────────────────────────────────────────────

  async function start(): Promise<void> {
    if (isRunning) return;

    // FLX-270: fail fast — a project configured for auto-dispatch with
    // missing/invalid dispatch config refuses to start the watcher (and
    // therefore the daemon) rather than silently never dispatching.
    await validateDispatchConfig();
    isRunning = true;

    unsubscribeInsert = realtime.subscribeToTable<IssueRealtimeRow>(
      'issue-watcher-insert',
      'issue',
      'INSERT',
      (payload) => {
        handleIssueEvent(payload.new).catch(escalate('insert'));
      }
    );

    unsubscribeUpdate = realtime.subscribeToTable<IssueRealtimeRow>(
      'issue-watcher-update',
      'issue',
      'UPDATE',
      (payload) => {
        handleIssueEvent(payload.new).catch(escalate('update'));
      }
    );

    // Fire-and-forget so daemon boot time doesn't scale with open-issue
    // count; sweep failures still escalate (daemon exits) — never swallowed.
    startupSweep().catch(escalate('startup_sweep'));
  }

  function stop(): void {
    isRunning = false;
    unsubscribeInsert?.();
    unsubscribeInsert = null;
    unsubscribeUpdate?.();
    unsubscribeUpdate = null;
  }

  /**
   * Watch-time error boundary. Never swallows: logs loudly, then hands the
   * error to `onFatal` so the daemon can crash with a non-zero exit. A
   * dispatch failure means auto-dispatch is broken — continuing silently
   * would violate the no-fallbacks rule (FLX-270).
   */
  function escalate(context: string) {
    return (err: unknown) => {
      logger.error({
        event: 'issue_watcher.fatal',
        context,
        error: err instanceof Error ? err.message : String(err),
      });
      onFatal(err);
    };
  }

  /**
   * Resolve + validate the dispatch config for every project that has a
   * defaultPipelineId (i.e. every project auto-dispatch will act on).
   * Throws `IssueWatcherConfigError` on the first invalid project.
   */
  async function validateDispatchConfig(): Promise<void> {
    const enabledProjects = await db
      .select({ id: project.id })
      .from(project)
      .where(isNotNull(project.defaultPipelineId));

    for (const proj of enabledProjects) {
      await resolveOpenStatusId(proj.id);
    }

    logger.info({
      event: 'issue_watcher.dispatch_config_validated',
      projects: enabledProjects.length,
    });
  }

  // ─── Dispatch Logic ───────────────────────────────────────────────────

  /**
   * On startup, dispatch any open issues that have no active pipeline_run.
   * Catches issues that were created or updated while the daemon was down —
   * their Realtime events already fired before the subscription was established.
   */
  async function startupSweep(): Promise<void> {
    // Find all open issues with a non-null project_id.
    const openIssues = await db
      .select({
        id: issue.id,
        projectId: issue.projectId,
        number: issue.number,
        statusId: issue.statusId,
        stateId: issue.stateId,
        isClosed: issue.isClosed,
      })
      .from(issue)
      .where(eq(issue.isClosed, false));

    if (openIssues.length === 0) {
      logger.info({
        event: 'issue_watcher.startup_sweep_complete',
        dispatched: 0,
      });
      return;
    }

    // Exclude issues that already have an active (non-terminal) run.
    const issueIds = openIssues.map((r) => r.id);
    const activeRunIssueIds = await db
      .select({ issueId: pipelineRun.issueId })
      .from(pipelineRun)
      .where(
        and(
          inArray(pipelineRun.issueId, issueIds),
          notInArray(pipelineRun.status, [...PIPELINE_RUN_TERMINAL])
        )
      );
    const blocked = new Set(
      activeRunIssueIds
        .map((r) => r.issueId)
        .filter((id): id is string => id !== null)
    );

    let dispatched = 0;
    for (const row of openIssues) {
      if (blocked.has(row.id)) continue;
      // Re-use the same dispatch path as the Realtime handler.
      // Shape the DB row into IssueRealtimeRow (snake_case columns).
      const realtimeRow: IssueRealtimeRow = {
        id: row.id,
        project_id: row.projectId,
        number: row.number,
        status_id: row.statusId,
        state_id: row.stateId,
        is_closed: row.isClosed,
      };
      await handleIssueEvent(realtimeRow);
      dispatched++;
    }

    logger.info({ event: 'issue_watcher.startup_sweep_complete', dispatched });
  }

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
      await dispatch(issueId, projectId);
    } finally {
      inFlight.delete(issueId);
    }
  }

  async function dispatch(issueId: string, projectId: string): Promise<void> {
    // FLX-266: Realtime payloads are point-in-time snapshots that can arrive
    // after the issue has been closed or re-statused (e.g. an e2e reset
    // parking the seed issues). Re-read the row and decide on CURRENT state —
    // never on the payload's stale status.
    const [fresh] = await db
      .select({
        statusId: issue.statusId,
        isClosed: issue.isClosed,
      })
      .from(issue)
      .where(eq(issue.id, issueId));

    if (!fresh) {
      logger.info({
        event: 'issue_watcher.skipped',
        reason: 'issue_missing',
        issueId,
      });
      return;
    }

    const row = { is_closed: fresh.isClosed, status_id: fresh.statusId };

    // Guard: skip closed issues.
    if (row.is_closed) {
      logger.info({
        event: 'issue_watcher.skipped',
        reason: 'issue_closed',
        issueId,
      });
      return;
    }

    // Guard 1: project must have a defaultPipelineId. Checked FIRST (FLX-270)
    // so projects that are legitimately not auto-dispatch-enabled skip before
    // any dispatch-config resolution — config errors below are always real.
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

    // Guard 2: status must resolve to the "open" status key. Throws
    // IssueWatcherConfigError when the config is missing/invalid — escalated
    // by the caller's error boundary, never skipped silently.
    const openStatusId = await resolveOpenStatusId(projectId);

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

    // Guard 3: no active (non-terminal) pipeline_run for this issue.
    const activeRuns = await db
      .select({ id: pipelineRun.id })
      .from(pipelineRun)
      .where(
        and(
          eq(pipelineRun.issueId, issueId),
          notInArray(pipelineRun.status, [...PIPELINE_RUN_TERMINAL])
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

    // All guards passed — insert the pipeline_run at pending.
    const [run] = await db
      .insert(pipelineRun)
      .values({
        pipelineId,
        issueId,
        status: PIPELINE_RUN_STATUS.pending,
      })
      .returning();

    if (!run) {
      throw new Error(
        `pipeline_run insert returned no row (issue ${issueId}, pipeline ${pipelineId})`
      );
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
   *
   * Throws `IssueWatcherConfigError` when the config row is missing, its
   * value is not a string, or no issue_status matches the configured key.
   * DB errors propagate untouched — there is no catch-and-continue (FLX-270).
   */
  async function resolveOpenStatusId(projectId: string): Promise<string> {
    const [config] = await db
      .select({ value: configEntry.value })
      .from(configEntry)
      .where(
        and(
          eq(configEntry.projectId, projectId),
          eq(configEntry.key, CONFIG_KEY.issueStatusOnCreate)
        )
      );

    if (!config) {
      throw new IssueWatcherConfigError(
        projectId,
        'config_entry row not found'
      );
    }
    if (typeof config.value !== 'string') {
      throw new IssueWatcherConfigError(
        projectId,
        `config value is not a string: ${typeof config.value} = ${JSON.stringify(config.value)}`
      );
    }

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

    if (!status) {
      throw new IssueWatcherConfigError(
        projectId,
        `issue_status row not found for key '${statusKey}'`
      );
    }

    return status.id;
  }

  return {
    start,
    stop,
    get running() {
      return isRunning;
    },
  };
}
