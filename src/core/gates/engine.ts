import type {
  GateEvaluation,
  GateMode,
  GateRule,
  GateRuleResult,
  GateVerdict,
  StageRunContext,
} from './types';

const VERDICT_SEVERITY: Record<GateVerdict, number> = {
  proceed: 0,
  hold: 1,
  rework: 2,
  abort: 3,
};

function evaluateCondition(
  condition: string,
  context: StageRunContext,
  params?: Record<string, unknown>
): boolean {
  switch (condition) {
    case 'exit_code_zero':
      return context.exitCode === 0;

    case 'cost_under_limit': {
      const maxCost = params?.maxCostUsd;
      if (typeof maxCost !== 'number' && typeof maxCost !== 'string')
        return true;
      return (
        Number.parseFloat(context.costUsd) < Number.parseFloat(String(maxCost))
      );
    }

    case 'no_stderr':
      return context.stderr.trim().length === 0;

    default:
      // Unknown condition — pass by default (don't block on unrecognized rules)
      return true;
  }
}

export function evaluateGate(
  gateMode: GateMode,
  gateRules: unknown,
  context: StageRunContext
): GateEvaluation {
  // Skip mode — always proceed
  if (gateMode === 'skip') {
    return {
      verdict: 'proceed',
      rules: [],
      reason: 'Gate skipped',
    };
  }

  // Manual / hold mode — always hold for human approval
  if (gateMode === 'manual' || gateMode === 'hold') {
    return {
      verdict: 'hold',
      rules: [],
      reason: 'Manual approval required',
    };
  }

  // Auto / rules mode — evaluate rules
  const rules = Array.isArray(gateRules) ? (gateRules as GateRule[]) : [];

  if (rules.length === 0) {
    // No rules defined — default to exit code check
    const passed = context.exitCode === 0;
    return {
      verdict: passed ? 'proceed' : 'abort',
      rules: [
        {
          rule: { condition: 'exit_code_zero', onFail: 'abort' },
          passed,
        },
      ],
      reason: passed
        ? 'Default gate: exit code is 0'
        : `Default gate: exit code is ${context.exitCode}`,
    };
  }

  const results: GateRuleResult[] = [];
  let worstVerdict: GateVerdict = 'proceed';

  for (const rule of rules) {
    const passed = evaluateCondition(rule.condition, context, rule.params);
    results.push({ rule, passed });

    if (!passed) {
      if (VERDICT_SEVERITY[rule.onFail] > VERDICT_SEVERITY[worstVerdict]) {
        worstVerdict = rule.onFail;
      }
    }
  }

  const failedCount = results.filter((r) => !r.passed).length;
  const reason =
    failedCount === 0
      ? `All ${results.length} gate rules passed`
      : `${failedCount} of ${results.length} rules failed → ${worstVerdict}`;

  return {
    verdict: worstVerdict,
    rules: results,
    reason,
  };
}
