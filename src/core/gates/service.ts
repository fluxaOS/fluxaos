/**
 * Gate Service — connects the pure engine to the database.
 *
 * Reads gate configuration from pipeline stages, delegates evaluation
 * to the engine, and persists audit results. Receives Database via DI.
 */
import { eq } from 'drizzle-orm';
import type { GateMode } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { pipelineStage, stageGateResult } from '@/core/db/schema';
import { evaluateGate } from './engine';
import type { GateEvaluation, RuleGroup } from './types';

export interface GateService {
  /**
   * Evaluate the gate for a pipeline stage.
   *
   * @param stageId   - The pipeline stage ID (reads gateMode + gateRules)
   * @param stageRunId - The stage run ID (for audit trail)
   * @param context   - Arbitrary data the rules evaluate against
   */
  evaluateStageGate(
    stageId: string,
    stageRunId: string,
    context: Record<string, unknown>
  ): Promise<GateEvaluation>;

  /**
   * Test-evaluate rules without persisting results.
   * Used by the UI rule builder for preview/testing.
   */
  testEvaluate(
    mode: GateMode,
    rules: RuleGroup | null,
    context: Record<string, unknown>
  ): GateEvaluation;
}

export function createGateService(db: Database): GateService {
  return {
    async evaluateStageGate(
      stageId: string,
      stageRunId: string,
      context: Record<string, unknown>
    ): Promise<GateEvaluation> {
      // Read gate configuration from the stage
      const [stage] = await db
        .select({
          gateMode: pipelineStage.gateMode,
          gateRules: pipelineStage.gateRules,
        })
        .from(pipelineStage)
        .where(eq(pipelineStage.id, stageId));

      if (!stage) {
        throw new Error(`pipeline stage not found: ${stageId}`);
      }

      const mode = stage.gateMode as GateMode;
      const rules = (stage.gateRules as RuleGroup) ?? null;

      // Evaluate
      const evaluation = evaluateGate(mode, rules, context);

      // Persist audit result (append-only)
      await db.insert(stageGateResult).values({
        stageRunId,
        verdict: evaluation.verdict,
        passed: evaluation.passed,
        worstAction: evaluation.worstAction,
        ruleSnapshot: rules ?? {},
        ruleResults: evaluation.ruleResults,
        reason: evaluation.reason,
      });

      return evaluation;
    },

    testEvaluate(
      mode: GateMode,
      rules: RuleGroup | null,
      context: Record<string, unknown>
    ): GateEvaluation {
      return evaluateGate(mode, rules, context);
    },
  };
}
