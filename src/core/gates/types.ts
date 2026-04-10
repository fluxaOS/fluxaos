/**
 * Gate Engine — Type definitions.
 *
 * All types are generic and agnostic. The engine doesn't know what it's
 * evaluating — it receives a context object and a rule set, applies
 * operators, and returns a verdict. No stage names, no provider names,
 * no domain concepts.
 */

// ─── Operators ─────────────────────────────────────────────────────────────

/** Comparison operators for rule evaluation. */
export type RuleOperator =
  | 'equals'
  | 'not_equals'
  | 'less_than'
  | 'greater_than'
  | 'contains'
  | 'matches'
  | 'in'
  | 'exists';

// ─── Severity & Actions ────────────────────────────────────────────────────

/**
 * How important a rule is:
 * - block:    always hold, regardless of result
 * - required: must pass for the group to pass
 * - warn:     flag but don't block
 */
export type RuleSeverity = 'block' | 'required' | 'warn';

/**
 * What to do when a rule fails.
 * The orchestrator interprets these — the engine just reports them.
 */
export type FailureAction =
  | 'proceed'
  | 'hold'
  | 'rework'
  | 'abort'
  | 'notify'
  | 'escalate';

// ─── Rules ─────────────────────────────────────────────────────────────────

/** A single field/operator/value condition. */
export interface Rule {
  /** Dot-path into the context object, e.g. "cost_usd" or "output.tests_passed" */
  field: string;
  operator: RuleOperator;
  /** Expected value to compare against. Null for 'exists' operator. */
  value?: unknown;
  severity: RuleSeverity;
  onFail: FailureAction;
  /** Human-readable label for this rule (optional, for UI/audit). */
  label?: string;
}

/**
 * A group of rules combined with AND or OR logic.
 * Groups can be nested (max 3 levels enforced by the engine).
 */
export interface RuleGroup {
  logic: 'AND' | 'OR';
  rules: Array<Rule | RuleGroup>;
}

// ─── Gate Configuration ────────────────────────────────────────────────────

/**
 * Gate mode — stored on the pipeline stage.
 * - auto:   always proceed (no rules evaluated)
 * - rules:  evaluate the rule set
 * - hold:   always hold (manual release required)
 * - manual: same as hold (alias)
 * - skip:   bypass this stage entirely
 */
export type GateMode = 'auto' | 'rules' | 'hold' | 'manual' | 'skip';

// ─── Evaluation Results ────────────────────────────────────────────────────

/** Verdict the engine produces. */
export type GateVerdict = 'proceed' | 'hold' | 'rework' | 'abort';

/** Result of evaluating a single rule. */
export interface RuleResult {
  rule: Rule;
  passed: boolean;
  actualValue: unknown;
  reason: string;
}

/** Result of evaluating a rule group. */
export interface GroupResult {
  logic: 'AND' | 'OR';
  passed: boolean;
  results: Array<RuleResult | GroupResult>;
}

/** Final gate evaluation output. */
export interface GateEvaluation {
  verdict: GateVerdict;
  passed: boolean;
  /** Worst failure action found (drives the verdict). */
  worstAction: FailureAction | null;
  /** Flat list of all individual rule results. */
  ruleResults: RuleResult[];
  /** Structured group result tree. */
  groupResult: GroupResult | null;
  reason: string;
}

// ─── Type Guards ───────────────────────────────────────────────────────────

export function isRuleGroup(item: Rule | RuleGroup): item is RuleGroup {
  return 'logic' in item && 'rules' in item;
}

export function isRule(item: Rule | RuleGroup): item is Rule {
  return 'field' in item && 'operator' in item;
}
