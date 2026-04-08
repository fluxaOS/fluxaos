export type GateVerdict = 'proceed' | 'hold' | 'rework' | 'abort';
export type GateMode = 'auto' | 'manual' | 'hold' | 'rules' | 'skip';

export interface GateRule {
  condition: string;
  params?: Record<string, unknown>;
  onFail: GateVerdict;
}

export interface GateRuleResult {
  rule: GateRule;
  passed: boolean;
}

export interface GateEvaluation {
  verdict: GateVerdict;
  rules: GateRuleResult[];
  reason: string;
}

export interface StageRunContext {
  exitCode: number;
  costUsd: string;
  stderr: string;
  tokensIn: number;
  tokensOut: number;
}
