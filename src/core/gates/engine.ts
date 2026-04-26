/**
 * Gate Engine — Pure rule evaluation.
 *
 * This is a generic rules engine. It receives a context object (any shape)
 * and a rule set (RuleGroup), evaluates every rule against the context,
 * and returns a verdict. It does not know what it's evaluating. It does not
 * know about stages, pipelines, issues, or providers. It's a machine.
 *
 * Zero vendor imports. Zero domain concepts. Pure logic.
 */

import type {
  FailureAction,
  GateEvaluation,
  GateMode,
  GateVerdict,
  GroupResult,
  Rule,
  RuleGroup,
  RuleOperator,
  RuleResult,
  RuleSeverity,
} from './types';
import { isRuleGroup } from './types';

const MAX_NESTING_DEPTH = 3;

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Evaluate a gate based on its mode and rules.
 *
 * @param mode    - Gate mode from configuration
 * @param rules   - Rule group to evaluate (ignored for non-rules modes)
 * @param context - Arbitrary object to evaluate rules against
 */
export function evaluateGate(
  mode: GateMode,
  rules: RuleGroup | null,
  context: Record<string, unknown>
): GateEvaluation {
  // Non-rules modes short-circuit
  if (mode === 'auto' || mode === 'skip') {
    return {
      verdict: 'proceed',
      passed: true,
      worstAction: null,
      ruleResults: [],
      groupResult: null,
      reason: `gate mode: ${mode}`,
    };
  }

  if (mode === 'hold' || mode === 'manual') {
    return {
      verdict: 'hold',
      passed: false,
      worstAction: 'hold',
      ruleResults: [],
      groupResult: null,
      reason: `gate mode: ${mode} — manual release required`,
    };
  }

  // mode === 'rules' — evaluate the rule set
  if (!rules || rules.rules.length === 0) {
    return {
      verdict: 'proceed',
      passed: true,
      worstAction: null,
      ruleResults: [],
      groupResult: null,
      reason: 'no rules configured',
    };
  }

  const allRuleResults: RuleResult[] = [];
  const groupResult = evaluateGroup(rules, context, 0, allRuleResults);

  // Determine verdict from the effective failures — rules that actually
  // contribute to the overall failure. In an OR group, if the group passes,
  // the failed rules inside it don't count.
  const effectiveFailures = collectEffectiveFailures(groupResult);
  const worstAction = resolveWorstAction(effectiveFailures);
  const verdict = actionToVerdict(worstAction);

  return {
    verdict,
    passed: verdict === 'proceed',
    worstAction,
    ruleResults: allRuleResults,
    groupResult,
    reason:
      verdict === 'proceed'
        ? 'all rules passed'
        : `${effectiveFailures.length} rule(s) failed — worst action: ${worstAction}`,
  };
}

// ─── Group Evaluation ──────────────────────────────────────────────────────

function evaluateGroup(
  group: RuleGroup,
  context: Record<string, unknown>,
  depth: number,
  collector: RuleResult[]
): GroupResult {
  if (depth >= MAX_NESTING_DEPTH) {
    throw new Error(
      `rule nesting exceeds maximum depth of ${MAX_NESTING_DEPTH}`
    );
  }

  const results: Array<RuleResult | GroupResult> = [];

  for (const item of group.rules) {
    if (isRuleGroup(item)) {
      const sub = evaluateGroup(item, context, depth + 1, collector);
      results.push(sub);
    } else {
      const result = evaluateRule(item, context);
      collector.push(result);
      results.push(result);
    }
  }

  const passed =
    group.logic === 'AND'
      ? results.every((r) => r.passed)
      : results.some((r) => r.passed);

  return { logic: group.logic, passed, results };
}

// ─── Effective Failure Collection ───────────────────────────────────────────

/**
 * Walk the group result tree and collect only the rule failures that
 * actually contribute to the overall result. If an OR group passed,
 * its internal failures are irrelevant — they're alternatives that
 * weren't needed. If an OR group failed, ALL its failures count.
 */
