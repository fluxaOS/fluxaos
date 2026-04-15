// src/core/constants.ts

/**
 * Shared constants — single source of truth for all status strings,
 * event types, gate verdicts, defaults, and timeouts.
 *
 * Imported by both server-side code and UI components (read-only values).
 * Zero imports — this file has no dependencies.
 */

// ── Pipeline Run Statuses ──────────────────────────────────
export const PIPELINE_RUN_STATUS = {
  pending: 'pending',
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed_out',
  cancelled: 'cancelled',
  blocked: 'blocked',
} as const;

export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUS)[keyof typeof PIPELINE_RUN_STATUS];

export const PIPELINE_RUN_TERMINAL: ReadonlySet<string> = new Set([
  PIPELINE_RUN_STATUS.completed,
  PIPELINE_RUN_STATUS.failed,
  PIPELINE_RUN_STATUS.timed_out,
  PIPELINE_RUN_STATUS.cancelled,
]);

// ── Stage Run Statuses ─────────────────────────────────────
export const STAGE_RUN_STATUS = {
  pending: 'pending',
  launching: 'launching',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed_out',
  cancelled: 'cancelled',
} as const;

export type StageRunStatus = (typeof STAGE_RUN_STATUS)[keyof typeof STAGE_RUN_STATUS];

export const STAGE_RUN_TERMINAL: ReadonlySet<string> = new Set([
  STAGE_RUN_STATUS.completed,
  STAGE_RUN_STATUS.failed,
  STAGE_RUN_STATUS.timed_out,
  STAGE_RUN_STATUS.cancelled,
]);

// ── Event Types (written to `event` table) ─────────────────
export const EVENT_TYPE = {
  launched: 'launched',
  heartbeat: 'heartbeat',
  output: 'output',
  gate_checked: 'gate_checked',
  error: 'error',
  timed_out: 'timed_out',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

export type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

// ── Issue Event Types (written to `issue_event` table) ─────
export const ISSUE_EVENT_TYPE = {
  stage_started: 'stage_started',
  stage_completed: 'stage_completed',
  stage_failed: 'stage_failed',
  pipeline_completed: 'pipeline_completed',
  pipeline_failed: 'pipeline_failed',
  gate_hold: 'gate_hold',
  state_changed: 'state_changed',
  status_changed: 'status_changed',
} as const;

export type IssueEventType = (typeof ISSUE_EVENT_TYPE)[keyof typeof ISSUE_EVENT_TYPE];

// ── Gate Verdicts ──────────────────────────────────────────
export const GATE_VERDICT = {
  proceed: 'proceed',
  hold: 'hold',
  rework: 'rework',
  abort: 'abort',
} as const;

export type GateVerdict = (typeof GATE_VERDICT)[keyof typeof GATE_VERDICT];

// ── Gate Modes ─────────────────────────────────────────────
export const GATE_MODE = {
  auto: 'auto',
  rules: 'rules',
  hold: 'hold',
  manual: 'manual',
  skip: 'skip',
} as const;

export type GateMode = (typeof GATE_MODE)[keyof typeof GATE_MODE];

// ── Defaults ───────────────────────────────────────────────
export const DEFAULT_STAGE_TIMEOUT_SEC = 300;
export const DEFAULT_GATE_MODE = GATE_MODE.auto;
export const DEFAULT_SORT_STRATEGY = 'quality' as const;
export const KILL_GRACE_PERIOD_MS = 5_000;
export const ORCHESTRATOR_HEARTBEAT_MS = 5_000;

// ── Trigger Types ─────────────────────────────────────────
export const TRIGGER_TYPE = {
  manual: 'manual',
  automated: 'automated',
} as const;

export type TriggerType = (typeof TRIGGER_TYPE)[keyof typeof TRIGGER_TYPE];

// ── Output Formats ────────────────────────────────────────
export const OUTPUT_FORMAT = {
  stream_json: 'stream-json',
  text: 'text',
} as const;

export type OutputFormat = (typeof OUTPUT_FORMAT)[keyof typeof OUTPUT_FORMAT];
