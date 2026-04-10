/**
 * Orchestrator types — shared across the pipeline engine.
 *
 * No hardcoded stage names, provider names, or harness names.
 * Everything is a string read from the database.
 */

// ─── Pipeline Run ──────────────────────────────────────────────────────────

/** Status of a pipeline run. Stored as text in DB — no TypeScript enum. */
export type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'blocked';

export const PIPELINE_RUN_TERMINAL: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'timed_out',
  'cancelled',
]);

// ─── Stage Run ─────────────────────────────────────────────────────────────

/** Status of a stage run. Stored as text in DB. */
export type StageRunStatus =
  | 'pending'
  | 'launching'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export const STAGE_RUN_TERMINAL: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'timed_out',
  'cancelled',
]);

// ─── Stage Events ──────────────────────────────────────────────────────────

/** Event types appended to the event store. */
export type StageEventType =
  | 'launched'
  | 'heartbeat'
  | 'output'
  | 'gate_checked'
  | 'error'
  | 'timed_out'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ─── Routing ───────────────────────────────────────────────────────────────

/** Result of resolving routing for a stage. All from DB config. */
export interface ResolvedRouting {
  providerId: string;
  providerName: string;
  providerBaseUrl: string | null;
  providerApiKeyRef: string | null;
  modelId: string;
  modelIdentifier: string;
  harness: string;
  costPer1kInput: number;
  costPer1kOutput: number;
}

// ─── Job Payload ───────────────────────────────────────────────────────────

/** Data enqueued to BullMQ for a stage execution job. */
export interface StageJobPayload {
  stageRunId: string;
  pipelineRunId: string;
  pipelineStageId: string;
  issueId: string;
  projectId: string;
  /** Resolved at enqueue time — worker doesn't query routing. */
  routing: ResolvedRouting;
  /** Prompt/skill template rendered at enqueue time. */
  prompt: string;
  /** Working directory for the subprocess. */
  cwd: string;
  /** Timeout in milliseconds. */
  timeoutMs: number;
}

// ─── Orchestrator Config ───────────────────────────────────────────────────

export interface OrchestratorConfig {
  /** How often the orchestrator checks for work (ms). */
  heartbeatIntervalMs: number;
  /** Max concurrent pipeline runs. */
  maxConcurrentRuns: number;
  /** Max concurrent stages across all runs. */
  maxConcurrentStages: number;
  /** Queue name for stage execution jobs. */
  queueName: string;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  heartbeatIntervalMs: 5_000,
  maxConcurrentRuns: 5,
  maxConcurrentStages: 3,
  queueName: 'stage-execution',
};
