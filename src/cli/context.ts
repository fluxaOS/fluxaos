/**
 * Resolve the active project context for CLI commands.
 *
 * Single-tenant assumption: the CLI looks up the project by slug only.
 * In a multi-tenant deployment this would need org-scoped resolution,
 * but the homelab model uses unique project slugs per tenant. Returns
 * the UUIDs every downstream tRPC call needs.
 */

import type { CliTrpcClient } from './client';
import type { CliConfig } from './config';

export type CliContext = {
  orgId: string;
  userId: string;
  projectId: string;
  projectSlug: string;
  defaultPipelineId: string | null;
};

export async function resolveContext(
  client: CliTrpcClient,
  config: CliConfig
): Promise<CliContext> {
  const proj = await client.project.getBySlug.query({
    slug: config.projectSlug,
  });
  if (!proj) {
    throw new Error(
      `No project found with slug "${config.projectSlug}". ` +
        'Set FLUXAOS_CLI_PROJECT_SLUG, or run `npm run db:seed`.'
    );
  }
  return {
    orgId: proj.orgId,
    userId: proj.userId,
    projectId: proj.id,
    projectSlug: proj.slug,
    defaultPipelineId: proj.defaultPipelineId ?? null,
  };
}
