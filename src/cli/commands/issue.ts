/**
 * `fluxaos issue` subcommands — list, view, create.
 *
 * Backend returns raw issue rows with UUID FKs for type/state/status/priority.
 * The CLI joins them to display names client-side using issueCatalog.*.list,
 * matching what the UI does in components/. No business logic added — pure
 * presentation join.
 */

import type { CliTrpcClient } from '../client';
import type { CliContext } from '../context';
import { printJson, printRows, truncate } from '../format';

type IssueArgs = {
  positional: string[];
  flags: Record<string, string | boolean>;
  json: boolean;
};

type CatalogMaps = {
  typeById: Map<string, { key: string; displayName: string }>;
  typeByKey: Map<string, { id: string; displayName: string }>;
  stateById: Map<string, { key: string; displayName: string }>;
  statusById: Map<string, { key: string; displayName: string }>;
  priorityById: Map<string, { key: string; displayName: string }>;
  priorityByKey: Map<string, { id: string; displayName: string }>;
};

async function loadCatalogs(
  client: CliTrpcClient,
  projectId: string
): Promise<CatalogMaps> {
  const [types, states, statuses, priorities] = await Promise.all([
    client.issueCatalog.types.list.query({ projectId }),
    client.issueCatalog.states.list.query({ projectId }),
    client.issueCatalog.statuses.list.query({ projectId }),
    client.issueCatalog.priorities.list.query({ projectId }),
  ]);
  return {
    typeById: new Map(
      types.map((t) => [t.id, { key: t.key, displayName: t.displayName }])
    ),
    typeByKey: new Map(
      types.map((t) => [t.key, { id: t.id, displayName: t.displayName }])
    ),
    stateById: new Map(
      states.map((s) => [s.id, { key: s.key, displayName: s.displayName }])
    ),
    statusById: new Map(
      statuses.map((s) => [s.id, { key: s.key, displayName: s.displayName }])
    ),
    priorityById: new Map(
      priorities.map((p) => [p.id, { key: p.key, displayName: p.displayName }])
    ),
    priorityByKey: new Map(
      priorities.map((p) => [p.key, { id: p.id, displayName: p.displayName }])
    ),
  };
}

export async function runIssue(
  client: CliTrpcClient,
  context: CliContext,
  args: IssueArgs
): Promise<number> {
  const sub = args.positional[0];
  switch (sub) {
    case 'list':
      return listIssues(client, context, args);
    case 'view':
      return viewIssue(client, context, args);
    case 'create':
      return createIssue(client, context, args);
    default:
      console.error(
        `Unknown issue subcommand: ${sub ?? '<none>'}\n` +
          'Usage:\n' +
          '  fluxaos issue list\n' +
          '  fluxaos issue view <number>\n' +
          '  fluxaos issue create <title> [--description ...] [--type bug] [--priority medium]'
      );
      return 2;
  }
}

async function listIssues(
  client: CliTrpcClient,
  context: CliContext,
  args: IssueArgs
): Promise<number> {
  const [issues, catalogs] = await Promise.all([
    client.issue.list.query({ projectId: context.projectId }),
    loadCatalogs(client, context.projectId),
  ]);
  if (args.json) {
    printJson(issues);
    return 0;
  }
  if (issues.length === 0) {
    console.log('No issues.');
    return 0;
  }
  printRows(
    [
      { key: 'number', label: '#', width: 5 },
      { key: 'title', label: 'Title', width: 50 },
      { key: 'state', label: 'State', width: 14 },
      { key: 'status', label: 'Status', width: 12 },
      { key: 'priority', label: 'Priority', width: 12 },
      { key: 'type', label: 'Type', width: 12 },
    ],
    issues.map((i) => ({
      number: i.number,
      title: i.title,
      state: catalogs.stateById.get(i.stateId)?.displayName ?? null,
      status: catalogs.statusById.get(i.statusId)?.displayName ?? null,
      priority: catalogs.priorityById.get(i.priorityId)?.displayName ?? null,
      type: catalogs.typeById.get(i.typeId)?.displayName ?? null,
    }))
  );
  console.log(`\n${issues.length} issue(s)`);
  return 0;
}

async function viewIssue(
  client: CliTrpcClient,
  context: CliContext,
  args: IssueArgs
): Promise<number> {
  const numberRaw = args.positional[1];
  const num = numberRaw ? Number.parseInt(numberRaw, 10) : NaN;
  if (!Number.isFinite(num) || num <= 0) {
    console.error('Usage: fluxaos issue view <number>');
    return 2;
  }
  const [result, catalogs] = await Promise.all([
    client.issue.getByNumber.query({
      projectId: context.projectId,
      number: num,
    }),
    loadCatalogs(client, context.projectId),
  ]);
  if (!result) {
    console.error(`Issue #${num} not found in project ${context.projectId}.`);
    return 1;
  }
  if (args.json) {
    printJson(result);
    return 0;
  }
  console.log(`#${result.number} — ${result.title}`);
  console.log(
    `State:    ${catalogs.stateById.get(result.stateId)?.displayName ?? '–'}`
  );
  console.log(
    `Status:   ${catalogs.statusById.get(result.statusId)?.displayName ?? '–'}`
  );
  console.log(
    `Priority: ${catalogs.priorityById.get(result.priorityId)?.displayName ?? '–'}`
  );
  console.log(
    `Type:     ${catalogs.typeById.get(result.typeId)?.displayName ?? '–'}`
  );
  if (result.assignee) console.log(`Assignee: ${result.assignee}`);
  if (result.bodyMd) {
    console.log(`\n${truncate(result.bodyMd, 2000)}`);
  }
  return 0;
}

async function createIssue(
  client: CliTrpcClient,
  context: CliContext,
  args: IssueArgs
): Promise<number> {
  const title = args.positional.slice(1).join(' ').trim();
  if (!title) {
    console.error(
      'Usage: fluxaos issue create <title> [--description ...] [--type bug] [--priority medium]'
    );
    return 2;
  }

  const typeKey = String(args.flags.type ?? 'task').trim();
  const priorityKey = String(args.flags.priority ?? 'medium').trim();
  const description =
    typeof args.flags.description === 'string'
      ? args.flags.description
      : undefined;

  const catalogs = await loadCatalogs(client, context.projectId);
  const type = catalogs.typeByKey.get(typeKey);
  if (!type) {
    const available = [...catalogs.typeByKey.keys()].join(', ');
    console.error(`Unknown issue type "${typeKey}". Available: ${available}`);
    return 2;
  }
  const priority = catalogs.priorityByKey.get(priorityKey);
  if (!priority) {
    const available = [...catalogs.priorityByKey.keys()].join(', ');
    console.error(`Unknown priority "${priorityKey}". Available: ${available}`);
    return 2;
  }

  const created = await client.issue.create.mutate({
    projectId: context.projectId,
    title,
    bodyMd: description,
    typeId: type.id,
    priorityId: priority.id,
  });
  if (args.json) {
    printJson(created);
  } else {
    console.log(`Created issue #${created.number}: ${created.title}`);
  }
  return 0;
}
