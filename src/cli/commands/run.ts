import type { CLIClient } from '../client';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function formatStatus(status: string): string {
  const icons: Record<string, string> = {
    pending: '[.]',
    running: '[>]',
    completed: '[+]',
    failed: '[x]',
    cancelled: '[-]',
    queued: '[.]',
    skipped: '[-]',
    rework: '[~]',
  };
  return `${icons[status] ?? '[?]'} ${status}`;
}

export async function handleDoCommand(client: CLIClient, args: string[]) {
  const prompt = args.join(' ');
  if (!prompt) {
    console.error('Usage: fluxaos do "<prompt>"');
    process.exit(1);
  }

  const projectId =
    parseFlag(args, '--project') ?? process.env.FLUXAOS_PROJECT_ID;
  if (!projectId) {
    console.error(
      'Required: --project <uuid> or set FLUXAOS_PROJECT_ID env var'
    );
    process.exit(1);
  }

  // Filter out --project flag from prompt
  const filteredArgs = args.filter((a, i) => {
    if (a === '--project') return false;
    if (i > 0 && args[i - 1] === '--project') return false;
    return true;
  });
  const cleanPrompt = filteredArgs.join(' ');

  console.log(`Starting pipeline for: "${cleanPrompt.slice(0, 80)}..."`);
  const result = await client.pipeline.justDoIt.mutate({
    projectId,
    prompt: cleanPrompt,
  });

  console.log(`Pipeline run: ${result.run.id}`);
  console.log(`  Issue: ${result.issue.id}`);
  console.log(`  Pipeline: ${result.pipeline.name}`);
  console.log(`  Status: ${result.run.status}`);
}

export async function handleRunCommand(client: CLIClient, args: string[]) {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help') {
    console.log(
      `
fluxaos run — Manage pipeline runs

Usage:
  fluxaos run start --pipeline <uuid> [--issue <uuid>]
  fluxaos run status <uuid>
  fluxaos run cancel <uuid>
  fluxaos run list --pipeline <uuid>
`.trim()
    );
    return;
  }

  switch (subcommand) {
    case 'start': {
      const pipelineId = parseFlag(args, '--pipeline');
      if (!pipelineId) {
        console.error('Required: --pipeline <uuid>');
        process.exit(1);
      }
      const issueId = parseFlag(args, '--issue');
      const run = await client.pipeline.startRun.mutate({
        pipelineId,
        issueId,
      });
      console.log(`Started pipeline run: ${run.id}`);
      console.log(`  Status: ${run.status}`);
      break;
    }
    case 'status': {
      const id = args[1];
      if (!id) {
        console.error('Required: fluxaos run status <uuid>');
        process.exit(1);
      }
      const run = await client.pipeline.getRun.query({ id });
      console.log(`Pipeline Run: ${run.id}`);
      console.log(`  Status: ${formatStatus(run.status)}`);
      console.log(`  Started: ${run.startedAt ?? 'not started'}`);
      console.log(`  Cost: $${run.totalCostUsd}`);
      console.log(`  Stages:`);
      for (const sr of run.stageRuns) {
        console.log(
          `    ${formatStatus(sr.status)} ${sr.pipelineStage.name}` +
            (sr.harness ? ` (${sr.harness})` : '')
        );
      }
      break;
    }
    case 'cancel': {
      const id = args[1];
      if (!id) {
        console.error('Required: fluxaos run cancel <uuid>');
        process.exit(1);
      }
      const run = await client.pipeline.cancelRun.mutate({ id });
      console.log(`Cancelled pipeline run: ${run.id}`);
      break;
    }
    case 'list': {
      const pipelineId = parseFlag(args, '--pipeline');
      if (!pipelineId) {
        console.error('Required: --pipeline <uuid>');
        process.exit(1);
      }
      const runs = await client.pipeline.listRuns.query({ pipelineId });
      if (runs.length === 0) {
        console.log('No runs found.');
        return;
      }
      console.log(
        `${'ID'.padEnd(40)}${'Status'.padEnd(15)}${'Cost'.padEnd(12)}Started`
      );
      console.log('-'.repeat(80));
      for (const r of runs) {
        console.log(
          r.id.padEnd(40) +
            (r.status ?? '').padEnd(15) +
            `$${r.totalCostUsd}`.padEnd(12) +
            (r.startedAt ?? 'pending')
        );
      }
      break;
    }
    default:
      console.error(`Unknown run subcommand: ${subcommand}`);
      process.exit(1);
  }
}
