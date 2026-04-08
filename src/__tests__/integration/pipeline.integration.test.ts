import { describe, expect, it } from 'vitest';
import { evaluateGate } from '@/core/gates/engine';
import type { GateRule, StageRunContext } from '@/core/gates/types';
import type { PipelineRunStatus, StageRunStatus } from '@/core/pipeline/types';
import {
  PIPELINE_RUN_TRANSITIONS,
  STAGE_RUN_TRANSITIONS,
} from '@/core/pipeline/types';

/**
 * Integration test for the pipeline engine.
 *
 * Tests the full state machine + gate engine logic without requiring a database.
 * Validates the critical paths:
 * 1. Pipeline run lifecycle (pending → running → completed)
 * 2. Stage run lifecycle with gate evaluation
 * 3. Rework cycle (completed → rework → queued → running → completed)
 * 4. Gate engine integration with stage context
 */

describe('pipeline engine integration', () => {
  describe('3-stage pipeline lifecycle simulation', () => {
    // Simulate a 3-stage pipeline:
    // Stage 1: analyze (gate: auto, exit_code_zero)
    // Stage 2: implement (gate: auto, exit_code_zero + cost_under_limit)
    // Stage 3: review (gate: manual/hold)

    it('simulates full pipeline execution with gate evaluation', () => {
      // --- Stage 1: analyze ---
      // Verify queued → running is valid
      expect(STAGE_RUN_TRANSITIONS.queued).toContain('running');

      // Simulate execution success
      const stage1Context: StageRunContext = {
        exitCode: 0,
        costUsd: '0.02',
        stderr: '',
        tokensIn: 500,
        tokensOut: 200,
      };

      // Evaluate auto gate with exit_code_zero rule
      const stage1Gate = evaluateGate(
        'auto',
        [{ condition: 'exit_code_zero', onFail: 'abort' }],
        stage1Context
      );

      expect(stage1Gate.verdict).toBe('proceed');

      // Verify running → completed is valid
      expect(STAGE_RUN_TRANSITIONS.running).toContain('completed');

      // --- Stage 2: implement ---
      const stage2Context: StageRunContext = {
        exitCode: 0,
        costUsd: '0.15',
        stderr: '',
        tokensIn: 2000,
        tokensOut: 1500,
      };

      const stage2Rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'abort' },
        {
          condition: 'cost_under_limit',
          params: { maxCostUsd: 1.0 },
          onFail: 'hold',
        },
      ];

      const stage2Gate = evaluateGate('auto', stage2Rules, stage2Context);
      expect(stage2Gate.verdict).toBe('proceed');

      // --- Stage 3: review (manual hold) ---
      const stage3Context: StageRunContext = {
        exitCode: 0,
        costUsd: '0.08',
        stderr: '',
        tokensIn: 1000,
        tokensOut: 800,
      };

      const stage3Gate = evaluateGate('hold', null, stage3Context);
      expect(stage3Gate.verdict).toBe('hold');

      // After approval, pipeline completes
      expect(PIPELINE_RUN_TRANSITIONS.running).toContain('completed');
    });

    it('simulates rework cycle', () => {
      // Stage completes but gate says rework
      const context: StageRunContext = {
        exitCode: 1,
        costUsd: '0.05',
        stderr: 'Error: test failed',
        tokensIn: 500,
        tokensOut: 200,
      };

      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'rework' },
      ];

      const gateResult = evaluateGate('auto', rules, context);
      expect(gateResult.verdict).toBe('rework');

      // Verify rework cycle transitions are valid
      expect(STAGE_RUN_TRANSITIONS.completed).toContain('rework');
      expect(STAGE_RUN_TRANSITIONS.rework).toContain('queued');
      expect(STAGE_RUN_TRANSITIONS.queued).toContain('running');
      expect(STAGE_RUN_TRANSITIONS.running).toContain('completed');

      // Second attempt succeeds
      const retryContext: StageRunContext = {
        exitCode: 0,
        costUsd: '0.03',
        stderr: '',
        tokensIn: 300,
        tokensOut: 150,
      };

      const retryGate = evaluateGate('auto', rules, retryContext);
      expect(retryGate.verdict).toBe('proceed');
    });

    it('simulates gate abort causing pipeline failure', () => {
      const context: StageRunContext = {
        exitCode: 1,
        costUsd: '5.00',
        stderr: 'Fatal error: out of memory',
        tokensIn: 10000,
        tokensOut: 0,
      };

      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'abort' },
        {
          condition: 'cost_under_limit',
          params: { maxCostUsd: 1.0 },
          onFail: 'abort',
        },
        { condition: 'no_stderr', onFail: 'rework' },
      ];

      const gateResult = evaluateGate('auto', rules, context);
      // abort is worst verdict (severity 3)
      expect(gateResult.verdict).toBe('abort');

      // All 3 rules failed
      expect(gateResult.rules.filter((r) => !r.passed)).toHaveLength(3);

      // Pipeline can transition to failed
      expect(PIPELINE_RUN_TRANSITIONS.running).toContain('failed');
    });

    it('simulates cancel — remaining stages skipped', () => {
      // Cancel transitions
      expect(PIPELINE_RUN_TRANSITIONS.running).toContain('cancelled');
      expect(STAGE_RUN_TRANSITIONS.queued).toContain('skipped');

      // Skipped is terminal
      expect(STAGE_RUN_TRANSITIONS.skipped).toHaveLength(0);
    });

    it('validates complete state machine coverage', () => {
      // Pipeline run: every non-terminal state has at least one transition
      const pipelineTerminal: PipelineRunStatus[] = [
        'completed',
        'failed',
        'cancelled',
      ];
      for (const [state, targets] of Object.entries(PIPELINE_RUN_TRANSITIONS)) {
        if (pipelineTerminal.includes(state as PipelineRunStatus)) {
          expect(targets).toHaveLength(0);
        } else {
          expect(targets.length).toBeGreaterThan(0);
        }
      }

      // Stage run: every non-terminal state has at least one transition
      const stageTerminal: StageRunStatus[] = ['failed', 'skipped'];
      for (const [state, targets] of Object.entries(STAGE_RUN_TRANSITIONS)) {
        if (stageTerminal.includes(state as StageRunStatus)) {
          expect(targets).toHaveLength(0);
        } else {
          expect(targets.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
