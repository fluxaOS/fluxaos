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

export type PipelineRunStatus =
  (typeof PIPELINE_RUN_STATUS)[keyof typeof PIPELINE_RUN_STATUS];

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

export type StageRunStatus =
  (typeof STAGE_RUN_STATUS)[keyof typeof STAGE_RUN_STATUS];

export const STAGE_RUN_TERMINAL: ReadonlySet<string> = new Set([
  STAGE_RUN_STATUS.completed,
  STAGE_RUN_STATUS.failed,
  STAGE_RUN_STATUS.timed_out,
  STAGE_RUN_STATUS.cancelled,
]);

// ── Deploy Run Statuses (FLX-197) ──────────────────────────
export const DEPLOY_RUN_STATUS = {
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
} as const;

export type DeployRunStatus =
  (typeof DEPLOY_RUN_STATUS)[keyof typeof DEPLOY_RUN_STATUS];

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
  deploy_succeeded: 'deploy_succeeded',
  deploy_failed: 'deploy_failed',
  deploy_skipped: 'deploy_skipped',
  gate_hold: 'gate_hold',
  state_changed: 'state_changed',
  status_changed: 'status_changed',
  issue_created: 'issue_created',
  fields_updated: 'fields_updated',
  comment_added: 'comment_added',
  comment_edited: 'comment_edited',
  comment_deleted: 'comment_deleted',
} as const;

export type IssueEventType =
  (typeof ISSUE_EVENT_TYPE)[keyof typeof ISSUE_EVENT_TYPE];

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
export const DEFAULT_PROMPT_TRANSPORT = 'argv' as const;
export const DEFAULT_ISOLATION_PROVIDER = 'worktree' as const;

// ── System Actor ──────────────────────────────────────────
/** Canonical actor string for records created by the fluxaOS system itself. */
export const SYSTEM_ACTOR = 'fluxaos' as const;

// ── Internal Actors ───────────────────────────────────────
/** Canonical actor identifiers for internal fluxaOS subsystems. */
export const ACTOR = {
  orchestrator: 'orchestrator',
  stageRunner: 'stage-runner',
  manualRun: 'manual-run',
  deployBridge: 'deploy-bridge',
} as const;

export type Actor = (typeof ACTOR)[keyof typeof ACTOR];

// ── Config Keys ───────────────────────────────────────────
/** Config entry keys used for issue status/state lifecycle automation. */
export const CONFIG_KEY = {
  issueStatusOnCreate: 'issues.status.on_create_key',
  issueStatusOnEnqueued: 'issues.status.on_enqueued_key',
  issueStatusOnRunning: 'issues.status.on_running_key',
  issueStatusOnBlocked: 'issues.status.on_blocked_key',
  issueStatusOnCompleted: 'issues.status.on_completed_key',
} as const;

export type ConfigKey = (typeof CONFIG_KEY)[keyof typeof CONFIG_KEY];

/**
 * Global (scope=`'global'`, project_id=NULL) config_entry keys for runtime
 * settings that were previously read from env. The DB is the sole source of
 * truth; readers fail fast when a row is missing. A row with `value` set to
 * jsonb `null` is the explicit "use default in-project layout" choice.
 *
 * See docs/superpowers/specs/2026-05-11-config-classification-design.md.
 */
export const GLOBAL_CONFIG_KEY = {
  /** Absolute path override for worktree storage. FLX-222. */
  runtimeWorkspaceRoot: 'runtime.workspace_root',
  /** Absolute path override for per-run artifact directories. FLX-223. */
  runtimeArtifactsRoot: 'runtime.artifacts_root',
} as const;

export type GlobalConfigKey =
  (typeof GLOBAL_CONFIG_KEY)[keyof typeof GLOBAL_CONFIG_KEY];

// ── Trigger Types ─────────────────────────────────────────
export const TRIGGER_TYPE = {
  manual: 'manual',
  automated: 'automated',
} as const;

export type TriggerType = (typeof TRIGGER_TYPE)[keyof typeof TRIGGER_TYPE];

// ── Result Doc Verdicts ───────────────────────────────────
/** Verdict strings written into the result doc by AI workers. */
export const RESULT_DOC_VERDICT = {
  pass: 'pass',
  fail: 'fail',
  blocked: 'blocked',
} as const;

export type ResultDocVerdict =
  (typeof RESULT_DOC_VERDICT)[keyof typeof RESULT_DOC_VERDICT];

// ── Pipeline Routing Sentinels ─────────────────────────────
/** Special stage-name values stored in onPass/onFail/fallback columns. */
export const PIPELINE_SENTINEL = {
  /** Pipeline finished successfully. */
  complete: '__complete__',
  /** Pipeline is blocked waiting on human input. */
  blocked: '__blocked__',
} as const;
