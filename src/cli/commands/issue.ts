import type { CLIClient } from '../client';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export async function handleIssueCommand(client: CLIClient, args: string[]) {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help') {
    console.log(
      `
fluxaos issue — Manage issues

Usage:
  fluxaos issue list --project <uuid>
  fluxaos issue create --project <uuid> --title <str> [--type <str>] [--priority <str>]
  fluxaos issue view <uuid>
`.trim()
    );
    return;
  }

  switch (subcommand) {
    case 'list': {
      const projectId = parseFlag(args, '--project');
      if (!projectId) {
        console.error('Required: --project <uuid>');
        process.exit(1);
      }
      const issues = await client.issue.list.query({ projectId });
      if (issues.length === 0) {
        console.log('No issues found.');
        return;
      }
      console.log(
        'Title'.padEnd(40) + 'State'.padEnd(15) + 'Priority'.padEnd(12) + 'Type'
      );
      console.log('-'.repeat(75));
      for (const i of issues) {
        console.log(
          (i.title ?? '').padEnd(40) +
            (i.state ?? '').padEnd(15) +
            (i.priority ?? '').padEnd(12) +
            (i.type ?? '')
        );
      }
      break;
    }
    case 'create': {
      const projectId = parseFlag(args, '--project');
      const title = parseFlag(args, '--title');
      if (!projectId || !title) {
        console.error('Required: --project <uuid> --title <str>');
        process.exit(1);
      }
      const type = parseFlag(args, '--type') as
        | 'task'
        | 'bug'
        | 'feature'
        | 'research'
        | undefined;
      const priority = parseFlag(args, '--priority') as
        | 'low'
        | 'medium'
        | 'high'
        | 'critical'
        | undefined;
      const created = await client.issue.create.mutate({
        projectId,
        title,
        type,
        priority,
      });
      console.log(`Created issue: ${created.id}`);
      console.log(`  Title: ${created.title}`);
      console.log(`  State: ${created.state}`);
      console.log(`  Priority: ${created.priority}`);
      break;
    }
    case 'view': {
      const id = args[1];
      if (!id) {
        console.error('Required: fluxaos issue view <uuid>');
        process.exit(1);
      }
      const issue = await client.issue.getById.query({ id });
      console.log(`Issue: ${issue.id}`);
      console.log(`  Title: ${issue.title}`);
      console.log(`  State: ${issue.state}`);
      console.log(`  Priority: ${issue.priority}`);
      console.log(`  Type: ${issue.type}`);
      console.log(`  Description: ${issue.description ?? '(none)'}`);
      console.log(`  Created: ${issue.createdAt}`);
      break;
    }
    default:
      console.error(`Unknown issue subcommand: ${subcommand}`);
      process.exit(1);
  }
}
