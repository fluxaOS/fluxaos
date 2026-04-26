/**
 * Gate Engine barrel export.
 */
export { evaluateGate } from './engine';
export { createGateService, type GateService } from './service';
export type {
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
export { isRuleGroup } from './types';
