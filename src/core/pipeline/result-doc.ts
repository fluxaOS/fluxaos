import { z } from 'zod';

const BlockerSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

const TimingSchema = z.object({
  startedAt: z.string(),
  endedAt: z.string().optional(),
  duration_sec: z.number().optional(),
});

const MetaSchema = z.object({
  model: z.string().optional(),
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  targetPipeline: z.string().optional(),
});

export const ResultDocSchema = z.object({
  issue: z.object({ id: z.string(), number: z.number(), title: z.string() }),
  run: z.object({
    pipelineRunId: z.string(),
    stageRunId: z.string(),
    stage: z.string(),
    attempt: z.number(),
  }),
  org: z.object({ id: z.string(), slug: z.string() }),
  project: z.object({ id: z.string(), slug: z.string() }),
  timing: TimingSchema,
  verdict: z.enum(['pass', 'fail', 'blocked']),
  summary: z.string().min(1),
  comment: z.string().optional(),
  blockers: z.array(BlockerSchema).optional(),
  artifacts: z.array(z.string()).optional(),
  meta: MetaSchema.optional(),
  signal_reason: z.string().optional(),
  signal_meta: z.record(z.string(), z.unknown()).optional(),
});

export type ResultDoc = z.infer<typeof ResultDocSchema>;

export type ValidateResultDocResult =
  | { success: true; data: ResultDoc }
  | { success: false; error: z.ZodError };

export function validateResultDoc(raw: unknown): ValidateResultDocResult {
  const result = ResultDocSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}

export function isValidResultDoc(raw: unknown): raw is ResultDoc {
  return ResultDocSchema.safeParse(raw).success;
}
