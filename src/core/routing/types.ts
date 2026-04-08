export interface CreateRoutingProfileInput {
  orgId: string;
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpdateRoutingProfileInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
}

export interface CreateRoutingRuleInput {
  profileId: string;
  stageName?: string;
  allowedModelsPattern?: string;
  preferredHarness?: string;
  fallbackHarness?: string;
  sortStrategy?: string;
  maxCostUsd?: string;
}

export interface UpdateRoutingRuleInput {
  stageName?: string;
  allowedModelsPattern?: string;
  preferredHarness?: string;
  fallbackHarness?: string;
  sortStrategy?: string;
  maxCostUsd?: string;
}
