export interface EventPayload {
  [key: string]: unknown;
}

export interface CreateEventInput {
  stageRunId: string;
  type: string;
  payload: EventPayload;
}

export type EventType =
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
  | 'stage_skipped'
  | 'stage_rework'
  | 'gate_evaluated'
  | 'gate_hold'
  | 'gate_approved'
  | 'gate_rejected'
  | 'output'
  | 'cost_recorded'
  | 'pipeline_started'
  | 'pipeline_completed'
  | 'pipeline_failed'
  | 'pipeline_cancelled';
