export type SkillScope = 'global' | 'project';

export interface CreateSkillInput {
  name: string;
  description?: string;
  promptTemplate?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tags?: string[];
  scope?: SkillScope;
  projectId?: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  promptTemplate?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tags?: string[];
  scope?: SkillScope;
}

export interface SkillFilter {
  projectId?: string;
  scope?: SkillScope;
  tags?: string[];
}
