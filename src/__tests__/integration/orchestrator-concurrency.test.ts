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
import { DEFAULT_EVENT_ORCHESTRATOR_CONFIG } from '@/core/orchestrator/event-orchestrator';
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

/**
 * FLX-275 — deterministic non-interference from the live operator daemon.
 *
 * The daemon's orchestrator reacts to every committed pipeline_run INSERT at
 * status='pending'. Two of its paths mutate this suite's fixtures mid-burst:
 *   - zero-stages: `handleNewRun` marks a stage-less run failed with an
 *     UNCONDITIONAL update — it can stomp a run this test just flipped to
 *     running, dropping the global running count and inflating myWins
 *     (observed: myWins=3 with MAX=2 on a post-merge gate run);
 *   - claim: with stages present, the daemon claims pending runs up to its
 *     own limit and launches them.
 * Isolation, with the daemon kept running:
 *   1. the fixture pipeline gets ONE stage, so the daemon never takes the
 *      zero-stages stomp path for this suite's runs;
 *   2. DAEMON_SATURATION 'running' blocker rows (count = the daemon's real
 *      default limit, exported from event-orchestrator) keep the global
 *      running count at the daemon's ceiling for the whole suite, so its
 *      tryAcquireRunningSlot always returns false and it never touches our
 *      rows. The test's own acquisitions use MAX = saturation + headroom.
 */
const DAEMON_SATURATION = DEFAULT_EVENT_ORCHESTRATOR_CONFIG.maxConcurrentRuns;

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

  // Guard 1: a stage, so the daemon never takes the zero-stages stomp path
  // on this suite's pending runs.
  await db.insert(schema.pipelineStage).values({
    pipelineId: pipeline.id,
    name: 'research',
    sortOrder: 0,
    driver: 'claude-code',
    gateMode: 'auto',
    maxRetries: 0,
  });

  // Guard 2: saturate the daemon's claim limit BEFORE any pending run
  // exists, so its tryAcquireRunningSlot always loses. Blocker rows have no
  // stage_runs (no recovery sweep touches them) and are torn down with the
  // org fixture in afterAll.
  await db.insert(schema.pipelineRun).values(
    Array.from({ length: DAEMON_SATURATION }, () => ({
      pipelineId: pipeline.id,
      status: 'running',
      startedAt: new Date(),
    }))
  );
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
    // N > headroom so a regression to the pre-fix race (all N flipping)
    // is easy to detect. The CAS counts status='running' globally, so the
    // DAEMON_SATURATION blocker rows occupy slots throughout the burst:
    // MAX = saturation + HEADROOM means at most HEADROOM of MY runs can
    // flip. Pre-FLX-199 the stale-snapshot race let most of the 12 flip,
    // which still trips this assertion. Each acquisition serializes
    // through one Postgres advisory lock so wall time scales linearly
    // with N — keep N modest to stay well inside the test timeout on
    // Supabase pooler RTT.
    const N = 12;
    const HEADROOM = 2;
    const MAX = DAEMON_SATURATION + HEADROOM;

    const runs = await Promise.all(
      Array.from({ length: N }, () =>
        svc.createRun(pipelineId, PLACEHOLDER_ISSUE_ID)
      )
    );

    const acquisitions = await Promise.all(
      runs.map((r) => svc.tryAcquireRunningSlot(r.id, MAX))
    );

    const myWins = acquisitions.filter(Boolean).length;
    // Safety invariant: the CAS guarantees no more than HEADROOM of MY
    // runs can flip in any single concurrent acquisition burst — the
    // saturation rows hold the remaining slots for the whole burst (they
    // are this suite's own rows; nothing retires them mid-test). Before
    // FLX-199 myWins could exceed the limit under bursts; this assertion
    // catches a regression.
    expect(myWins).toBeLessThanOrEqual(HEADROOM);

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
