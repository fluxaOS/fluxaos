export interface CreateOrganizationInput {
  name: string;
  slug: string;
  settings?: Record<string, unknown>;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  settings?: Record<string, unknown>;
}
