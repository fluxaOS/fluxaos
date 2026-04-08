export interface CreateProjectInput {
  orgId: string;
  name: string;
  slug: string;
  repoUrl?: string;
}

export interface UpdateProjectInput {
  name?: string;
  slug?: string;
  repoUrl?: string;
  defaultPipelineId?: string;
  brandId?: string;
}
