import { describe, expect, it } from 'vitest';
import { evaluateGate } from '@/core/gates/engine';
import type { GateRule, StageRunContext } from '@/core/gates/types';
import { parseCostFromOutput } from '@/core/pipeline/cost-parser';
import type { PipelineRunStatus, StageRunStatus } from '@/core/pipeline/types';
import {
  PIPELINE_RUN_TRANSITIONS,
  STAGE_RUN_TRANSITIONS,
} from '@/core/pipeline/types';

/**
 * End-to-end pipeline lifecycle test.
 *
 * Simulates a complete 4-stage pipeline (research → implement → review → deploy)
 * through the full configure → start → execute → gate → approve → complete flow.
 * No database required — exercises pure logic layers.
 */
describe('pipeline E2E lifecycle', () => {
  // Pipeline configuration
  const stages = [
    {
      name: 'research',
      sortOrder: 1,
      gateMode: 'auto' as const,
      gateRules: [{ condition: 'exit_code_zero', onFail: 'abort' as const }],
    },
    {
      name: 'implement',
      sortOrder: 2,
      gateMode: 'auto' as const,
      gateRules: [
        { condition: 'exit_code_zero', onFail: 'abort' as const },
        {
          condition: 'cost_under_limit',
          params: { maxCostUsd: 2.0 },
          onFail: 'hold' as const,
        },
      ],
    },
    {
      name: 'review',
      sortOrder: 3,
      gateMode: 'hold' as const,
      gateRules: null,
    },
    {
      name: 'deploy',
      sortOrder: 4,
      gateMode: 'auto' as const,
      gateRules: [
        { condition: 'exit_code_zero', onFail: 'abort' as const },
        { condition: 'no_stderr', onFail: 'rework' as const },
      ],
    },
  ];

  describe('happy path: full pipeline completion', () => {
    it('configures a 4-stage pipeline with mixed gate modes', () => {
      expect(stages).toHaveLength(4);
      expect(stages[0].gateMode).toBe('auto');
      expect(stages[2].gateMode).toBe('hold');
      expect(stages.map((s) => s.name)).toEqual([
        'research',
        'implement',
        'review',
        'deploy',
      ]);
    });

    it('transitions pipeline from pending → running', () => {
      const status: PipelineRunStatus = 'pending';
      expect(PIPELINE_RUN_TRANSITIONS[status]).toContain('running');
    });

    it('creates stage runs in queued state ordered by sortOrder', () => {
      const stageRuns = stages
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({
          stageName: s.name,
          status: 'queued' as StageRunStatus,
        }));

      expect(stageRuns[0].stageName).toBe('research');
      expect(stageRuns[3].stageName).toBe('deploy');
      for (const sr of stageRuns) {
        expect(sr.status).toBe('queued');
        expect(STAGE_RUN_TRANSITIONS.queued).toContain('running');
      }
    });

    it('executes stage 1 (research): queued → running → completed, gate proceeds', () => {
      expect(STAGE_RUN_TRANSITIONS.queued).toContain('running');

      // Simulate harness output with cost info
      const stdout =
        'Analysis complete.\nTotal cost: $0.03\nInput: 800 tokens\nOutput: 400 tokens';
      const parsed = parseCostFromOutput(stdout);
      expect(parsed).not.toBeNull();
      expect(parsed!.costUsd).toBe('0.030000');
      expect(parsed!.tokensIn).toBe(800);
      expect(parsed!.tokensOut).toBe(400);

      const context: StageRunContext = {
        exitCode: 0,
        costUsd: parsed!.costUsd,
        stderr: '',
        tokensIn: parsed!.tokensIn,
        tokensOut: parsed!.tokensOut,
      };

      const gate = evaluateGate('auto', stages[0].gateRules, context);
      expect(gate.verdict).toBe('proceed');

      expect(STAGE_RUN_TRANSITIONS.running).toContain('completed');
    });

    it('executes stage 2 (implement): passes cost limit gate', () => {
      const stdout =
        'Implementation done.\nCost: $1.45\nTokens: 3000 in / 2500 out';
      const parsed = parseCostFromOutput(stdout);
      expect(parsed).not.toBeNull();
      expect(parsed!.costUsd).toBe('1.450000');

      const context: StageRunContext = {
        exitCode: 0,
        costUsd: parsed!.costUsd,
        stderr: '',
        tokensIn: parsed!.tokensIn,
        tokensOut: parsed!.tokensOut,
      };

      const gate = evaluateGate('auto', stages[1].gateRules, context);
      expect(gate.verdict).toBe('proceed');
      expect(gate.rules).toHaveLength(2);
      expect(gate.rules.every((r) => r.passed)).toBe(true);
    });

    it('stage 3 (review): hold gate requires manual approval', () => {
      const context: StageRunContext = {
        exitCode: 0,
        costUsd: '0.08',
        stderr: '',
        tokensIn: 1000,
        tokensOut: 800,
      };

      const gate = evaluateGate('hold', stages[2].gateRules, context);
      expect(gate.verdict).toBe('hold');
      expect(gate.reason).toBe('Manual approval required');
    });

    it('after approval, stage 4 (deploy) completes and pipeline finishes', () => {
      const context: StageRunContext = {
        exitCode: 0,
        costUsd: '0.01',
        stderr: '',
        tokensIn: 200,
        tokensOut: 100,
      };

      const gate = evaluateGate('auto', stages[3].gateRules, context);
      expect(gate.verdict).toBe('proceed');

      // Pipeline can complete
      expect(PIPELINE_RUN_TRANSITIONS.running).toContain('completed');
    });
  });

  describe('cost aggregation across stages', () => {
    it('accumulates total cost from multiple stage outputs', () => {
      const outputs = [
        'Total cost: $0.03',
        'Cost: $1.45',
        'Total cost: $0.08',
        'Cost: $0.01',
      ];

      const costs = outputs.map((o) => parseCostFromOutput(o));
      const totalCost = costs.reduce(
        (sum, c) => sum + (c ? Number.parseFloat(c.costUsd) : 0),
        0
      );

      expect(totalCost).toBeCloseTo(1.57, 2);
    });
  });

  describe('rework cycle', () => {
    it('deploy fails no_stderr check → rework → retry → succeed', () => {
      // First attempt: stderr present
      const failContext: StageRunContext = {
        exitCode: 0,
        costUsd: '0.02',
        stderr: 'Warning: deprecated API usage',
        tokensIn: 300,
        tokensOut: 200,
      };

      const firstGate = evaluateGate('auto', stages[3].gateRules, failContext);
      expect(firstGate.verdict).toBe('rework');

      // Verify rework transitions
      expect(STAGE_RUN_TRANSITIONS.completed).toContain('rework');
      expect(STAGE_RUN_TRANSITIONS.rework).toContain('queued');
      expect(STAGE_RUN_TRANSITIONS.queued).toContain('running');

      // Retry: clean output
      const retryContext: StageRunContext = {
        exitCode: 0,
        costUsd: '0.01',
        stderr: '',
        tokensIn: 200,
        tokensOut: 100,
      };

      const retryGate = evaluateGate('auto', stages[3].gateRules, retryContext);
      expect(retryGate.verdict).toBe('proceed');
    });
  });

  describe('abort path', () => {
    it('stage fails exit_code_zero → abort → pipeline fails', () => {
      const context: StageRunContext = {
        exitCode: 1,
        costUsd: '0.50',
        stderr: 'Fatal: compilation error',
        tokensIn: 2000,
        tokensOut: 0,
      };

      const gate = evaluateGate('auto', stages[0].gateRules, context);
      expect(gate.verdict).toBe('abort');

      // Pipeline can transition to failed
      expect(PIPELINE_RUN_TRANSITIONS.running).toContain('failed');
    });

    it('cost over limit triggers hold even if exit code passes', () => {
      const context: StageRunContext = {
        exitCode: 0,
        costUsd: '5.00',
        stderr: '',
        tokensIn: 10000,
        tokensOut: 8000,
      };

      const gate = evaluateGate('auto', stages[1].gateRules, context);
      expect(gate.verdict).toBe('hold');
      expect(gate.rules.filter((r) => !r.passed)).toHaveLength(1);
    });
  });

  describe('cancel mid-run', () => {
    it('running pipeline can be cancelled, remaining stages skipped', () => {
      expect(PIPELINE_RUN_TRANSITIONS.running).toContain('cancelled');
      expect(STAGE_RUN_TRANSITIONS.queued).toContain('skipped');

      // Skipped and cancelled are terminal
      expect(STAGE_RUN_TRANSITIONS.skipped).toHaveLength(0);
      expect(PIPELINE_RUN_TRANSITIONS.cancelled).toHaveLength(0);
    });

    it('pending pipeline can also be cancelled', () => {
      expect(PIPELINE_RUN_TRANSITIONS.pending).toContain('cancelled');
    });
  });

  describe('multi-rule gate evaluation severity', () => {
    it('worst verdict wins when multiple rules fail', () => {
      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'rework' },
        { condition: 'no_stderr', onFail: 'abort' },
        {
          condition: 'cost_under_limit',
          params: { maxCostUsd: 0.01 },
          onFail: 'hold',
        },
      ];

      const context: StageRunContext = {
        exitCode: 1,
        costUsd: '5.00',
        stderr: 'Error',
        tokensIn: 1000,
        tokensOut: 500,
      };

      const gate = evaluateGate('auto', rules, context);
      expect(gate.verdict).toBe('abort'); // abort (severity 3) > rework (2) > hold (1)
      expect(gate.rules.filter((r) => !r.passed)).toHaveLength(3);
    });
  });
});
