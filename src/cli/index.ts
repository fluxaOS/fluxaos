#!/usr/bin/env node
/**
 * fluxaos CLI entrypoint.
 *
 * Thin tRPC HTTP client wrapping the same surface the web UI uses.
 *
 * Commands:
 *   fluxaos status
 *   fluxaos issue list|view|create
 *   fluxaos run --issue <number> [--stage <name>]
 *
 * Env (all required; see src/cli/config.ts for full docs):
 *   FLUXAOS_API_URL              e.g. http://localhost:3004/api/trpc
 *   FLUXAOS_CLI_ORG_SLUG         e.g. default
 *   FLUXAOS_CLI_USER_SLUG        e.g. admin
 *   FLUXAOS_CLI_PROJECT_SLUG     e.g. fluxaos
 *
 * Auth: requires FLUXAOS_LAN_AUTH_BYPASS=1 on the server. Real Supabase
 * OAuth from the CLI is out of scope for FLX-2.
 *
 * Exit codes: 0 ok, 1 runtime/server error, 2 config/argument error.
 */
import { createCliClient } from './client';
import { runIssue } from './commands/issue';
import { runRun } from './commands/run';
import { runStatus } from './commands/status';
import { CliConfigError, loadConfig } from './config';
import { resolveContext } from './context';

type ParsedArgs = {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
  json: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === '--json') {
      json = true;
      continue;
    }
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
      continue;
    }
    positional.push(tok);
  }

  return {
    command: positional[0],
    positional: positional.slice(1),
    flags,
    json,
  };
}

function printHelp(): void {
  console.log(
    [
      'Usage: fluxaos <command> [...args]',
      '',
      'Commands:',
      '  status                                Show API + project reachability',
      '  issue list                            List issues in the active project',
      '  issue view <number>                   Show one issue',
      '  issue create <title> [...flags]       Create an issue',
      '  run --issue <number> [--stage <name>] Trigger a pipeline run',
      '',
      'Global flags:',
      '  --json    Emit machine-readable JSON to stdout',
      '',
      'Env: see src/cli/config.ts',
    ].join('\n')
  );
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.command === 'help' || parsed.flags.help) {
    printHelp();
    return parsed.command ? 0 : 2;
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof CliConfigError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const client = createCliClient(config);

  // `status` doesn't need a resolved context — it tries to resolve and
  // reports the result either way.
  if (parsed.command === 'status') {
    return runStatus(client, config, parsed.json);
  }

  let context;
  try {
    context = await resolveContext(client, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    return 1;
  }

  switch (parsed.command) {
    case 'issue':
      return runIssue(client, context, {
        positional: parsed.positional,
        flags: parsed.flags,
        json: parsed.json,
      });
    case 'run':
      return runRun(client, context, {
        flags: parsed.flags,
        json: parsed.json,
      });
    default:
      console.error(`Unknown command: ${parsed.command}`);
      printHelp();
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`fluxaos: ${msg}`);
    process.exit(1);
  });
