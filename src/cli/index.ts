#!/usr/bin/env tsx
import { createCLIClient } from './client';
import { handleConfigCommand } from './commands/config';
import { handleIssueCommand } from './commands/issue';
import { handlePersonaCommand } from './commands/persona';
import { handleSkillCommand } from './commands/skill';
import { handleStatusCommand } from './commands/status';

function printHelp() {
  console.log(
    `
fluxaos — AI orchestration OS

Usage: fluxaos <command> [options]

Commands:
  issue    Manage issues (list, create, view)
  skill    Manage skills (list, sync)
  persona  Manage personas (list, view, create)
  config   View configuration (providers, routing, brands)
  status   Show server health

Run "fluxaos <command>" for command-specific help.
`.trim()
  );
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  const baseUrl = process.env.FLUXAOS_URL;
  const client = createCLIClient(baseUrl);
  const subArgs = args.slice(1);

  switch (command) {
    case 'issue':
      await handleIssueCommand(client, subArgs);
      break;
    case 'skill':
      await handleSkillCommand(client, subArgs);
      break;
    case 'persona':
      await handlePersonaCommand(client, subArgs);
      break;
    case 'config':
      await handleConfigCommand(client, subArgs);
      break;
    case 'status':
      await handleStatusCommand(client);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
