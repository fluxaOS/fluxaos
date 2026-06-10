import { isValidResultDoc } from '@/core/pipeline/result-doc';
import type { StageGraphRunner } from '@/core/ports/stage-graph-runner';

export type ParallelAggregation =
  | 'all-pass'
  | 'any-pass'
  | 'majority-pass'
  | 'none';

export interface ParallelChild {
  id: string;
  skill: string;
  stageRunId: string;
  resultDocPath: string;
  artifactsDir: string;
  prompt: string;
  driverCommand: string;
  driverArgs: string[];
  env?: Record<string, string>;
  initResultDocScript: string;
  ingestResultDocScript: string;
}

export interface ParallelExecutorInput {
  groupStageRunId: string;
  pipelineRunId: string;
  stageId: string;
  children: ParallelChild[];
  aggregation: ParallelAggregation;
  stageGraphRunner: StageGraphRunner;
  initResultDocScript: string;
  ingestResultDocScript: string;
}

export interface ChildResult {
  id: string;
  stageRunId: string;
  verdict: 'pass' | 'fail';
  ingestOutput: string;
  error?: string;
}

export interface ParallelExecutorResult {
  verdict: 'pass' | 'fail';
  childResults: ChildResult[];
  ingestOutput: string;
  error?: string;
}

async function runChild(
  child: ParallelChild,
  stageGraphRunner: StageGraphRunner
): Promise<ChildResult> {
  const threadId = `${child.stageRunId}_parallel`;
  try {
    const graphResult = await stageGraphRunner.run(
      {
        stageRunId: child.stageRunId,
        resultDocPath: child.resultDocPath,
        artifactsDir: child.artifactsDir,
        prompt: child.prompt,
        driverCommand: child.driverCommand,
        driverArgs: child.driverArgs,
        env: child.env,
        initResultDocScript: child.initResultDocScript,
        ingestResultDocScript: child.ingestResultDocScript,
      },
      threadId
    );

    if (graphResult.error) {
      return {
        id: child.id,
        stageRunId: child.stageRunId,
        verdict: 'fail',
        ingestOutput: graphResult.ingestOutput,
        error: graphResult.error,
      };
    }

    let ingestResult: { valid: boolean; doc?: Record<string, unknown> };
    try {
      ingestResult = JSON.parse(graphResult.ingestOutput) as {
        valid: boolean;
        doc?: Record<string, unknown>;
      };
    } catch {
      ingestResult = { valid: false };
    }

    const doc =
      ingestResult.valid &&
      ingestResult.doc &&
      isValidResultDoc(ingestResult.doc)
        ? ingestResult.doc
        : null;

    const verdict: 'pass' | 'fail' = doc?.verdict === 'pass' ? 'pass' : 'fail';

    return {
      id: child.id,
      stageRunId: child.stageRunId,
      verdict,
      ingestOutput: graphResult.ingestOutput,
    };
  } catch (err) {
    return {
      id: child.id,
      stageRunId: child.stageRunId,
      verdict: 'fail',
      ingestOutput: '',
      error: `child ${child.id} threw: ${String(err)}`,
    };
  }
}

function aggregate(
  childResults: ChildResult[],
  aggregation: ParallelAggregation
): 'pass' | 'fail' {
  const passCount = childResults.filter((r) => r.verdict === 'pass').length;
  const total = childResults.length;

  switch (aggregation) {
    case 'all-pass':
      return passCount === total ? 'pass' : 'fail';
    case 'any-pass':
      return passCount >= 1 ? 'pass' : 'fail';
    case 'majority-pass':
      return passCount > total / 2 ? 'pass' : 'fail';
    case 'none':
      return 'pass';
    default:
      return 'fail';
  }
}

export async function runParallelExecutor(
  input: ParallelExecutorInput
): Promise<ParallelExecutorResult> {
  const settled = await Promise.allSettled(
    input.children.map((child) => runChild(child, input.stageGraphRunner))
  );

  const childResults: ChildResult[] = settled.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const child = input.children[i];
    return {
      id: child.id,
      stageRunId: child.stageRunId,
      verdict: 'fail' as const,
      ingestOutput: '',
      error: `child ${child.id} rejected: ${String(result.reason)}`,
    };
  });

  const verdict = aggregate(childResults, input.aggregation);

  const passCount = childResults.filter((r) => r.verdict === 'pass').length;
  const summary =
    verdict === 'pass'
      ? `Parallel group passed: ${passCount}/${childResults.length} children passed`
      : `Parallel group failed: ${passCount}/${childResults.length} children passed`;

  const ingestOutput = JSON.stringify({
    valid: true,
    doc: {
      issue: { id: '', number: 0, title: '' },
      run: {
        pipelineRunId: input.pipelineRunId,
        stageRunId: input.groupStageRunId,
        stage: input.stageId,
        attempt: 1,
      },
      org: { id: '' },
      project: { id: '' },
      timing: { startedAt: new Date().toISOString() },
      verdict,
      summary,
    },
  });

  const firstError = childResults.find((r) => r.error)?.error;

  return {
    verdict,
    childResults,
    ingestOutput,
    ...(firstError && verdict === 'fail' ? { error: firstError } : {}),
  };
}
