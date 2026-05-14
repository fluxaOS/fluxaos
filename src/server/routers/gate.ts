/**
 * Gate router — evaluate and test gate rules.
 *
 * Provides endpoints for:
 * - Evaluating a stage's gate (persists audit result)
 * - Test-evaluating rules against mock context (no persistence)
 */
import { z } from 'zod/v4';
import { EDIT_ROLES } from '@/core/features/roles';
import { createGateService } from '@/core/gates/service';
import { protectedMutation, publicProcedure, router } from '../trpc';

// ─── Zod schemas for rule structures ────────────────────────────────────────

const ruleOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'less_than',
  'greater_than',
  'contains',
  'matches',
  'in',
  'exists',
]);

const ruleSeveritySchema = z.enum(['block', 'required', 'warn']);

const failureActionSchema = z.enum([
  'proceed',
  'hold',
  'rework',
  'abort',
  'notify',
  'escalate',
]);

const gateModeSchema = z.enum(['auto', 'rules', 'hold', 'manual', 'skip']);

const ruleSchema: z.ZodType<any> = z.object({
  field: z.string().min(1),
  operator: ruleOperatorSchema,
  value: z.unknown().optional(),
  severity: ruleSeveritySchema,
  onFail: failureActionSchema,
  label: z.string().optional(),
});

const ruleGroupSchema: z.ZodType<any> = z.object({
  logic: z.enum(['AND', 'OR']),
  rules: z.lazy(() => z.array(z.union([ruleSchema, ruleGroupSchema]))),
});

// ─── Router ─────────────────────────────────────────────────────────────────

export const gateRouter = router({
  /**
   * Evaluate the gate for a pipeline stage run.
   * Reads gateMode + gateRules from DB, evaluates, persists audit result.
   */
  evaluate: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        stageId: z.string().uuid(),
        stageRunId: z.string().uuid(),
        context: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ ctx, input }) =>
      createGateService(ctx.db).evaluateStageGate(
        input.stageId,
        input.stageRunId,
        input.context
      )
    ),

  /**
   * Test-evaluate rules against a mock context.
   * No persistence — used by the UI rule builder for preview.
   */
  test: publicProcedure
    .input(
      z.object({
        mode: gateModeSchema,
        rules: ruleGroupSchema.nullable(),
        context: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ ctx, input }) =>
      createGateService(ctx.db).testEvaluate(
        input.mode,
        input.rules,
        input.context
      )
    ),
});
