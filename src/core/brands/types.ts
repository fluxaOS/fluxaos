export interface CreateBrandInput {
  orgId: string;
  projectId?: string;
  name: string;
  colors?: Record<string, unknown>;
  fonts?: Record<string, unknown>;
  toneOfVoice?: string;
  styleGuide?: string;
  logoUrl?: string;
}

export interface UpdateBrandInput {
  name?: string;
  colors?: Record<string, unknown>;
  fonts?: Record<string, unknown>;
  toneOfVoice?: string;
  styleGuide?: string;
  logoUrl?: string;
}

export interface BrandFilter {
  orgId?: string;
  projectId?: string;
}