function collectEffectiveFailures(group: GroupResult): RuleResult[] {
  // If the group passed, no effective failures from it
  if (group.passed) return [];

  const failures: RuleResult[] = [];
  for (const result of group.results) {
    if ('logic' in result) {
      // Nested group
      failures.push(...collectEffectiveFailures(result as GroupResult));
    } else {
      // Individual rule
      if (!(result as RuleResult).passed) {
        failures.push(result as RuleResult);
      }
    }
  }
  return failures;
}

// ─── Rule Evaluation ───────────────────────────────────────────────────────

function evaluateRule(
  rule: Rule,
  context: Record<string, unknown>
): RuleResult {
  // Block severity always fails — it's an unconditional hold
  if (rule.severity === 'block') {
    return {
      rule,
      passed: false,
      actualValue: undefined,
      reason: 'severity is block — unconditional hold',
    };
  }

  const actualValue = resolveField(rule.field, context);
  const passed = applyOperator(rule.operator, actualValue, rule.value);

  return {
    rule,
    passed,
    actualValue,
    reason: passed ? '' : formatFailureReason(rule, actualValue),
  };
}

// ─── Field Resolution ──────────────────────────────────────────────────────

/**
 * Resolve a dot-path field from a context object.
 * "cost_usd" → context.cost_usd
 * "output.tests_passed" → context.output.tests_passed
 */
function resolveField(
  field: string,
  context: Record<string, unknown>
): unknown {
  const parts = field.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ─── Operator Application ──────────────────────────────────────────────────

function applyOperator(
  operator: RuleOperator,
  actual: unknown,
  expected: unknown
): boolean {
  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null;

    case 'equals':
      return looseEquals(actual, expected);

    case 'not_equals':
      return !looseEquals(actual, expected);

    case 'less_than':
      return toNumber(actual) < toNumber(expected);

    case 'greater_than':
      return toNumber(actual) > toNumber(expected);

    case 'contains':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.includes(expected);
      }
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      return false;

    case 'matches':
      if (typeof actual !== 'string' || typeof expected !== 'string') {
        return false;
      }
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }

    case 'in':
      if (!Array.isArray(expected)) return false;
      return expected.some((item) => looseEquals(actual, item));

    default:
      return false;
  }
}

// ─── Verdict Resolution ────────────────────────────────────────────────────

/** Severity precedence: block > required > warn */
const SEVERITY_WEIGHT: Record<RuleSeverity, number> = {
  block: 3,
  required: 2,
  warn: 1,
};

/** Action precedence: abort > rework > hold > escalate > notify > proceed */
const ACTION_WEIGHT: Record<FailureAction, number> = {
  abort: 6,
  rework: 5,
  hold: 4,
  escalate: 3,
  notify: 2,
  proceed: 1,
};

function resolveWorstAction(failedResults: RuleResult[]): FailureAction | null {
  if (failedResults.length === 0) return null;

  // Sort by severity first, then by action weight
  let worst: RuleResult = failedResults[0];

  for (let i = 1; i < failedResults.length; i++) {
    const current = failedResults[i];
    const currentSev = SEVERITY_WEIGHT[current.rule.severity];
    const worstSev = SEVERITY_WEIGHT[worst.rule.severity];

    if (
      currentSev > worstSev ||
      (currentSev === worstSev &&
        ACTION_WEIGHT[current.rule.onFail] > ACTION_WEIGHT[worst.rule.onFail])
    ) {
      worst = current;
    }
  }

  // Warn-severity failures don't block — they always proceed
  if (worst.rule.severity === 'warn') return null;

  return worst.rule.onFail;
}

function actionToVerdict(action: FailureAction | null): GateVerdict {
  if (action === null) return 'proceed';

  switch (action) {
    case 'abort':
      return 'abort';
    case 'rework':
      return 'rework';
    case 'hold':
    case 'escalate':
    case 'notify':
      return 'hold';
    case 'proceed':
      return 'proceed';
    default:
      return 'hold';
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function looseEquals(a: unknown, b: unknown): boolean {
  // Handle numeric string comparison: "5" == 5
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  return a === b;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return NaN;
}

function formatFailureReason(rule: Rule, actual: unknown): string {
  const label = rule.label ? `[${rule.label}] ` : '';
  return `${label}${rule.field}: expected ${rule.operator} ${JSON.stringify(rule.value)}, got ${JSON.stringify(actual)}`;
}
