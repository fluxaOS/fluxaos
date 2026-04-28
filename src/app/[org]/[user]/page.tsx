// src/app/[org]/[user]/page.tsx
// FLX-1 — projects index for an org+user. Lists all the user's projects
// with links into each. Lives outside the [project] layout (no Nav, no
// project-scoped TRPCProvider) — this is intentional: the user hasn't
// picked a project yet, so the project-scoped chrome doesn't apply.

import { notFound } from 'next/navigation';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { DatabaseProvider } from '@/core/ports/database';
import {
  createOrganizationService,
  createProjectService,
  createUserService,
} from '@/core/services';
import { ProjectsIndexClient } from './projects-index-client';

type Props = {
  params: Promise<{ org: string; user: string }>;
};

export default async function ProjectsIndexPage({ params }: Props) {
  const { org: orgSlug, user: userSlug } = await params;
  bootstrap();
  const db = registry.get<DatabaseProvider>('database').getConnection();

  const orgSvc = createOrganizationService(db);
  const userSvc = createUserService(db);
  const projSvc = createProjectService(db);

  const org = await orgSvc.getBySlug(orgSlug);
  if (!org) notFound();
  const usr = await userSvc.getBySlug(org.id, userSlug);
  if (!usr) notFound();

  const projects = await projSvc.listByUser(usr.id);

  return (
    <ProjectsIndexClient
      orgSlug={orgSlug}
      userSlug={userSlug}
      orgName={org.name}
      userName={usr.name}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        repoUrl: p.repoUrl,
        defaultBranch: p.defaultBranch,
      }))}
    />
  );
}
