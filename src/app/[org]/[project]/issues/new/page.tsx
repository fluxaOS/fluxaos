'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

export default function NewIssuePage() {
  const router = useRouter();
  const params = useParams<{ org: string; project: string }>();
  const base = `/${params.org}/${params.project}`;

  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    type: 'task',
    source: 'web',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // Get project ID from slug
    const projRes = await fetch('/api/trpc/project.list');
    const projData = await projRes.json();
    const project = projData?.result?.data?.find(
      (p: { slug: string }) => p.slug === params.project,
    );

    if (!project) {
      setError('Project not found.');
      setSaving(false);
      return;
    }

    const res = await fetch('/api/trpc/issue.create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        type: form.type,
        source: form.source,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setError(data.error.message);
      setSaving(false);
      return;
    }

    router.push(`${base}/issues/${data.result.data.id}`);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href={base} className="text-neutral-400 hover:text-white">← Back</Link>
        <h1 className="text-xl font-bold">New Issue</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded bg-red-950/50 border border-red-800 px-4 py-3">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        <div>
          <label className="block text-sm text-neutral-300 mb-1">Title *</label>
          <input
            value={form.title}
            onChange={e => set('title', e.target.value)}
            required
            className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm text-neutral-300 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={5}
            className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-neutral-300 mb-1">Priority</label>
            <select
              value={form.priority}
              onChange={e => set('priority', e.target.value)}
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
              value={form.type}
              onChange={e => set('type', e.target.value)}
              className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-white"
            >
              <option value="task">Task</option>
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
              <option value="research">Research</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-neutral-300 mb-1">Source</label>
            <select
              value={form.source}
              onChange={e => set('source', e.target.value)}
              className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-white"
            >
              <option value="web">Web</option>
              <option value="cli">CLI</option>
              <option value="api">API</option>
              <option value="github">GitHub</option>
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
