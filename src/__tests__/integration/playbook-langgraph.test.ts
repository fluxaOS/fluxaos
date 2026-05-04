import { describe, expect, it } from 'vitest';
import { buildStageGraph } from '@/core/pipeline/langgraph-stage-runner';

describe('buildStageGraph', () => {
  it('returns a compiled graph with invoke method', () => {
    const graph = buildStageGraph({
      stageRunId: 'test-id',
      resultDocPath: '/tmp/test.json',
      artifactsDir: '/tmp/artifacts',
      prompt: 'Test prompt.',
      driverCommand: 'echo',
      driverArgs: ['hello'],
    });
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
  });
});
