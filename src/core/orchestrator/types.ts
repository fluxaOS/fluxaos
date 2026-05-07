/**
 * Orchestrator types — shared across the pipeline engine.
 *
 * Status types and terminal sets are re-exported from constants.ts.
 * Domain-specific interfaces (routing, job payloads, config) live here.
 */

// Re-export status types and sets from the single source of truth
export {
  DEFAULT_STAGE_TIMEOUT_SEC,
  EVENT_TYPE,
  type EventType as StageEventType,
  GATE_MODE,
  GATE_VERDICT,
  ISSUE_EVENT_TYPE,
  ORCHESTRATOR_HEARTBEAT_MS,
  PIPELINE_RUN_STATUS,
  PIPELINE_RUN_TERMINAL,
  type PipelineRunStatus,
  STAGE_RUN_STATUS,
  STAGE_RUN_TERMINAL,
  type StageRunStatus,
} from '@/core/constants';

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
