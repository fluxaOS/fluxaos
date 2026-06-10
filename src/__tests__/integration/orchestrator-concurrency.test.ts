/**
 * Integration test: pipeline-run concurrency CAS (FLX-199).
 *
 * Fires N>maxConcurrent slot acquisitions in parallel and verifies that
 * the database never has more than maxConcurrent rows at status='running'.
 *
 * The race fixed here is in PipelineRunService.tryAcquireRunningSlot:
 * before FLX-199, event-orchestrator read getRunningRuns() and then
 * called updateRunStatus() across two awaits; with N concurrent INSERT
 * events arriving at near-identical times, all N would pass the count
 * check against the same stale snapshot and all flip to running.
 *
 * Hits real Supabase. No mocks.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import {
  createOrganizationService,
  createPipelineService,
  createProjectService,
  createUserService,
} from '@/core/services';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const RUN = Date.now();
const PLACEHOLDER_ISSUE_ID = '00000000-0000-0000-0000-000000000000';

let _orgId: string;
let pipelineId: string;

beforeAll(async () => {
  const org = await createOrganizationService(db).create({
    name: `ConcTestOrg-${RUN}`,
    settings: {},
  });
  _orgId = org.id;

  const user = await createUserService(db).create({
    orgId: org.id,
    email: `conc-test-${RUN}@test.local`,
    name: 'Conc User',
  });

  const [team] = await db
    .insert(schema.team)
    .values({
      orgId: org.id,
      name: `ConcTeam-${RUN}`,
    })
    .returning();

  const project = await createProjectService(db).create({
    orgId: org.id,
    teamId: team.id,
    userId: user.id,
    name: `ConcProject-${RUN}`,
  });

  const pipeline = await createPipelineService(db).create({
    projectId: project.id,
    name: `Conc Pipeline ${RUN}`,
  });
  pipelineId = pipeline.id;
});

afterAll(async () => {
  if (_orgId) await deleteOrgFixture(db, _orgId);
});

/**
 * Note on ambient activity: getRunningRuns() reads the global pipeline_run
 * table (FLX-148 — no per-tenant scope yet). Other agents/daemons hitting
 * the same dev Supabase concurrently can change the count between calls.
 * Tests below assert only the safety invariant of the CAS — that the
 * caller cannot flip more runs than the configured limit even when
 * ambient writes are racing. No assumption that ambient count is 0.
 */
describe('tryAcquireRunningSlot — concurrency CAS', () => {
  it('flips at most maxConcurrent runs under N>maxConcurrent parallel acquisitions', async () => {
    const svc = createPipelineRunService(db);
    // N > MAX so a regression to the pre-fix race (all N flipping)
    // is easy to detect. Pre-FLX-199 with N=12, MAX=2 the bug let
    // most of the 12 flip; post-fix at most MAX (here 2) of MY runs
    // flip. Each acquisition serializes through one Postgres advisory
    // lock so wall time scales linearly with N — keep N modest to
    // stay well inside the test timeout on Supabase pooler RTT.
    const N = 12;
    const MAX = 2;

    const runs = await Promise.all(
      Array.from({ length: N }, () =>
        svc.createRun(pipelineId, PLACEHOLDER_ISSUE_ID)
      )
    );

    const acquisitions = await Promise.all(
      runs.map((r) => svc.tryAcquireRunningSlot(r.id, MAX))
    );

    const myWins = acquisitions.filter(Boolean).length;
    // Safety invariant: the CAS guarantees no more than MAX of MY runs
    // can flip in any single concurrent acquisition burst, regardless
    // of ambient running runs (ambient counts toward the limit, so
    // myWins can be anywhere in [0, MAX]). Before FLX-199 myWins could
    // exceed MAX under bursts; this assertion catches a regression.
    expect(myWins).toBeLessThanOrEqual(MAX);

    for (const r of runs) await svc.completeRun(r.id, 'completed');
  }, 30_000);

  it('returns false when the run is no longer pending', async () => {
    const svc = createPipelineRunService(db);
    const run = await svc.createRun(pipelineId, PLACEHOLDER_ISSUE_ID);

    // Use a very large MAX so ambient activity does not interfere with
    // the first acquisition. The race we are testing is the WHERE
    // status='pending' guard, not the count check.
    const HUGE = 1_000_000;
    expect(await svc.tryAcquireRunningSlot(run.id, HUGE)).toBe(true);

    // Second acquisition for the same run is rejected by the
    // status='pending' guard in the conditional UPDATE.
    expect(await svc.tryAcquireRunningSlot(run.id, HUGE)).toBe(false);

    await svc.completeRun(run.id, 'completed');
  });
});
