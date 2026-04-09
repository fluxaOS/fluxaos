/**
 * Resolves org + project from URL slugs.
 * Used by all scoped pages to get the current context.
 */
import { notFound } from 'next/navigation';
import { createTRPCContext } from '@/server/trpc';
import { createOrganizationService, createProjectService } from '@/core/services';

export async function resolveContext(orgSlug: string, projectSlug: string) {
  const { db } = createTRPCContext();
  const orgSvc = createOrganizationService(db);
  const projSvc = createProjectService(db);

  const org = await orgSvc.getBySlug(orgSlug);
  if (!org) notFound();

  const project = await projSvc.getBySlug(org.id, projectSlug);
  if (!project) notFound();

  return { db, org, project };
}
