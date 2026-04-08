import { describe, expect, it } from 'vitest';
import type { PipelineRunStatus, StageRunStatus } from '@/core/pipeline/types';
import {
  PIPELINE_RUN_TRANSITIONS,
  STAGE_RUN_TRANSITIONS,
} from '@/core/pipeline/types';

describe('pipeline run state machine', () => {
  it('allows pending → running transition', () => {
    expect(PIPELINE_RUN_TRANSITIONS.pending).toContain('running');
  });

  it('allows running → completed transition', () => {
    expect(PIPELINE_RUN_TRANSITIONS.running).toContain('completed');
  });

  it('allows running → failed transition', () => {
    expect(PIPELINE_RUN_TRANSITIONS.running).toContain('failed');
  });

  it('allows running → cancelled transition', () => {
    expect(PIPELINE_RUN_TRANSITIONS.running).toContain('cancelled');
  });

  it('does not allow completed → running transition', () => {
    expect(PIPELINE_RUN_TRANSITIONS.completed).not.toContain('running');
  });

  it('does not allow failed → running transition', () => {
    expect(PIPELINE_RUN_TRANSITIONS.failed).not.toContain('running');
  });

  it('terminal states have no transitions', () => {
    const terminals: PipelineRunStatus[] = ['completed', 'failed', 'cancelled'];
    for (const s of terminals) {
      expect(PIPELINE_RUN_TRANSITIONS[s]).toHaveLength(0);
    }
  });

  it('every target state exists as a key', () => {
    for (const targets of Object.values(PIPELINE_RUN_TRANSITIONS)) {
      for (const target of targets) {
        expect(PIPELINE_RUN_TRANSITIONS).toHaveProperty(target);
      }
    }
  });
});

describe('stage run state machine', () => {
  it('allows queued → running transition', () => {
    expect(STAGE_RUN_TRANSITIONS.queued).toContain('running');
  });

  it('allows running → completed transition', () => {
    expect(STAGE_RUN_TRANSITIONS.running).toContain('completed');
  });

  it('allows running → failed transition', () => {
    expect(STAGE_RUN_TRANSITIONS.running).toContain('failed');
  });

  it('allows completed → rework transition', () => {
    expect(STAGE_RUN_TRANSITIONS.completed).toContain('rework');
  });

  it('allows rework → queued transition (re-queue)', () => {
    expect(STAGE_RUN_TRANSITIONS.rework).toContain('queued');
  });

  it('allows queued → skipped transition', () => {
    expect(STAGE_RUN_TRANSITIONS.queued).toContain('skipped');
  });

  it('does not allow queued → completed directly', () => {
    expect(STAGE_RUN_TRANSITIONS.queued).not.toContain('completed');
  });

  it('failed and skipped are terminal', () => {
    const terminals: StageRunStatus[] = ['failed', 'skipped'];
    for (const s of terminals) {
      expect(STAGE_RUN_TRANSITIONS[s]).toHaveLength(0);
    }
  });

  it('rework cycle: completed → rework → queued → running → completed', () => {
    const path: StageRunStatus[] = [
      'completed',
      'rework',
      'queued',
      'running',
      'completed',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(STAGE_RUN_TRANSITIONS[path[i]]).toContain(path[i + 1]);
    }
  });

  it('every target state exists as a key', () => {
    for (const targets of Object.values(STAGE_RUN_TRANSITIONS)) {
      for (const target of targets) {
        expect(STAGE_RUN_TRANSITIONS).toHaveProperty(target);
      }
    }
  });
});
