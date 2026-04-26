/**
 * Resolves org + user + project from URL slugs.
 * Used by all scoped pages to get the current context.
 */
import { notFound } from 'next/navigation';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { DatabaseProvider } from '@/core/ports/database';
import {
  createOrganizationService,
  createProjectService,
  createUserService,
} from '@/core/services';

export async function resolveContext(
  orgSlug: string,
  userSlug: string,
  projectSlug: string
) {
  bootstrap();
  const db = registry.get<DatabaseProvider>('database').getConnection();

  const orgSvc = createOrganizationService(db);
  const userSvc = createUserService(db);
  const projSvc = createProjectService(db);

  const org = await orgSvc.getBySlug(orgSlug);
  if (!org) notFound();

  const usr = await userSvc.getBySlug(org.id, userSlug);
  if (!usr) notFound();

  const proj = await projSvc.getByUserSlug(usr.id, projectSlug);
  if (!proj) notFound();

  return { db, org, user: usr, project: proj };
}
