'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewIssuePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [type, setType] = useState('task');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // Get the first project (for now — project switcher comes later)
    const projRes = await fetch('/api/trpc/project.list');
    const projData = await projRes.json();
    const projectId = projData?.result?.data?.[0]?.id;

    if (!projectId) {
      setError('No project found. Run the seed script.');
      setSaving(false);
      return;
    }

    const res = await fetch('/api/trpc/issue.create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title, description, priority, type }),
    });

    const data = await res.json();
    if (data.error) {
      setError(data.error.message);
      setSaving(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/dashboard" className="text-neutral-400 hover:text-white">← Back</Link>
        <h1 className="text-xl font-bold">New Issue</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded bg-red-950/50 border border-red-800 px-4 py-3">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        <div>
          <label className="block text-sm text-neutral-300 mb-1">Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm text-neutral-300 mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-neutral-300 mb-1">Priority</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-neutral-300 mb-1">Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-white"
            >
              <option value="task">Task</option>
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
              <option value="research">Research</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 px-4 py-2 rounded text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Issue'}
        </button>
      </form>
    </div>
  );
}
