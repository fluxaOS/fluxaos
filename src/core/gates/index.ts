/**
 * Gate Engine barrel export.
 */
export { evaluateGate } from './engine';
export { createGateService, type GateService } from './service';
export type {
  Rule,
  RuleGroup,
  RuleOperator,
  RuleSeverity,
  FailureAction,
  GateMode,
  GateVerdict,
  RuleResult,
  GroupResult,
  GateEvaluation,
} from './types';
export { isRule, isRuleGroup } from './types';
