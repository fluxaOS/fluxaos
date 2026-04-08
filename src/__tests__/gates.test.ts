import { describe, expect, it } from 'vitest';
import { evaluateGate } from '@/core/gates/engine';
import type { GateRule, StageRunContext } from '@/core/gates/types';

const okContext: StageRunContext = {
  exitCode: 0,
  costUsd: '0.05',
  stderr: '',
  tokensIn: 1000,
  tokensOut: 500,
};

const failContext: StageRunContext = {
  exitCode: 1,
  costUsd: '0.50',
  stderr: 'Error: something went wrong',
  tokensIn: 2000,
  tokensOut: 1000,
};

describe('gate engine', () => {
  describe('skip mode', () => {
    it('always proceeds', () => {
      const result = evaluateGate('skip', null, failContext);
      expect(result.verdict).toBe('proceed');
      expect(result.rules).toHaveLength(0);
    });
  });

  describe('manual / hold mode', () => {
    it('manual mode holds for approval', () => {
      const result = evaluateGate('manual', null, okContext);
      expect(result.verdict).toBe('hold');
    });

    it('hold mode holds for approval', () => {
      const result = evaluateGate('hold', null, okContext);
      expect(result.verdict).toBe('hold');
    });
  });

  describe('auto mode with no rules', () => {
    it('proceeds when exit code is 0', () => {
      const result = evaluateGate('auto', null, okContext);
      expect(result.verdict).toBe('proceed');
    });

    it('aborts when exit code is non-zero', () => {
      const result = evaluateGate('auto', null, failContext);
      expect(result.verdict).toBe('abort');
    });
  });

  describe('auto mode with rules', () => {
    it('proceeds when all rules pass', () => {
      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'abort' },
        { condition: 'no_stderr', onFail: 'rework' },
      ];
      const result = evaluateGate('auto', rules, okContext);
      expect(result.verdict).toBe('proceed');
      expect(result.rules).toHaveLength(2);
      expect(result.rules.every((r) => r.passed)).toBe(true);
    });

    it('returns worst verdict when rules fail', () => {
      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'rework' },
        { condition: 'no_stderr', onFail: 'abort' },
      ];
      const result = evaluateGate('auto', rules, failContext);
      expect(result.verdict).toBe('abort');
    });

    it('exit_code_zero fails on non-zero', () => {
      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'abort' },
      ];
      const result = evaluateGate('auto', rules, failContext);
      expect(result.verdict).toBe('abort');
      expect(result.rules[0].passed).toBe(false);
    });

    it('cost_under_limit passes when under', () => {
      const rules: GateRule[] = [
        {
          condition: 'cost_under_limit',
          params: { maxCostUsd: 1.0 },
          onFail: 'hold',
        },
      ];
      const result = evaluateGate('auto', rules, okContext);
      expect(result.verdict).toBe('proceed');
    });

    it('cost_under_limit fails when over', () => {
      const rules: GateRule[] = [
        {
          condition: 'cost_under_limit',
          params: { maxCostUsd: 0.01 },
          onFail: 'hold',
        },
      ];
      const result = evaluateGate('auto', rules, okContext);
      expect(result.verdict).toBe('hold');
    });

    it('no_stderr passes when empty', () => {
      const rules: GateRule[] = [{ condition: 'no_stderr', onFail: 'rework' }];
      const result = evaluateGate('auto', rules, okContext);
      expect(result.verdict).toBe('proceed');
    });

    it('no_stderr fails when stderr has content', () => {
      const rules: GateRule[] = [{ condition: 'no_stderr', onFail: 'rework' }];
      const result = evaluateGate('auto', rules, failContext);
      expect(result.verdict).toBe('rework');
    });

    it('unknown condition passes by default', () => {
      const rules: GateRule[] = [
        { condition: 'unknown_check', onFail: 'abort' },
      ];
      const result = evaluateGate('auto', rules, okContext);
      expect(result.verdict).toBe('proceed');
    });
  });

  describe('rules mode (alias for auto)', () => {
    it('evaluates rules like auto', () => {
      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'abort' },
      ];
      const result = evaluateGate('rules', rules, okContext);
      expect(result.verdict).toBe('proceed');
    });
  });

  describe('verdict severity', () => {
    it('abort beats rework', () => {
      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'rework' },
        { condition: 'no_stderr', onFail: 'abort' },
      ];
      const result = evaluateGate('auto', rules, failContext);
      expect(result.verdict).toBe('abort');
    });

    it('rework beats hold', () => {
      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'hold' },
        { condition: 'no_stderr', onFail: 'rework' },
      ];
      const result = evaluateGate('auto', rules, failContext);
      expect(result.verdict).toBe('rework');
    });

    it('hold beats proceed', () => {
      const rules: GateRule[] = [
        { condition: 'exit_code_zero', onFail: 'hold' },
      ];
      const result = evaluateGate('auto', rules, failContext);
      expect(result.verdict).toBe('hold');
    });
  });
});
