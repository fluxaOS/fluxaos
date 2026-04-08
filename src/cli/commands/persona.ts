import type { CLIClient } from '../client';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export async function handlePersonaCommand(client: CLIClient, args: string[]) {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help') {
    console.log(
      `
fluxaos persona — Manage personas

Usage:
  fluxaos persona list [--project <uuid>] [--scope <global|project>]
  fluxaos persona view <uuid> [--resolve]
  fluxaos persona create --name <str> [--scope <global|project>] [--project <uuid>] [--soul <str>]
`.trim()
    );
    return;
  }

  switch (subcommand) {
    case 'list': {
      const projectId = parseFlag(args, '--project');
      const scope = parseFlag(args, '--scope') as
        | 'global'
        | 'project'
        | undefined;
      const personas = await client.persona.list.query(
        projectId || scope ? { projectId, scope } : undefined
      );
      if (personas.length === 0) {
        console.log('No personas found.');
        return;
      }
      console.log(
        `${'Name'.padEnd(25)}${'Scope'.padEnd(12)}${'Soul'.padEnd(40)}Parent`
      );
      console.log('-'.repeat(90));
      for (const p of personas) {
        const soul = p.soul
          ? p.soul.length > 37
            ? `${p.soul.slice(0, 37)}...`
            : p.soul
          : '(none)';
        console.log(
          `${p.name.padEnd(25)}${p.scope.padEnd(12)}${soul.padEnd(40)}${p.parentPersonaId ?? '-'}`
        );
      }
      break;
    }
    case 'view': {
      const id = args[1];
      if (!id) {
        console.error('Required: fluxaos persona view <uuid>');
        process.exit(1);
      }
      const resolve = args.includes('--resolve');
      const persona = await client.persona.getById.query({ id, resolve });
      console.log(`Persona: ${persona.id}`);
      console.log(`  Name: ${persona.name}`);
      console.log(`  Scope: ${persona.scope}`);
      console.log(`  Soul: ${persona.soul ?? '(none)'}`);
      if (persona.projectId) console.log(`  Project: ${persona.projectId}`);
      if (persona.parentPersonaId)
        console.log(`  Parent: ${persona.parentPersonaId}`);
      if (persona.brandId) console.log(`  Brand: ${persona.brandId}`);
      if (persona.routingProfileId)
        console.log(`  Routing Profile: ${persona.routingProfileId}`);
      if (resolve && 'skills' in persona) {
        const resolved = persona as { skills: Array<{ skillName: string }> };
        console.log(
          `  Skills: ${resolved.skills.length > 0 ? resolved.skills.map((s) => s.skillName).join(', ') : '(none)'}`
        );
      }
      break;
    }
    case 'create': {
      const name = parseFlag(args, '--name');
      if (!name) {
        console.error('Required: --name <str>');
        process.exit(1);
      }
      const scope = parseFlag(args, '--scope') as
        | 'global'
        | 'project'
        | undefined;
      const projectId = parseFlag(args, '--project');
      const soul = parseFlag(args, '--soul');
      const created = await client.persona.create.mutate({
        name,
        scope,
        projectId,
        soul,
      });
      console.log(`Created persona: ${created.id}`);
      console.log(`  Name: ${created.name}`);
      console.log(`  Scope: ${created.scope}`);
      console.log(`  Soul: ${created.soul ?? '(none)'}`);
      break;
    }
    default:
      console.error(`Unknown persona subcommand: ${subcommand}`);
      process.exit(1);
  }
}
