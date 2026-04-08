export interface CreateProviderInput {
  orgId: string;
  name: string;
  type: string;
  baseUrl?: string;
  apiKeyRef?: string;
}

export interface UpdateProviderInput {
  name?: string;
  type?: string;
  baseUrl?: string;
  apiKeyRef?: string;
  isHealthy?: boolean;
}

export interface CreateModelInput {
  providerId: string;
  name: string;
  identifier: string;
  capabilities?: Record<string, unknown>;
  costPer1kInput?: string;
  costPer1kOutput?: string;
}

export interface UpdateModelInput {
  name?: string;
  identifier?: string;
  capabilities?: Record<string, unknown>;
  costPer1kInput?: string;
  costPer1kOutput?: string;
}
