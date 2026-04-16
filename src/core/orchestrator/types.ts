/**
 * Orchestrator types — shared across the pipeline engine.
 *
 * Status types and terminal sets are re-exported from constants.ts.
 * Domain-specific interfaces (routing, job payloads, config) live here.
 */

// Re-export status types and sets from the single source of truth
export {
  type PipelineRunStatus,
  type StageRunStatus,
  PIPELINE_RUN_TERMINAL,
  STAGE_RUN_TERMINAL,
  type EventType as StageEventType,
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
  EVENT_TYPE,
  ISSUE_EVENT_TYPE,
  GATE_VERDICT,
  GATE_MODE,
  DEFAULT_STAGE_TIMEOUT_SEC,
  ORCHESTRATOR_HEARTBEAT_MS,
} from '@/core/constants';

import { ORCHESTRATOR_HEARTBEAT_MS } from '@/core/constants';

// ─── Routing ───────────────────────────────────────────────────────────

/** Result of resolving routing for a stage. All from DB config. */
export interface ResolvedRouting {
  providerId: string;
  providerName: string;
  providerBaseUrl: string | null;
  providerApiKeyRef: string | null;
  modelId: string;
  modelIdentifier: string;
  driver: string;
  costPer1kInput: number;
  costPer1kOutput: number;
}

// ─── Job Payload ───────────────────────────────────────────────────────

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

// ─── Orchestrator Config ───────────────────────────────────────────────

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
  heartbeatIntervalMs: ORCHESTRATOR_HEARTBEAT_MS,
  maxConcurrentRuns: 5,
  maxConcurrentStages: 3,
  queueName: 'stage-execution',
};
