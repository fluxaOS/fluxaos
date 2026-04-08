import type { CLIClient } from '../client';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export async function handleConfigCommand(client: CLIClient, args: string[]) {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help') {
    console.log(
      `
fluxaos config — View configuration

Usage:
  fluxaos config providers --org <uuid>
  fluxaos config routing --org <uuid>
  fluxaos config brands [--org <uuid>]
`.trim()
    );
    return;
  }

  switch (subcommand) {
    case 'providers': {
      const orgId = parseFlag(args, '--org');
      if (!orgId) {
        console.error('Required: --org <uuid>');
        process.exit(1);
      }
      const providers = await client.provider.list.query({ orgId });
      if (providers.length === 0) {
        console.log('No providers configured.');
        return;
      }
      console.log(
        `${'Name'.padEnd(20)}${'Type'.padEnd(15)}${'Healthy'.padEnd(10)}URL`
      );
      console.log('-'.repeat(70));
      for (const p of providers) {
        console.log(
          `${p.name.padEnd(20)}${p.type.padEnd(15)}${String(p.isHealthy ?? true).padEnd(10)}${p.baseUrl ?? '-'}`
        );
      }
      break;
    }
    case 'routing': {
      const orgId = parseFlag(args, '--org');
      if (!orgId) {
        console.error('Required: --org <uuid>');
        process.exit(1);
      }
      const profiles = await client.routing.listProfiles.query({ orgId });
      if (profiles.length === 0) {
        console.log('No routing profiles configured.');
        return;
      }
      console.log(`${'Name'.padEnd(25)}${'Default'.padEnd(10)}Description`);
      console.log('-'.repeat(70));
      for (const p of profiles) {
        console.log(
          `${p.name.padEnd(25)}${String(p.isDefault ?? false).padEnd(10)}${p.description ?? '-'}`
        );
      }
      break;
    }
    case 'brands': {
      const orgId = parseFlag(args, '--org');
      const brands = await client.brand.list.query(
        orgId ? { orgId } : undefined
      );
      if (brands.length === 0) {
        console.log('No brands configured.');
        return;
      }
      console.log(`${'Name'.padEnd(25)}${'Tone'.padEnd(20)}Logo`);
      console.log('-'.repeat(65));
      for (const b of brands) {
        console.log(
          `${b.name.padEnd(25)}${(b.toneOfVoice ?? '-').padEnd(20)}${b.logoUrl ?? '-'}`
        );
      }
      break;
    }
    default:
      console.error(`Unknown config subcommand: ${subcommand}`);
      process.exit(1);
  }
}
