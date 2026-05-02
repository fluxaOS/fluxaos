import { z } from 'zod';
import { load as yamlLoad } from 'js-yaml';

const ParallelChildSchema = z.object({
  id: z.string().min(1),
  skill: z.string().min(1),
  trustMode: z.enum(['prescriptive', 'declarative']).optional(),
});

const SequentialStageSchema = z.object({
  type: z.literal('sequential').default('sequential'),
  id: z.string().min(1),
  skill: z.string().min(1),
  onPass: z.string().min(1),
  onFail: z.string().min(1),
  fallback: z.string().min(1),
  trustMode: z.enum(['prescriptive', 'declarative']).default('prescriptive'),
  rules: z.array(z.any()).optional().default([]),
});

const ParallelGroupSchema = z.object({
  type: z.literal('parallel'),
  id: z.string().min(1),
  children: z.array(ParallelChildSchema).min(2),
  aggregation: z.enum(['all-pass', 'any-pass', 'majority-pass', 'none']),
  onPass: z.string().min(1),
  onFail: z.string().min(1),
  fallback: z.string().min(1),
  rules: z.array(z.any()).optional().default([]),
});

// Preprocess stages to inject type:'sequential' when type is absent.
// z.discriminatedUnion requires the discriminant key to be present in raw input
// even when the schema has a .default() — defaults run after the discriminant check.
const PlaybookStageSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object' && !('type' in val)) {
      return { type: 'sequential', ...(val as object) };
    }
    return val;
  },
  z.discriminatedUnion('type', [SequentialStageSchema, ParallelGroupSchema])
);

export const PlaybookSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
  stages: z.array(PlaybookStageSchema).min(1),
});

export type Playbook = z.infer<typeof PlaybookSchema>;
export type PlaybookStage = z.infer<typeof PlaybookStageSchema>;
export type SequentialStage = z.infer<typeof SequentialStageSchema>;
export type ParallelGroup = z.infer<typeof ParallelGroupSchema>;

export function isParallelGroup(stage: PlaybookStage): stage is ParallelGroup {
  return stage.type === 'parallel';
}

export type ParsePlaybookResult =
  | { success: true; playbook: Playbook }
  | { success: false; error: string };

export function parsePlaybook(yamlContent: string, filename: string): ParsePlaybookResult {
  let raw: unknown;
  try {
    raw = yamlLoad(yamlContent);
  } catch (err) {
    return { success: false, error: `YAML parse error in ${filename}: ${String(err)}` };
  }

  const result = PlaybookSchema.safeParse(raw);
  if (!result.success) {
    return { success: false, error: `Schema validation failed in ${filename}: ${result.error.message}` };
  }

  return { success: true, playbook: result.data };
}

export function getStageById(playbook: Playbook, stageId: string): PlaybookStage | undefined {
  return playbook.stages.find(s => s.id === stageId);
}
