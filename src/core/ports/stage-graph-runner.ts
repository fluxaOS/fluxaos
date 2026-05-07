export interface StageGraphInput {
  stageRunId: string;
  resultDocPath: string;
  artifactsDir: string;
  prompt: string;
  driverCommand: string;
  driverArgs: string[];
  env?: Record<string, string>;
  /**
   * Working directory for the driver subprocess. Required for stages that
   * mutate a worktree — without it the driver runs in the daemon's cwd and
   * any file edits land in the wrong place.
   */
  cwd?: string;
  initResultDocScript: string;
  ingestResultDocScript: string;
}

export interface StageGraphResult {
  ingestOutput: string;
  error?: string;
}

export interface StageGraphRunner {
  run(input: StageGraphInput, threadId?: string): Promise<StageGraphResult>;
}
