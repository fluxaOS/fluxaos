import type { CLIClient } from '../client';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export async function handleSkillCommand(client: CLIClient, args: string[]) {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help') {
    console.log(
      `
fluxaos skill — Manage skills

Usage:
  fluxaos skill list [--project <uuid>]
  fluxaos skill sync --project <uuid> --dir <path>
`.trim()
    );
    return;
  }

  switch (subcommand) {
    case 'list': {
      const projectId = parseFlag(args, '--project');
      const skills = await client.skill.list.query(
        projectId ? { projectId } : undefined
      );
      if (skills.length === 0) {
        console.log('No skills found.');
        return;
      }
      console.log(
        `${'Name'.padEnd(30) + 'Scope'.padEnd(12) + 'Version'.padEnd(10)}Tags`
      );
      console.log('-'.repeat(70));
      for (const s of skills) {
        const tags = Array.isArray(s.tags)
          ? (s.tags as string[]).join(', ')
          : '';
        console.log(
          s.name.padEnd(30) +
            s.scope.padEnd(12) +
            String(s.version ?? 1).padEnd(10) +
            tags
        );
      }
      break;
    }
    case 'sync': {
      const projectId = parseFlag(args, '--project');
      const targetDir = parseFlag(args, '--dir');
      if (!projectId || !targetDir) {
        console.error('Required: --project <uuid> --dir <path>');
        process.exit(1);
      }
      const result = await client.skill.materialize.mutate({
        projectId,
        targetDir,
      });
      console.log(
        `Synced: ${result.written} written, ${result.cleaned} cleaned`
      );
      break;
    }
    default:
      console.error(`Unknown skill subcommand: ${subcommand}`);
      process.exit(1);
  }
}
