import { describe, it, expect } from 'vitest';
import { auditResultDoc } from '@/core/pipeline/playbook-auditor';
import type { Playbook } from '@/core/pipeline/playbook';
import type { ResultDoc } from '@/core/pipeline/result-doc';

const playbook: Playbook = {
  name: 'test',
  description: 'Test playbook',
  prompt: 'Test prompt',
  stages: [
    {
      type: 'sequential',
      id: 'implement',
      skill: 'implement',
      onPass: 'review',
      onFail: 'rework',
      fallback: 'blocked',
      trustMode: 'prescriptive',
      rules: [],
    },
    {
      type: 'sequential',
      id: 'review',
      skill: 'review',
      onPass: 'deploy',
      onFail: 'rework',
      fallback: 'blocked',
      trustMode: 'prescriptive',
      rules: [],
    },
  ],
};

const baseDoc: ResultDoc = {
  issue: { id: 'u1', number: 1, title: 'T' },
  run: { pipelineRunId: 'u2', stageRunId: 'u3', stage: 'implement', attempt: 1 },
  org: { id: 'u4', slug: 'o' },
  project: { id: 'u5', slug: 'p' },
  timing: { startedAt: '2026-05-02T00:00:00Z' },
  verdict: 'pass',
  summary: 'Done.',
};

describe('auditResultDoc', () => {
  it('routes pass verdict to onPass state', () => {
    const result = auditResultDoc(playbook, 'implement', baseDoc);
    expect(result.targetState).toBe('review');
    expect(result.action).toBe('transition');
  });

  it('routes fail verdict to onFail state', () => {
    const result = auditResultDoc(playbook, 'implement', { ...baseDoc, verdict: 'fail' });
    expect(result.targetState).toBe('rework');
    expect(result.action).toBe('transition');
  });

  it('uses fallback when result doc is null (invalid)', () => {
    const result = auditResultDoc(playbook, 'implement', null);
    expect(result.targetState).toBe('blocked');
    expect(result.action).toBe('fallback');
  });

  it('uses fallback when stage not found in playbook', () => {
    const result = auditResultDoc(playbook, 'nonexistent', baseDoc);
    expect(result.action).toBe('fallback');
  });

  it('includes comment from result doc', () => {
    const doc = { ...baseDoc, comment: 'Review passed cleanly.' };
    const result = auditResultDoc(playbook, 'implement', doc);
    expect(result.comment).toBe('Review passed cleanly.');
  });

  it('verdict: blocked routes to fallback', () => {
    const doc: ResultDoc = { ...baseDoc, verdict: 'blocked' };
    const result = auditResultDoc(playbook, 'implement', doc);
    expect(result.targetState).toBe('blocked');
    expect(result.action).toBe('fallback');
  });

  it('verdict: pass with non-empty blockers routes to fallback', () => {
    const doc: ResultDoc = {
      ...baseDoc,
      verdict: 'pass',
      blockers: [{ title: 'CI broken', description: 'Red on main.' }],
    };
    const result = auditResultDoc(playbook, 'implement', doc);
    expect(result.action).toBe('fallback');
    expect(result.blockers).toHaveLength(1);
  });

  it('warn-only rule failure does not override pass routing', () => {
    const playbookWithWarnRule: Playbook = {
      ...playbook,
      stages: [{
        type: 'sequential',
        id: 'implement',
        skill: 'implement',
        onPass: 'review',
        onFail: 'rework',
        fallback: 'blocked',
        trustMode: 'prescriptive',
        rules: [{
          field: 'timing.duration_sec',
          operator: 'less_than',
          value: 60,
          severity: 'warn',
          onFail: 'hold',
          label: 'Time cap',
        }],
      }],
    };
    // duration_sec = 3600, cap = 60, severity = warn → warn-only → does NOT block
    const doc: ResultDoc = { ...baseDoc, timing: { startedAt: '2026-05-02T00:00:00Z', duration_sec: 3600 } };
    const result = auditResultDoc(playbookWithWarnRule, 'implement', doc);
    expect(result.targetState).toBe('review'); // pass verdict respected; warn did not block
    expect(result.action).toBe('transition');
  });

  it('block-severity rule failure routes to fallback', () => {
    const playbookWithBlockRule: Playbook = {
      ...playbook,
      stages: [{
        type: 'sequential',
        id: 'implement',
        skill: 'implement',
        onPass: 'review',
        onFail: 'rework',
        fallback: 'blocked',
        trustMode: 'prescriptive',
        rules: [{
          field: 'run.attempt',
          operator: 'less_than',
          value: 2,
          severity: 'block',
          onFail: 'abort',
          label: 'Attempt cap',
        }],
      }],
    };
    // attempt = 5, cap requires attempt < 2 → rule fails with severity:block → fallback
    const doc: ResultDoc = { ...baseDoc, run: { ...baseDoc.run, attempt: 5 } };
    const result = auditResultDoc(playbookWithBlockRule, 'implement', doc);
    expect(result.action).toBe('fallback');
  });

  it('loop node stage routes to fallback (loop nodes bypass the auditor)', () => {
    const playbookWithLoop: Playbook = {
      name: 'test',
      description: 'Test',
      prompt: 'Test',
      stages: [{
        type: 'loop',
        id: 'symphony-agent',
        skill: 'implement',
        until: 'ISSUE_OUT_OF_ACTIVE_STATE',
        maxIterations: 10,
        onComplete: 'complete',
        onExhausted: 'blocked',
        fallback: 'blocked',
        trustMode: 'prescriptive',
        rules: [],
      }],
    };
    const result = auditResultDoc(playbookWithLoop, 'symphony-agent', baseDoc);
    expect(result.action).toBe('fallback');
    expect(result.targetState).toBe('blocked');
  });
});
