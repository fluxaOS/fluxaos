import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createTRPCContext } from '@/server/trpc';
import { createOrganizationService, createProjectService } from '@/core/services';

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Redirect to first org/project
  const { db } = createTRPCContext();
  const orgs = await createOrganizationService(db).list();
  if (orgs.length === 0) redirect('/login');

  const projects = await createProjectService(db).listByOrg(orgs[0].id);
  if (projects.length === 0) redirect('/login');

  redirect(`/${orgs[0].slug}/${projects[0].slug}`);
}
