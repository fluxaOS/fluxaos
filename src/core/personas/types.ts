export type PersonaScope = 'global' | 'project';

export interface CreatePersonaInput {
  name: string;
  scope?: PersonaScope;
  projectId?: string;
  soul?: string;
  identity?: Record<string, unknown>;
  brandId?: string;
  routingProfileId?: string;
  parentPersonaId?: string;
}

export interface UpdatePersonaInput {
  name?: string;
  scope?: PersonaScope;
  projectId?: string;
  soul?: string;
  identity?: Record<string, unknown>;
  brandId?: string;
  routingProfileId?: string;
  parentPersonaId?: string;
}

export interface PersonaFilter {
  projectId?: string;
  scope?: PersonaScope;
}

export interface ResolvedPersona {
  id: string;
  name: string;
  scope: string;
  projectId: string | null;
  soul: string | null;
  identity: Record<string, unknown>;
  brandId: string | null;
  routingProfileId: string | null;
  parentPersonaId: string | null;
  skills: Array<{
    skillId: string;
    skillName: string;
    enabled: boolean | null;
    configOverrides: unknown;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
