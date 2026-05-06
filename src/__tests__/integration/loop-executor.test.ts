import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopExecutorInput } from '@/core/agents/loop-executor';

vi.mock('@/adapters/langgraph/langgraph-stage-runner', () => ({
  runStageGraph: vi.fn(),
}));

import { runStageGraph } from '@/adapters/langgraph/langgraph-stage-runner';
import { runLoopExecutor } from '@/core/agents/loop-executor';

const mockRunStageGraph = vi.mocked(runStageGraph);

const BASE_INPUT: LoopExecutorInput = {
  stageRunId: 'srun-001',
  resultDocPath: '/tmp/test-result.json',
  artifactsDir: '/tmp/test-artifacts',
  prompt: 'Do the work.',
  driverCommand: 'npx',
  driverArgs: ['claude-code', '--headless'],
  until: 'VERDICT_PASS',
  maxIterations: 3,
  initResultDocScript: 'src/scripts/pipeline/init-result-doc.ts',
  ingestResultDocScript: 'src/scripts/pipeline/ingest-result-doc.ts',
};

const passIngestOutput = JSON.stringify({
  valid: true,
  doc: {
    issue: { id: 'i1', number: 1, title: 'T' },
    run: {
      pipelineRunId: 'p1',
      stageRunId: 's1',
      stage: 'implement',
      attempt: 1,
    },
    org: { id: 'o1', slug: 'org' },
    project: { id: 'proj1', slug: 'proj' },
    timing: { startedAt: '2026-05-03T00:00:00Z' },
    verdict: 'pass',
    summary: 'Done.',
  },
});

const failIngestOutput = JSON.stringify({
  valid: true,
  doc: {
    issue: { id: 'i1', number: 1, title: 'T' },
    run: {
      pipelineRunId: 'p1',
      stageRunId: 's1',
      stage: 'implement',
      attempt: 1,
    },
    org: { id: 'o1', slug: 'org' },
    project: { id: 'proj1', slug: 'proj' },
    timing: { startedAt: '2026-05-03T00:00:00Z' },
    verdict: 'fail',
    summary: 'Not done yet.',
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runLoopExecutor', () => {
  it('exits completed:true on first iteration when until:VERDICT_PASS and agent writes pass', async () => {
    mockRunStageGraph.mockResolvedValueOnce({ ingestOutput: passIngestOutput });

    const result = await runLoopExecutor(BASE_INPUT);

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.error).toBeUndefined();
    expect(mockRunStageGraph).toHaveBeenCalledTimes(1);
  });

  it('passes original stageRunId to runStageGraph (DB row must exist)', async () => {
    mockRunStageGraph.mockResolvedValueOnce({ ingestOutput: passIngestOutput });

    await runLoopExecutor(BASE_INPUT);

    expect(mockRunStageGraph).toHaveBeenCalledWith(
      expect.objectContaining({ stageRunId: 'srun-001' }),
      undefined,
      'srun-001_iter1'
    );
  });

  it('loops until condition met on a later iteration', async () => {
    mockRunStageGraph
      .mockResolvedValueOnce({ ingestOutput: failIngestOutput })
      .mockResolvedValueOnce({ ingestOutput: failIngestOutput })
      .mockResolvedValueOnce({ ingestOutput: passIngestOutput });

    const result = await runLoopExecutor(BASE_INPUT);

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(3);
    expect(mockRunStageGraph).toHaveBeenCalledTimes(3);
  });

  it('returns completed:false when maxIterations exhausted without condition met', async () => {
    mockRunStageGraph.mockResolvedValue({ ingestOutput: failIngestOutput });

    const result = await runLoopExecutor({ ...BASE_INPUT, maxIterations: 3 });

    expect(result.completed).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.error).toBeUndefined();
    expect(mockRunStageGraph).toHaveBeenCalledTimes(3);
  });

  it('returns completed:false with error when graph returns error', async () => {
    mockRunStageGraph.mockResolvedValueOnce({
      ingestOutput: '',
      error: 'prepare failed: ENOENT',
    });

    const result = await runLoopExecutor(BASE_INPUT);

    expect(result.completed).toBe(false);
    expect(result.error).toBe('prepare failed: ENOENT');
    expect(result.iterations).toBe(1);
  });

  it('returns completed:false with error when graph throws', async () => {
    mockRunStageGraph.mockRejectedValueOnce(new Error('subprocess crash'));

    const result = await runLoopExecutor(BASE_INPUT);

    expect(result.completed).toBe(false);
    expect(result.error).toContain('subprocess crash');
  });

  it('VERDICT_FAIL condition exits when agent writes fail', async () => {
    mockRunStageGraph.mockResolvedValueOnce({ ingestOutput: failIngestOutput });

    const result = await runLoopExecutor({
      ...BASE_INPUT,
      until: 'VERDICT_FAIL',
    });

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(1);
  });

  it('ALWAYS condition runs all maxIterations and exits completed:true', async () => {
    mockRunStageGraph.mockResolvedValue({ ingestOutput: passIngestOutput });

    const result = await runLoopExecutor({
      ...BASE_INPUT,
      until: 'ALWAYS',
      maxIterations: 2,
    });

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(2);
    expect(mockRunStageGraph).toHaveBeenCalledTimes(2);
  });

  it('ISSUE_OUT_OF_ACTIVE_STATE is equivalent to VERDICT_PASS', async () => {
    mockRunStageGraph.mockResolvedValueOnce({ ingestOutput: passIngestOutput });

    const result = await runLoopExecutor({
      ...BASE_INPUT,
      until: 'ISSUE_OUT_OF_ACTIVE_STATE',
    });

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(1);
  });
});
