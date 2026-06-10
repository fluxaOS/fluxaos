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
  /**
   * Per-stage timeout in seconds. When set to a positive integer, the driver
   * subprocess is aborted after this many seconds. 0 / null / undefined means
   * no timeout (infinite — use only for stages that self-terminate).
   */
  timeoutSec?: number;
  /**
   * Invoked with the driver subprocess pid the moment it spawns (FLX-266).
   * The orchestrator persists it to stage_run.pid — cancel-by-pid and the
   * recovery sweep both read that column; without it neither works.
   */
  onDriverStart?: (pid: number) => void;
  /**
   * Invoked once per complete driver stdout line as it streams (FLX-266).
   * The orchestrator persists output events — the LiveOutput UI subscribes
   * to them via Realtime.
   */
  onDriverStdout?: (line: string) => void;
}

export interface StageGraphResult {
  ingestOutput: string;
  error?: string;
}

export interface StageGraphRunner {
  run(input: StageGraphInput, threadId?: string): Promise<StageGraphResult>;
}
