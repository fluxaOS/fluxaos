/**
 * `fluxaos run --issue <number> [--stage <name>]`.
 *
 * Triggers a manual pipeline run by calling pipeline.runs.trigger — the
 * same procedure the UI's "Run pipeline" button hits. Resolves issue
 * number → UUID, picks the project's default pipeline, and selects either
 * the named stage or stages[0] (sorted by sortOrder).
 *
 * Does not wait for completion or stream events. The run starts at
 * `pending`; the orchestrator daemon picks it up. Use `npm run db:runs`
 * or the web UI to observe status.
 */

import type { CliTrpcClient } from '../client';
import type { CliContext } from '../context';
import { printJson } from '../format';

type RunArgs = {
  flags: Record<string, string | boolean>;
  json: boolean;
};

export async function runRun(
  client: CliTrpcClient,
  context: CliContext,
  args: RunArgs
): Promise<number> {
  const issueRaw = args.flags.issue;
  if (typeof issueRaw !== 'string') {
    console.error('Usage: fluxaos run --issue <number> [--stage <name>]');
    return 2;
  }
  const issueNumber = Number.parseInt(issueRaw, 10);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    console.error(`Invalid --issue value: ${issueRaw}`);
    return 2;
  }

  if (!context.defaultPipelineId) {
    console.error(
      `Project "${context.projectSlug}" has no default pipeline. ` +
        'Set one in Settings → Pipelines, then retry.'
    );
    return 1;
  }

  const issue = await client.issue.getByNumber.query({
    projectId: context.projectId,
    number: issueNumber,
  });
  if (!issue) {
    console.error(
      `Issue #${issueNumber} not found in project ${context.projectSlug}.`
    );
    return 1;
  }

  const stages = await client.pipeline.stages.listByPipeline.query({
    pipelineId: context.defaultPipelineId,
  });
  if (stages.length === 0) {
    console.error('Default pipeline has no stages.');
    return 1;
  }
  const sorted = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);

  const stageNameRaw = args.flags.stage;
  let stageId: string;
  let stageName: string;
  if (typeof stageNameRaw === 'string' && stageNameRaw.trim()) {
    const needle = stageNameRaw.trim().toLowerCase();
    const match = sorted.find((s) => s.name.toLowerCase() === needle);
    if (!match) {
      const available = sorted.map((s) => s.name).join(', ');
      console.error(
        `Stage "${stageNameRaw}" not found. Available: ${available}`
      );
      return 2;
    }
    stageId = match.id;
    stageName = match.name;
  } else {
    stageId = sorted[0].id;
    stageName = sorted[0].name;
  }

  const run = await client.pipeline.runs.trigger.mutate({
    pipelineId: context.defaultPipelineId,
    issueId: issue.id,
    stageId,
  });
  if (args.json) {
    printJson(run);
  } else {
    console.log(
      `Triggered run ${run.id} on issue #${issueNumber} (stage: ${stageName})`
    );
    console.log('Run is pending; orchestrator will pick it up.');
  }
  return 0;
}
