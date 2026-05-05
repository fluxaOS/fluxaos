import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParallelExecutorInput } from '@/core/agents/parallel-executor';

vi.mock('@/adapters/langgraph/langgraph-stage-runner', () => ({
  runStageGraph: vi.fn(),
}));

import { runStageGraph } from '@/adapters/langgraph/langgraph-stage-runner';
import { runParallelExecutor } from '@/core/agents/parallel-executor';

const mockRunStageGraph = vi.mocked(runStageGraph);

function makeIngest(verdict: 'pass' | 'fail'): string {
  return JSON.stringify({
    valid: true,
    doc: {
      issue: { id: 'i1', number: 1, title: 'T' },
      run: {
        pipelineRunId: 'p1',
        stageRunId: 's1',
        stage: 'child-a',
        attempt: 1,
      },
      org: { id: 'o1', slug: 'org' },
      project: { id: 'proj1', slug: 'proj' },
      timing: { startedAt: '2026-05-04T00:00:00Z' },
      verdict,
      summary: verdict === 'pass' ? 'Done.' : 'Not done.',
    },
  });
}

const BASE_INPUT: ParallelExecutorInput = {
  groupStageRunId: 'group-srun-001',
  pipelineRunId: 'prun-001',
  stageId: 'parallel-review',
  children: [
    {
      id: 'child-a',
      skill: 'review',
      stageRunId: 'srun-child-a',
      resultDocPath: '/tmp/child-a/result.json',
      artifactsDir: '/tmp/child-a',
      prompt: 'Review the code.',
      driverCommand: 'npx',
      driverArgs: ['claude-code', '--headless'],
      initResultDocScript: 'src/scripts/pipeline/init-result-doc.ts',
      ingestResultDocScript: 'src/scripts/pipeline/ingest-result-doc.ts',
    },
    {
      id: 'child-b',
      skill: 'review',
      stageRunId: 'srun-child-b',
      resultDocPath: '/tmp/child-b/result.json',
      artifactsDir: '/tmp/child-b',
      prompt: 'Review the code.',
      driverCommand: 'npx',
      driverArgs: ['claude-code', '--headless'],
      initResultDocScript: 'src/scripts/pipeline/init-result-doc.ts',
      ingestResultDocScript: 'src/scripts/pipeline/ingest-result-doc.ts',
    },
  ],
  aggregation: 'all-pass',
  initResultDocScript: 'src/scripts/pipeline/init-result-doc.ts',
  ingestResultDocScript: 'src/scripts/pipeline/ingest-result-doc.ts',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runParallelExecutor', () => {
  describe('aggregation: all-pass', () => {
    it('returns pass when all children pass', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(BASE_INPUT);

      expect(result.verdict).toBe('pass');
      expect(result.childResults).toHaveLength(2);
      expect(result.childResults[0].verdict).toBe('pass');
      expect(result.childResults[1].verdict).toBe('pass');
    });

    it('returns fail when any child fails', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor(BASE_INPUT);

      expect(result.verdict).toBe('fail');
    });

    it('returns fail when all children fail', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor(BASE_INPUT);

      expect(result.verdict).toBe('fail');
    });
  });

  describe('aggregation: any-pass', () => {
    it('returns pass when at least one child passes', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'any-pass',
      });

      expect(result.verdict).toBe('pass');
    });

    it('returns fail when all children fail', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'any-pass',
      });

      expect(result.verdict).toBe('fail');
    });
  });

  describe('aggregation: majority-pass', () => {
    it('returns pass when more than half pass (2 of 3)', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'majority-pass',
        children: [
          ...BASE_INPUT.children,
          {
            id: 'child-c',
            skill: 'review',
            stageRunId: 'srun-child-c',
            resultDocPath: '/tmp/child-c/result.json',
            artifactsDir: '/tmp/child-c',
            prompt: 'Review the code.',
            driverCommand: 'npx',
            driverArgs: ['claude-code', '--headless'],
            initResultDocScript: 'src/scripts/pipeline/init-result-doc.ts',
            ingestResultDocScript: 'src/scripts/pipeline/ingest-result-doc.ts',
          },
        ],
      });

      expect(result.verdict).toBe('pass');
    });

    it('returns fail when exactly half pass (1 of 2)', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'majority-pass',
      });

      expect(result.verdict).toBe('fail');
    });
  });

  describe('aggregation: none', () => {
    it('always returns pass regardless of child verdicts', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'none',
      });

      expect(result.verdict).toBe('pass');
    });
  });

  describe('error handling', () => {
    it('treats a child with graph error as fail verdict', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: '', error: 'subprocess failed' })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(BASE_INPUT);

      expect(result.childResults[0].verdict).toBe('fail');
      expect(result.childResults[0].error).toBe('subprocess failed');
    });

    it('treats a child that throws as fail verdict', async () => {
      mockRunStageGraph
        .mockRejectedValueOnce(new Error('crash'))
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(BASE_INPUT);

      expect(result.childResults[0].verdict).toBe('fail');
      expect(result.childResults[0].error).toContain('crash');
    });

    it('exposes verdict: fail on childResults when child returns fail verdict with no error', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(BASE_INPUT);

      expect(result.childResults[0].verdict).toBe('fail');
      expect(result.childResults[0].error).toBeUndefined();
      expect(result.childResults[1].verdict).toBe('pass');
    });

    it('runs all children even when some fail (Promise.allSettled)', async () => {
      mockRunStageGraph
        .mockRejectedValueOnce(new Error('crash'))
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor({
        ...BASE_INPUT,
        aggregation: 'any-pass',
      });

      expect(mockRunStageGraph).toHaveBeenCalledTimes(2);
      expect(result.verdict).toBe('pass');
    });
  });

  describe('ingestOutput', () => {
    it('produces valid JSON with verdict and summary', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(BASE_INPUT);

      const parsed = JSON.parse(result.ingestOutput) as {
        valid: boolean;
        doc: { verdict: string; summary: string };
      };
      expect(parsed.valid).toBe(true);
      expect(parsed.doc.verdict).toBe('pass');
      expect(typeof parsed.doc.summary).toBe('string');
      expect(parsed.doc.summary.length).toBeGreaterThan(0);
    });

    it('uses distinct threadIds per child to prevent LangGraph checkpoint collision', async () => {
      mockRunStageGraph
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      await runParallelExecutor(BASE_INPUT);

      const calls = mockRunStageGraph.mock.calls;
      const threadIdA = calls[0][2];
      const threadIdB = calls[1][2];
      expect(threadIdA).not.toBe(threadIdB);
      expect(threadIdA).toContain('srun-child-a');
      expect(threadIdB).toContain('srun-child-b');
    });
  });
});
