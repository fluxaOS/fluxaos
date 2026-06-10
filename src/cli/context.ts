/**
 * Resolve the active project context for CLI commands.
 *
 * FLX-271: the CLI addresses the project by UUID (FLUXAOS_CLI_PROJECT_ID) —
 * tenancy slugs were dropped in FLX-239 Stage 8. Returns the UUIDs every
 * downstream tRPC call needs.
 */

import type { CliTrpcClient } from './client';
import type { CliConfig } from './config';

export type CliContext = {
  orgId: string;
  userId: string;
  projectId: string;
  defaultPipelineId: string | null;
};

export async function resolveContext(
  client: CliTrpcClient,
  config: CliConfig
): Promise<CliContext> {
  const proj = await client.project.getById.query({ id: config.projectId });
  if (!proj) {
    throw new Error(
      `No project found with id "${config.projectId}". ` +
        'Set FLUXAOS_CLI_PROJECT_ID, or run `npm run db:seed`.'
    );
  }
  const users = await client.user.listByOrg.query({ orgId: proj.orgId });
  const [usr] = users;
  if (!usr) {
    throw new Error(
      `No user found for project "${config.projectId}" in org ${proj.orgId}. Run npm run db:seed.`
    );
  }
  return {
    orgId: proj.orgId,
    userId: usr.id,
    projectId: proj.id,
    defaultPipelineId: proj.defaultPipelineId ?? null,
  };
}
