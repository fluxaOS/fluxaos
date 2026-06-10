import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopExecutorInput } from '@/core/agents/loop-executor';
import { runLoopExecutor } from '@/core/agents/loop-executor';
import type { StageGraphRunner } from '@/core/ports/stage-graph-runner';

function _makeRunner(impl: StageGraphRunner['run']): StageGraphRunner {
  return { run: vi.fn(impl) };
}

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
    org: { id: 'o1' },
    project: { id: 'proj1' },
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
    org: { id: 'o1' },
    project: { id: 'proj1' },
    timing: { startedAt: '2026-05-03T00:00:00Z' },
    verdict: 'fail',
    summary: 'Not done yet.',
  },
});

let mockRunner: { run: ReturnType<typeof vi.fn> };

function makeBaseInput(): LoopExecutorInput {
  return {
    stageRunId: 'srun-001',
    resultDocPath: '/tmp/test-result.json',
    artifactsDir: '/tmp/test-artifacts',
    prompt: 'Do the work.',
    driverCommand: 'npx',
    driverArgs: ['claude-code', '--headless'],
    until: 'VERDICT_PASS',
    maxIterations: 3,
    stageGraphRunner: mockRunner as StageGraphRunner,
    initResultDocScript: 'src/scripts/pipeline/init-result-doc.ts',
    ingestResultDocScript: 'src/scripts/pipeline/ingest-result-doc.ts',
    readFile: () => null,
  };
}

beforeEach(() => {
  mockRunner = { run: vi.fn() };
});

describe('runLoopExecutor', () => {
  it('exits completed:true on first iteration when until:VERDICT_PASS and agent writes pass', async () => {
    mockRunner.run.mockResolvedValueOnce({ ingestOutput: passIngestOutput });

    const result = await runLoopExecutor(makeBaseInput());

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.error).toBeUndefined();
    expect(mockRunner.run).toHaveBeenCalledTimes(1);
  });

  it('passes original stageRunId to runner (DB row must exist)', async () => {
    mockRunner.run.mockResolvedValueOnce({ ingestOutput: passIngestOutput });

    await runLoopExecutor(makeBaseInput());

    expect(mockRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ stageRunId: 'srun-001' }),
      'srun-001_iter1'
    );
  });

  it('loops until condition met on a later iteration', async () => {
    mockRunner.run
      .mockResolvedValueOnce({ ingestOutput: failIngestOutput })
      .mockResolvedValueOnce({ ingestOutput: failIngestOutput })
      .mockResolvedValueOnce({ ingestOutput: passIngestOutput });

    const result = await runLoopExecutor(makeBaseInput());

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(3);
    expect(mockRunner.run).toHaveBeenCalledTimes(3);
  });

  it('returns completed:false when maxIterations exhausted without condition met', async () => {
    mockRunner.run.mockResolvedValue({ ingestOutput: failIngestOutput });

    const result = await runLoopExecutor({
      ...makeBaseInput(),
      maxIterations: 3,
    });

    expect(result.completed).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.error).toBeUndefined();
    expect(mockRunner.run).toHaveBeenCalledTimes(3);
  });

  it('returns completed:false with error when graph returns error', async () => {
    mockRunner.run.mockResolvedValueOnce({
      ingestOutput: '',
      error: 'prepare failed: ENOENT',
    });

    const result = await runLoopExecutor(makeBaseInput());

    expect(result.completed).toBe(false);
    expect(result.error).toBe('prepare failed: ENOENT');
    expect(result.iterations).toBe(1);
  });

  it('returns completed:false with error when graph throws', async () => {
    mockRunner.run.mockRejectedValueOnce(new Error('subprocess crash'));

    const result = await runLoopExecutor(makeBaseInput());

    expect(result.completed).toBe(false);
    expect(result.error).toContain('subprocess crash');
  });

  it('VERDICT_FAIL condition exits when agent writes fail', async () => {
    mockRunner.run.mockResolvedValueOnce({ ingestOutput: failIngestOutput });

    const result = await runLoopExecutor({
      ...makeBaseInput(),
      until: 'VERDICT_FAIL',
    });

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(1);
  });

  it('ALWAYS condition runs all maxIterations and exits completed:true', async () => {
    mockRunner.run.mockResolvedValue({ ingestOutput: passIngestOutput });

    const result = await runLoopExecutor({
      ...makeBaseInput(),
      until: 'ALWAYS',
      maxIterations: 2,
    });

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(2);
    expect(mockRunner.run).toHaveBeenCalledTimes(2);
  });

  it('ISSUE_OUT_OF_ACTIVE_STATE is equivalent to VERDICT_PASS', async () => {
    mockRunner.run.mockResolvedValueOnce({ ingestOutput: passIngestOutput });

    const result = await runLoopExecutor({
      ...makeBaseInput(),
      until: 'ISSUE_OUT_OF_ACTIVE_STATE',
    });

    expect(result.completed).toBe(true);
    expect(result.iterations).toBe(1);
  });
});
