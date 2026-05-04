import { existsSync, readFileSync } from 'node:fs';
import { runStageGraph } from '@/core/pipeline/langgraph-stage-runner';
import type { ResultDoc } from '@/core/pipeline/result-doc';
import { isValidResultDoc } from '@/core/pipeline/result-doc';

export interface LoopExecutorInput {
  stageRunId: string;
  resultDocPath: string;
  artifactsDir: string;
  prompt: string;
  driverCommand: string;
  driverArgs: string[];
  until: string;
  maxIterations: number;
  env?: Record<string, string>;
}

export interface LoopExecutorResult {
  completed: boolean;
  iterations: number;
  lastIngestOutput: string;
  error?: string;
}

function checkUntilCondition(until: string, doc: ResultDoc | null): boolean {
  if (!doc) return false;

  switch (until) {
    case 'ISSUE_OUT_OF_ACTIVE_STATE':
    case 'VERDICT_PASS':
      return doc.verdict === 'pass';
    case 'VERDICT_FAIL':
      return doc.verdict === 'fail';
    case 'ALWAYS':
      // Never satisfied — only maxIterations stops the loop
      return false;
    default:
      return false;
  }
}

function readResultDoc(path: string): ResultDoc | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return isValidResultDoc(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function runLoopExecutor(
  input: LoopExecutorInput
): Promise<LoopExecutorResult> {
  let lastIngestOutput = '';

  for (let n = 1; n <= input.maxIterations; n++) {
    const iterStageRunId = `${input.stageRunId}_iter${n}`;

    let graphResult: { ingestOutput: string; error?: string };
    try {
      graphResult = await runStageGraph({
        stageRunId: iterStageRunId,
        resultDocPath: input.resultDocPath,
        artifactsDir: input.artifactsDir,
        prompt: input.prompt,
        driverCommand: input.driverCommand,
        driverArgs: input.driverArgs,
        env: input.env,
      });
    } catch (err) {
      return {
        completed: false,
        iterations: n,
        lastIngestOutput,
        error: `iteration ${n} threw: ${String(err)}`,
      };
    }

    lastIngestOutput = graphResult.ingestOutput;

    if (graphResult.error) {
      return {
        completed: false,
        iterations: n,
        lastIngestOutput,
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
        : readResultDoc(input.resultDocPath);

    if (checkUntilCondition(input.until, doc)) {
      return {
        completed: true,
        iterations: n,
        lastIngestOutput,
      };
    }
  }

  return {
    completed: false,
    iterations: input.maxIterations,
    lastIngestOutput,
  };
}
