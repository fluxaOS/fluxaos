import { createIssue } from '@/core/issues';
import { getDefaultPipeline, startPipelineRun } from './service';

export async function justDoIt(projectId: string, prompt: string) {
  // 1. Create ephemeral issue
  const issue = await createIssue({
    projectId,
    title: prompt.slice(0, 100),
    description: prompt,
    type: 'task',
    source: 'just-do-it',
  });

  // 2. Find project's default pipeline
  const defaultPipeline = await getDefaultPipeline(projectId);

  // 3. Start pipeline run linked to issue
  const run = await startPipelineRun(defaultPipeline.id, issue.id);

  return { run, issue, pipeline: defaultPipeline };
}
