export type PipelineRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StageRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'skipped'
  | 'rework';

export const PIPELINE_RUN_TRANSITIONS: Record<
  PipelineRunStatus,
  PipelineRunStatus[]
> = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export const STAGE_RUN_TRANSITIONS: Record<StageRunStatus, StageRunStatus[]> = {
  queued: ['running', 'skipped'],
  running: ['completed', 'failed', 'cancelled', 'timed_out'],
  completed: ['rework'],
  failed: [],
  cancelled: [],
  timed_out: [],
  skipped: [],
  rework: ['queued'],
};

export interface CreatePipelineInput {
  projectId: string;
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpdatePipelineInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
}

export interface CreatePipelineStageInput {
  pipelineId: string;
  name: string;
  sortOrder: number;
  personaId?: string;
  driver?: string;
  timeoutSec?: number;
  maxRetries?: number;
  gateMode?: string;
  gateRules?: unknown;
}

export interface StageRunMetadata {
  provider?: string;
  model?: string;
  driver?: string;
  costUsd?: string;
  tokensIn?: number;
  tokensOut?: number;
}
