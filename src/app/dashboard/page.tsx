import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">fluxaOS</h1>
        <p className="text-neutral-400">
          Welcome to fluxaOS. You are authenticated.
        </p>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 space-y-3">
          <h2 className="text-lg font-semibold">Session Info</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-neutral-400">User ID</dt>
            <dd className="font-mono text-xs">{user.id}</dd>
            <dt className="text-neutral-400">Email</dt>
            <dd>{user.email}</dd>
          </dl>
        </div>

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-md bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
