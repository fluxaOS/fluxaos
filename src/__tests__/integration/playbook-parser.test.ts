import { describe, it, expect } from 'vitest';
import { parsePlaybook } from '@/core/pipeline/playbook';

const minimalYaml = `
name: quick-task
description: Single stage task.
prompt: |
  You are a pipeline agent.
stages:
  - id: run
    skill: my-task
    onPass: complete
    onFail: complete
    fallback: complete
`;

const standardDevYaml = `
name: standard-dev
description: Research to deploy.
prompt: |
  Base prompt here.
stages:
  - id: research
    skill: research
    onPass: implement
    onFail: research
    fallback: blocked
    rules: []
  - id: implement
    skill: implement
    onPass: review
    onFail: rework
    fallback: blocked
    rules:
      - field: meta.duration_sec
        operator: less_than
        value: 7200
        severity: warn
        onFail: hold
        label: Time cap
  - id: review
    skill: review
    onPass: deploy
    onFail: rework
    fallback: blocked
  - id: deploy
    skill: deploy
    onPass: complete
    onFail: blocked
    fallback: complete
`;

describe('parsePlaybook', () => {
  it('parses minimal single-stage playbook', () => {
    const result = parsePlaybook(minimalYaml, 'quick-task.yaml');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.playbook.name).toBe('quick-task');
      expect(result.playbook.stages).toHaveLength(1);
      expect(result.playbook.stages[0].id).toBe('run');
    }
  });

  it('parses standard-dev four-stage playbook', () => {
    const result = parsePlaybook(standardDevYaml, 'standard-dev.yaml');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.playbook.stages).toHaveLength(4);
      const impl = result.playbook.stages.find(s => s.id === 'implement');
      expect(impl?.type).toBe('sequential');
      if (impl?.type === 'sequential') {
        expect(impl.rules).toHaveLength(1);
        expect(impl.trustMode).toBe('prescriptive');
      }
    }
  });

  it('fails on missing name', () => {
    const result = parsePlaybook('description: no name\nstages: []', 'bad.yaml');
    expect(result.success).toBe(false);
  });

  it('fails on missing stages', () => {
    const result = parsePlaybook('name: x\ndescription: y\nprompt: z', 'bad.yaml');
    expect(result.success).toBe(false);
  });

  it('fails on stage missing onFail', () => {
    const yaml = `
name: x
description: y
prompt: p
stages:
  - id: run
    skill: s
    onPass: complete
    fallback: complete
`;
    const result = parsePlaybook(yaml, 'bad.yaml');
    expect(result.success).toBe(false);
  });

  it('stage defaults trustMode to prescriptive', () => {
    const result = parsePlaybook(minimalYaml, 'q.yaml');
    if (result.success) {
      const stage = result.playbook.stages[0];
      expect(stage.type).toBe('sequential');
      if (stage.type === 'sequential') expect(stage.trustMode).toBe('prescriptive');
    }
  });

  it('parses parallel group stage', () => {
    const yaml = `
name: parallel-test
description: Pipeline with parallel review.
prompt: Base prompt.
stages:
  - id: implement
    skill: implement
    onPass: review-bundle
    onFail: rework
    fallback: blocked
  - id: review-bundle
    type: parallel
    aggregation: all-pass
    children:
      - id: code-review
        skill: review
      - id: security-scan
        skill: security-scan
    onPass: deploy
    onFail: rework
    fallback: blocked
  - id: deploy
    skill: deploy
    onPass: complete
    onFail: blocked
    fallback: complete
`;
    const result = parsePlaybook(yaml, 'parallel-test.yaml');
    expect(result.success).toBe(true);
    if (result.success) {
      const bundle = result.playbook.stages.find(s => s.id === 'review-bundle');
      expect(bundle?.type).toBe('parallel');
      if (bundle?.type === 'parallel') {
        expect(bundle.children).toHaveLength(2);
        expect(bundle.aggregation).toBe('all-pass');
      }
    }
  });

  it('rejects parallel group with fewer than 2 children', () => {
    const yaml = `
name: bad
description: Bad parallel.
prompt: p
stages:
  - id: solo
    type: parallel
    aggregation: all-pass
    children:
      - id: only-one
        skill: review
    onPass: complete
    onFail: complete
    fallback: complete
`;
    const result = parsePlaybook(yaml, 'bad.yaml');
    expect(result.success).toBe(false);
  });
});
