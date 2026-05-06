import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StageGraphRunner } from '@/core/ports/stage-graph-runner';
import type { ParallelExecutorInput } from '@/core/agents/parallel-executor';
import { runParallelExecutor } from '@/core/agents/parallel-executor';

function makeRunner(): { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn() };
}

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

let mockRunner: { run: ReturnType<typeof vi.fn> };

function makeBaseInput(): ParallelExecutorInput {
  return {
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
    stageGraphRunner: mockRunner as unknown as StageGraphRunner,
    initResultDocScript: 'src/scripts/pipeline/init-result-doc.ts',
    ingestResultDocScript: 'src/scripts/pipeline/ingest-result-doc.ts',
  };
}

beforeEach(() => {
  mockRunner = makeRunner();
});

describe('runParallelExecutor', () => {
  describe('aggregation: all-pass', () => {
    it('returns pass when all children pass', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(makeBaseInput());

      expect(result.verdict).toBe('pass');
      expect(result.childResults).toHaveLength(2);
      expect(result.childResults[0].verdict).toBe('pass');
      expect(result.childResults[1].verdict).toBe('pass');
    });

    it('returns fail when any child fails', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor(makeBaseInput());

      expect(result.verdict).toBe('fail');
    });

    it('returns fail when all children fail', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor(makeBaseInput());

      expect(result.verdict).toBe('fail');
    });
  });

  describe('aggregation: any-pass', () => {
    it('returns pass when at least one child passes', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor({
        ...makeBaseInput(),
        aggregation: 'any-pass',
      });

      expect(result.verdict).toBe('pass');
    });

    it('returns fail when all children fail', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor({
        ...makeBaseInput(),
        aggregation: 'any-pass',
      });

      expect(result.verdict).toBe('fail');
    });
  });

  describe('aggregation: majority-pass', () => {
    it('returns pass when more than half pass (2 of 3)', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const base = makeBaseInput();
      const result = await runParallelExecutor({
        ...base,
        aggregation: 'majority-pass',
        children: [
          ...base.children,
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
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor({
        ...makeBaseInput(),
        aggregation: 'majority-pass',
      });

      expect(result.verdict).toBe('fail');
    });
  });

  describe('aggregation: none', () => {
    it('always returns pass regardless of child verdicts', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') });

      const result = await runParallelExecutor({
        ...makeBaseInput(),
        aggregation: 'none',
      });

      expect(result.verdict).toBe('pass');
    });
  });

  describe('error handling', () => {
    it('treats a child with graph error as fail verdict', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: '', error: 'subprocess failed' })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(makeBaseInput());

      expect(result.childResults[0].verdict).toBe('fail');
      expect(result.childResults[0].error).toBe('subprocess failed');
    });

    it('treats a child that throws as fail verdict', async () => {
      mockRunner.run
        .mockRejectedValueOnce(new Error('crash'))
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(makeBaseInput());

      expect(result.childResults[0].verdict).toBe('fail');
      expect(result.childResults[0].error).toContain('crash');
    });

    it('exposes verdict: fail on childResults when child returns fail verdict with no error', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('fail') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(makeBaseInput());

      expect(result.childResults[0].verdict).toBe('fail');
      expect(result.childResults[0].error).toBeUndefined();
      expect(result.childResults[1].verdict).toBe('pass');
    });

    it('runs all children even when some fail (Promise.allSettled)', async () => {
      mockRunner.run
        .mockRejectedValueOnce(new Error('crash'))
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor({
        ...makeBaseInput(),
        aggregation: 'any-pass',
      });

      expect(mockRunner.run).toHaveBeenCalledTimes(2);
      expect(result.verdict).toBe('pass');
    });
  });

  describe('ingestOutput', () => {
    it('produces valid JSON with verdict and summary', async () => {
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      const result = await runParallelExecutor(makeBaseInput());

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
      mockRunner.run
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') })
        .mockResolvedValueOnce({ ingestOutput: makeIngest('pass') });

      await runParallelExecutor(makeBaseInput());

      const calls = mockRunner.run.mock.calls;
      const threadIdA = calls[0][1];
      const threadIdB = calls[1][1];
      expect(threadIdA).not.toBe(threadIdB);
      expect(threadIdA).toContain('srun-child-a');
      expect(threadIdB).toContain('srun-child-b');
    });
  });
});
