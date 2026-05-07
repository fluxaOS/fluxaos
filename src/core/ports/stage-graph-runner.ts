export interface StageGraphInput {
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

export interface StageGraphResult {
  ingestOutput: string;
  error?: string;
}

export interface StageGraphRunner {
  run(input: StageGraphInput, threadId?: string): Promise<StageGraphResult>;
}
