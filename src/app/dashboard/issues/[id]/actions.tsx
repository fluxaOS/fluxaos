'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATES = ['open', 'in_progress', 'blocked', 'closed'] as const;

export default function IssueActions({
  issueId,
  currentState,
}: {
  issueId: string;
  currentState: string;
}) {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function callMutation(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/trpc/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (data.error) {
      setError(data.error.message);
      return false;
    }
    router.refresh();
    return true;
  }

  async function handleTransition(state: string) {
    await callMutation('issue.transition', { id: issueId, state });
  }

  async function handleAddComment() {
    if (!comment.trim()) return;
    const ok = await callMutation('issue.addComment', { issueId, text: comment });
    if (ok) setComment('');
  }

  async function handleDelete() {
    if (!confirm('Delete this issue?')) return;
    await callMutation('issue.delete', { id: issueId });
    router.push('/dashboard');
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-red-950/50 border border-red-800 px-3 py-2">
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* State transitions */}
      <div className="flex gap-2 flex-wrap">
        {STATES.filter(s => s !== currentState).map(s => (
          <button
            key={s}
            onClick={() => handleTransition(s)}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50"
          >
            → {s}
          </button>
        ))}
        <button
          onClick={handleDelete}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded bg-red-900 hover:bg-red-800 text-red-300 disabled:opacity-50"
        >
          Delete Issue
        </button>
      </div>

      {/* Add comment */}
      <div className="flex gap-2">
        <input
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Add a comment..."
          className="flex-1 rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleAddComment}
          disabled={busy || !comment.trim()}
          className="text-sm px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
        >
          Comment
        </button>
      </div>
    </div>
  );
}
