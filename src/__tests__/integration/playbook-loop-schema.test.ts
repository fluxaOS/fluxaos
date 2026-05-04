import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  parsePlaybook,
  isLoopNode,
  isParallelGroup,
} from '@/core/pipeline/playbook';
import type { PlaybookStage, LoopNode } from '@/core/pipeline/playbook';

const BUNDLED_DIR = join(
  __dirname,
  '../../../src/core/pipeline/bundled'
);

describe('symphony-style.yaml schema round-trip', () => {
  it('parses without error', () => {
    const yaml = readFileSync(join(BUNDLED_DIR, 'symphony-style.yaml'), 'utf-8');
    const result = parsePlaybook(yaml, 'symphony-style.yaml');
    expect(result.success).toBe(true);
  });

  it('has exactly one loop stage', () => {
    const yaml = readFileSync(join(BUNDLED_DIR, 'symphony-style.yaml'), 'utf-8');
    const result = parsePlaybook(yaml, 'symphony-style.yaml');
    if (!result.success) throw new Error(result.error);
    const loopStages = result.playbook.stages.filter(isLoopNode);
    expect(loopStages).toHaveLength(1);
  });

  it('loop stage has correct fields', () => {
    const yaml = readFileSync(join(BUNDLED_DIR, 'symphony-style.yaml'), 'utf-8');
    const result = parsePlaybook(yaml, 'symphony-style.yaml');
    if (!result.success) throw new Error(result.error);
    const [stage] = result.playbook.stages.filter(isLoopNode) as LoopNode[];
    expect(stage.id).toBe('symphony-agent');
    expect(stage.skill).toBe('implement');
    expect(stage.until).toBe('ISSUE_OUT_OF_ACTIVE_STATE');
    expect(stage.maxIterations).toBe(10);
    expect(stage.onComplete).toBe('complete');
    expect(stage.onExhausted).toBe('blocked');
    expect(stage.fallback).toBe('blocked');
  });
});

describe('isLoopNode type guard', () => {
  const loopStage: PlaybookStage = {
    type: 'loop',
    id: 'test-loop',
    skill: 'implement',
    until: 'VERDICT_PASS',
    maxIterations: 5,
    onComplete: 'complete',
    onExhausted: 'blocked',
    fallback: 'blocked',
    trustMode: 'prescriptive',
    rules: [],
  };

  const sequentialStage: PlaybookStage = {
    type: 'sequential',
    id: 'test-seq',
    skill: 'implement',
    onPass: 'done',
    onFail: 'blocked',
    fallback: 'blocked',
    trustMode: 'prescriptive',
    rules: [],
  };

  it('returns true for loop nodes', () => {
    expect(isLoopNode(loopStage)).toBe(true);
  });

  it('returns false for sequential stages', () => {
    expect(isLoopNode(sequentialStage)).toBe(false);
  });

  it('isParallelGroup returns false for loop nodes', () => {
    expect(isParallelGroup(loopStage)).toBe(false);
  });

  it('maxIterations defaults to 10 when omitted', () => {
    const yaml = `
name: test
description: test
prompt: test
stages:
  - type: loop
    id: my-loop
    skill: implement
    until: VERDICT_PASS
    onComplete: complete
    onExhausted: blocked
    fallback: blocked
`;
    const result = parsePlaybook(yaml, 'test.yaml');
    expect(result.success).toBe(true);
    if (!result.success) return;
    const [s] = result.playbook.stages.filter(isLoopNode) as LoopNode[];
    expect(s.maxIterations).toBe(10);
  });
});
