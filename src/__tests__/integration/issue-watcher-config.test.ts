/**
 * Integration tests: FLX-270 issue-watcher fail-fast dispatch config.
 *
 * The IssueWatcher must refuse to start when any auto-dispatch-enabled
 * project (defaultPipelineId set) has a missing/invalid
 * `issues.status.on_create_key` config_entry or no matching issue_status
 * row — and must escalate (never silently skip) when the config breaks
 * at watch time.
 *
 * Real Supabase DB, no mocks. Every fixture is built inside a rolled-back
 * transaction so the (intentionally invalid) projects are never visible to
 * concurrently running suites that boot the daemon.
 */
import 'dotenv/config';
import { eq, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { consoleLogger } from '@/core/logger/console';
import {
  createIssueWatcher,
  IssueWatcherConfigError,
} from '@/core/orchestrator/issue-watcher';
import type {
  RealtimeProvider,
  RealtimeTableEvent,
} from '@/core/ports/realtime';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

afterAll(async () => {
  await provider.close();
});

function stamp(label: string): string {
  return `iw-cfg-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface CapturedSubscription {
  channel: string;
  table: string;
  event: string;
  cb: (payload: RealtimeTableEvent<unknown>) => void;
}

/**
 * Hand-rolled RealtimeProvider port implementation (same convention as
 * event-orchestrator-isolation.test.ts) — captures table subscriptions so
 * tests can both assert on them and inject events synchronously.
 */
function makeRealtimeStub() {
  const subscriptions: CapturedSubscription[] = [];
  const realtime: RealtimeProvider = {
    subscribe: () => () => undefined,
    subscribeToTable: (channelName, table, event, callback) => {
      subscriptions.push({
        channel: channelName,
        table,
        event,
        cb: callback as (payload: RealtimeTableEvent<unknown>) => void,
      });
      return () => undefined;
    },
    broadcast: async () => undefined,
  };
  return { realtime, subscriptions };
}

/**
 * Run `fn` inside a transaction that is ALWAYS rolled back. Fixture rows
 * (including deliberately invalid projects) are never committed, so other
 * suites booting the daemon concurrently can never observe them.
 */
async function inRollbackTx(
  fn: (tx: Database) => Promise<void>
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Database);
      tx.rollback();
    });
  } catch (err) {
    // The deliberate rollback is the expected exit path; anything else
    // (including assertion failures inside `fn`) must propagate.
    if (!(err instanceof TransactionRollbackError)) throw err;
  }
}

interface FixtureOptions {
  /** Insert the `issues.status.on_create_key` config row. Default true. */
  withConfig?: boolean;
  /** Value for the config row (jsonb). Default 'open'. */
  configValue?: unknown;
  /** Insert the matching `open` issue_status row. Default true. */
  withStatus?: boolean;
}

async function makeDispatchFixture(tx: Database, opts: FixtureOptions = {}) {
  const { withConfig = true, configValue = 'open', withStatus = true } = opts;
  const s = stamp('fix');

  const [org] = await tx
    .insert(schema.organization)
    .values({ name: s })
    .returning();
  const [teamRow] = await tx
    .insert(schema.team)
    .values({ orgId: org.id, name: `${s}-team` })
    .returning();
  const [projRow] = await tx
    .insert(schema.project)
    .values({
      orgId: org.id,
      teamId: teamRow.id,
      name: s,
      repoUrl: 'https://github.com/fluxaos/fixture',
      defaultBranch: 'main',
    })
    .returning();
  const [pipe] = await tx
    .insert(schema.pipeline)
    .values({ projectId: projRow.id, name: `${s}-pipe` })
    .returning();
  await tx
    .update(schema.project)
    .set({ defaultPipelineId: pipe.id })
    .where(eq(schema.project.id, projRow.id));

  let statusId: string | null = null;
  if (withStatus) {
    const [status] = await tx
      .insert(schema.issueStatus)
      .values({
        projectId: projRow.id,
        key: 'open',
        displayName: 'Open',
        sortOrder: 1,
      })
      .returning();
    statusId = status.id;
  }

  if (withConfig) {
    await tx.insert(schema.configEntry).values({
      scope: 'project',
      projectId: projRow.id,
      key: 'issues.status.on_create_key',
      value: configValue,
    });
  }

  return { org, projRow, pipe, statusId };
}

/** Add the catalog rows + one open issue needed for a dispatchable fixture. */
async function addOpenIssue(tx: Database, projectId: string, statusId: string) {
  const s = stamp('iss');
  const [state] = await tx
    .insert(schema.issueState)
    .values({
      projectId,
      key: 'new',
      displayName: 'New',
      color: '#22cc22',
      sortOrder: 1,
      isTerminal: false,
    })
    .returning();
  const [type] = await tx
    .insert(schema.issueType)
    .values({
      projectId,
      key: 'feature',
      displayName: 'Feature',
      color: '#0000ff',
      sortOrder: 1,
    })
    .returning();
  const [priority] = await tx
    .insert(schema.issuePriority)
    .values({
      projectId,
      key: 'high',
      displayName: 'High',
      color: '#ff0000',
      weight: 100,
    })
    .returning();
  const [issueRow] = await tx
    .insert(schema.issue)
    .values({
      projectId,
      number: 1,
      title: s,
      stateId: state.id,
      statusId,
      typeId: type.id,
      priorityId: priority.id,
      author: 'system',
    })
    .returning();
  return issueRow;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 60_000
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FLX-270 issue-watcher dispatch-config fail-fast', () => {
  it('start() rejects when the config_entry row is missing', async () => {
    await inRollbackTx(async (tx) => {
      await makeDispatchFixture(tx, { withConfig: false });
      const { realtime, subscriptions } = makeRealtimeStub();
      const fatals: unknown[] = [];
      const watcher = createIssueWatcher(tx, realtime, consoleLogger, (err) =>
        fatals.push(err)
      );

      await expect(watcher.start()).rejects.toThrow(IssueWatcherConfigError);
      await expect(watcher.start()).rejects.toThrow(
        /config_entry row not found/
      );
      expect(watcher.running).toBe(false);
      expect(subscriptions.length).toBe(0);
      expect(fatals.length).toBe(0);
    });
  }, 30_000);

  it('start() rejects when the config value is not a string', async () => {
    await inRollbackTx(async (tx) => {
      await makeDispatchFixture(tx, { configValue: 42 });
      const { realtime } = makeRealtimeStub();
      const watcher = createIssueWatcher(
        tx,
        realtime,
        consoleLogger,
        () => undefined
      );

      await expect(watcher.start()).rejects.toThrow(/not a string/);
      expect(watcher.running).toBe(false);
    });
  }, 30_000);

  it('start() rejects when no issue_status matches the configured key', async () => {
    await inRollbackTx(async (tx) => {
      await makeDispatchFixture(tx, { withStatus: false });
      const { realtime } = makeRealtimeStub();
      const watcher = createIssueWatcher(
        tx,
        realtime,
        consoleLogger,
        () => undefined
      );

      await expect(watcher.start()).rejects.toThrow(
        /issue_status row not found/
      );
      expect(watcher.running).toBe(false);
    });
  }, 30_000);

  it('start() resolves with valid config and the startup sweep dispatches an open issue', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await makeDispatchFixture(tx);
      if (!fixture.statusId) throw new Error('fixture statusId missing');
      const issueRow = await addOpenIssue(
        tx,
        fixture.projRow.id,
        fixture.statusId
      );

      const { realtime, subscriptions } = makeRealtimeStub();
      const fatals: unknown[] = [];
      const watcher = createIssueWatcher(tx, realtime, consoleLogger, (err) =>
        fatals.push(err)
      );

      await watcher.start();
      try {
        expect(watcher.running).toBe(true);
        expect(subscriptions.map((s) => s.event).sort()).toEqual([
          'INSERT',
          'UPDATE',
        ]);

        // The startup sweep runs fire-and-forget — poll for its dispatch.
        let runs: Array<{
          id: string;
          status: string;
          pipelineId: string | null;
        }> = [];
        await waitFor(async () => {
          runs = await tx
            .select({
              id: schema.pipelineRun.id,
              status: schema.pipelineRun.status,
              pipelineId: schema.pipelineRun.pipelineId,
            })
            .from(schema.pipelineRun)
            .where(eq(schema.pipelineRun.issueId, issueRow.id));
          return runs.length > 0;
        });

        expect(runs.length).toBe(1);
        expect(runs[0].status).toBe('pending');
        expect(runs[0].pipelineId).toBe(fixture.pipe.id);
        expect(fatals.length).toBe(0);
      } finally {
        watcher.stop();
      }
    });
    // Generous timeout: the awaited startup sweep walks every open issue in
    // the shared dev DB, which is slow when the full suite runs in parallel.
  }, 120_000);

  it('escalates via onFatal when the config row disappears at watch time', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await makeDispatchFixture(tx);
      if (!fixture.statusId) throw new Error('fixture statusId missing');
      const issueRow = await addOpenIssue(
        tx,
        fixture.projRow.id,
        fixture.statusId
      );

      const { realtime, subscriptions } = makeRealtimeStub();
      const fatals: unknown[] = [];
      const watcher = createIssueWatcher(tx, realtime, consoleLogger, (err) =>
        fatals.push(err)
      );

      await watcher.start();
      try {
        // Wait for the fire-and-forget sweep to dispatch our issue, then
        // remove the pending run it created so the active-run guard cannot
        // short-circuit before config resolution.
        await waitFor(async () => {
          const rows = await tx
            .select({ id: schema.pipelineRun.id })
            .from(schema.pipelineRun)
            .where(eq(schema.pipelineRun.issueId, issueRow.id));
          return rows.length > 0;
        });
        await tx
          .delete(schema.pipelineRun)
          .where(eq(schema.pipelineRun.issueId, issueRow.id));

        // Config deleted mid-flight — the next dispatch must escalate.
        await tx
          .delete(schema.configEntry)
          .where(eq(schema.configEntry.projectId, fixture.projRow.id));

        const insertSub = subscriptions.find((s) => s.event === 'INSERT');
        if (!insertSub) throw new Error('INSERT subscription not captured');
        insertSub.cb({
          eventType: 'INSERT',
          new: {
            id: issueRow.id,
            project_id: issueRow.projectId,
            number: issueRow.number,
            status_id: issueRow.statusId,
            state_id: issueRow.stateId,
            is_closed: issueRow.isClosed,
          },
          old: null,
        });

        await waitFor(() => fatals.length > 0);
        expect(fatals[0]).toBeInstanceOf(IssueWatcherConfigError);
        expect((fatals[0] as Error).message).toMatch(
          /config_entry row not found/
        );
      } finally {
        watcher.stop();
      }
    });
    // Generous timeout: see the valid-config test above.
  }, 120_000);
});
