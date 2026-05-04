import { evaluateGate } from '@/core/gates/engine';
import type { Rule, RuleGroup } from '@/core/gates/types';
import type { Playbook } from './playbook';
import { isLoopNode } from './playbook';
import type { ResultDoc } from './result-doc';

export type AuditAction = 'transition' | 'fallback';

export interface AuditResult {
  action: AuditAction;
  targetState: string;
  comment?: string;
  blockers?: Array<{ title: string; description: string }>;
  artifacts?: string[];
}

export function auditResultDoc(
  playbook: Playbook,
  stageId: string,
  doc: ResultDoc | null
): AuditResult {
  const stage = playbook.stages.find((s) => s.id === stageId);

  if (!stage) {
    return {
      action: 'fallback',
      targetState: playbook.stages[0]?.fallback ?? 'blocked',
    };
  }

  // Loop nodes route via the orchestrator directly; auditResultDoc does not apply.
  if (isLoopNode(stage)) {
    return { action: 'fallback', targetState: stage.fallback };
  }

  if (!doc) {
    return {
      action: 'fallback',
      targetState: stage.fallback,
      comment: 'Stage did not produce a valid result document.',
    };
  }

  // verdict: blocked OR non-empty blockers[] → always fallback
  const isBlocked =
    doc.verdict === 'blocked' ||
    (doc.blockers !== undefined && doc.blockers.length > 0);
  if (isBlocked) {
    return {
      action: 'fallback',
      targetState: stage.fallback,
      comment: doc.comment,
      blockers: doc.blockers,
      artifacts: doc.artifacts,
    };
  }

  // Evaluate gate rules if configured.
  // Pass the result doc as-is (nested object) — resolveField() in engine.ts walks the tree
  // via dot-path split (e.g. "timing.duration_sec" → doc.timing.duration_sec).
  const rawRules = stage.rules ?? [];
  if (rawRules.length > 0) {
    const ruleGroup: RuleGroup = {
      logic: 'AND',
      rules: rawRules as Array<Rule | RuleGroup>,
    };
    const evaluation = evaluateGate(
      'rules',
      ruleGroup,
      doc as unknown as Record<string, unknown>
    );

    if (!evaluation.passed) {
      const worstAction = evaluation.worstAction;
      const targetState =
        worstAction === 'rework'
          ? stage.onFail
          : worstAction === 'hold'
            ? 'hold'
            : stage.fallback; // abort, escalate, notify → fallback

      return {
        action: 'fallback',
        targetState,
        comment: doc.comment,
        artifacts: doc.artifacts,
      };
    }
  }

  // Trust mode: prescriptive (default) — use agent verdict directly
  const targetState = doc.verdict === 'pass' ? stage.onPass : stage.onFail;

  return {
    action: 'transition',
    targetState,
    comment: doc.comment,
    artifacts: doc.artifacts,
  };
}
