'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const STATES = ['open', 'in_progress', 'blocked', 'closed'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const TYPES = ['task', 'bug', 'feature', 'research'] as const;

interface IssueData {
  title: string;
  description: string;
  state: string;
  priority: string;
  type: string;
  source: string;
  createdAt: string;
}

interface EventData {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface StageData {
  id: string;
  name: string;
  sortOrder: number;
  gateMode: string;
}

async function callMutation(path: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    open: 'bg-green-900 text-green-300',
    in_progress: 'bg-blue-900 text-blue-300',
    blocked: 'bg-red-900 text-red-300',
    closed: 'bg-neutral-700 text-neutral-300',
  };
  return <span className={`text-xs px-2 py-1 rounded ${colors[state] ?? 'bg-neutral-800'}`}>{state}</span>;
}

function EventItem({
  event,
  userEmail,
  onEdit,
  onDelete,
}: {
  event: EventData;
  userEmail: string;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const p = event.payload;

  if (event.type === 'state_change') {
    return (
      <div className="flex items-center gap-2 py-2 border-b border-neutral-800/50 text-sm">
        <span className="text-neutral-500">⚙</span>
        <StateBadge state={p.from as string} />
        <span className="text-neutral-500">→</span>
        <StateBadge state={p.to as string} />
        <span className="text-xs text-neutral-600 ml-auto">{p.user as string} · {event.timestamp}</span>
      </div>
    );
  }

  if (event.type === 'fields_updated') {
    const changes = p.changes as Record<string, { from: unknown; to: unknown }>;
    return (
      <div className="py-2 border-b border-neutral-800/50 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">✏</span>
          <span className="text-neutral-400">Fields updated by {p.user as string}</span>
          <span className="text-xs text-neutral-600 ml-auto">{event.timestamp}</span>
        </div>
        <div className="ml-6 mt-1 space-y-1">
          {Object.entries(changes).map(([key, { from, to }]) => (
            <p key={key} className="text-xs text-neutral-500">
              {key}: <span className="text-red-400 line-through">{String(from)}</span> → <span className="text-green-400">{String(to)}</span>
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (event.type === 'comment') {
    const isAuthor = (p.author as string) === userEmail || (p.editedBy as string) === userEmail;
    return (
      <div className="py-3 border-b border-neutral-800/50">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-neutral-300">{p.author as string}</span>
          <span className="text-xs text-neutral-600">{event.timestamp}</span>
          {isAuthor && !editing && (
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => { setEditing(true); setEditText(p.text as string); }}
                className="text-xs text-neutral-500 hover:text-white"
              >edit</button>
              <button
                onClick={() => onDelete(event.id)}
                className="text-xs text-red-500 hover:text-red-300"
              >delete</button>
            </div>
          )}
        </div>
        {editing ? (
          <div className="flex gap-2">
            <input
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="flex-1 rounded bg-neutral-900 border border-neutral-700 px-2 py-1 text-sm text-white"
            />
            <button
              onClick={() => { onEdit(event.id, editText); setEditing(false); }}
              className="text-xs px-2 py-1 bg-blue-600 rounded hover:bg-blue-500"
            >save</button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700"
            >cancel</button>
          </div>
        ) : (
          <p className="text-sm text-neutral-300">{p.text as string}</p>
        )}
      </div>
    );
  }

  // Generic event
  return (
    <div className="py-2 border-b border-neutral-800/50 text-sm text-neutral-500">
      <span>{event.type}</span>
      <span className="text-xs text-neutral-600 ml-2">{event.timestamp}</span>
      <pre className="text-xs mt-1 text-neutral-600">{JSON.stringify(p, null, 2)}</pre>
    </div>
  );
}

export default function IssueActions({
  issueId,
  issue,
  events: initialEvents,
  stages,
  userEmail,
  basePath,
}: {
  issueId: string;
  issue: IssueData;
  events: EventData[];
  stages: StageData[];
  userEmail: string;
  basePath: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [description, setDescription] = useState(issue.description);

  const [comment, setComment] = useState('');

  async function doMutation(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const data = await callMutation(path, body);
    setBusy(false);
    if (data.error) {
      setError(data.error.message);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded bg-red-950/50 border border-red-800 px-3 py-2">
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Title — click to edit */}
      {editingTitle ? (
        <div className="flex gap-2 items-center">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="flex-1 text-2xl font-bold bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-white"
          />
          <button
            onClick={async () => {
              await doMutation('issue.updateFields', { id: issueId, title, userId: userEmail });
              setEditingTitle(false);
            }}
            className="text-sm px-3 py-1 bg-blue-600 rounded"
          >Save</button>
          <button onClick={() => { setTitle(issue.title); setEditingTitle(false); }} className="text-sm px-3 py-1 bg-neutral-800 rounded">Cancel</button>
        </div>
      ) : (
        <h1
          className="text-2xl font-bold cursor-pointer hover:text-blue-400 transition-colors"
          onClick={() => setEditingTitle(true)}
          title="Click to edit"
        >{issue.title}</h1>
      )}

      {/* Metadata badges — clickable to change */}
      <div className="flex flex-wrap gap-2">
        <select
          value={issue.state}
          onChange={e => doMutation('issue.transition', { id: issueId, state: e.target.value, userId: userEmail })}
          disabled={busy}
          className="text-xs rounded bg-neutral-900 border border-neutral-700 px-2 py-1 text-white"
        >
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={issue.priority}
          onChange={e => doMutation('issue.updateFields', { id: issueId, priority: e.target.value, userId: userEmail })}
          disabled={busy}
          className="text-xs rounded bg-neutral-900 border border-neutral-700 px-2 py-1 text-white"
        >
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={issue.type}
          onChange={e => doMutation('issue.updateFields', { id: issueId, type: e.target.value, userId: userEmail })}
          disabled={busy}
          className="text-xs rounded bg-neutral-900 border border-neutral-700 px-2 py-1 text-white"
        >
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-xs text-neutral-600 self-center">source: {issue.source}</span>
        <span className="text-xs text-neutral-600 self-center">created: {issue.createdAt}</span>
      </div>

      {/* Description — click to edit */}
      {editingDesc ? (
        <div className="space-y-2">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-white"
          />
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await doMutation('issue.updateFields', { id: issueId, description, userId: userEmail });
                setEditingDesc(false);
              }}
              className="text-sm px-3 py-1 bg-blue-600 rounded"
            >Save</button>
            <button onClick={() => { setDescription(issue.description); setEditingDesc(false); }} className="text-sm px-3 py-1 bg-neutral-800 rounded">Cancel</button>
          </div>
        </div>
      ) : (
        <p
          className="text-sm text-neutral-400 cursor-pointer hover:text-neutral-200 transition-colors min-h-[2rem]"
          onClick={() => setEditingDesc(true)}
          title="Click to edit"
        >
          {issue.description || 'No description — click to add'}
        </p>
      )}

      {/* Pipeline stages from DB */}
      {stages.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-neutral-400">Pipeline Stages</h3>
          <div className="flex gap-2">
            {stages.map(s => (
              <div key={s.id} className="text-xs px-3 py-1.5 rounded bg-neutral-900 border border-neutral-800">
                <span className="font-medium">{s.name}</span>
                <span className="text-neutral-600 ml-1">({s.gateMode})</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Delete issue */}
      <button
        onClick={async () => {
          if (!confirm('Delete this issue and all its events?')) return;
          await doMutation('issue.delete', { id: issueId });
          router.push(basePath);
        }}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded bg-red-900 hover:bg-red-800 text-red-300 disabled:opacity-50"
      >
        Delete Issue
      </button>

      {/* Activity / Comments */}
      <section className="space-y-2">
        <h3 className="text-lg font-semibold text-neutral-300">Activity ({initialEvents.length})</h3>

        {initialEvents.map(ev => (
          <EventItem
            key={ev.id}
            event={ev}
            userEmail={userEmail}
            onEdit={async (eventId, text) => {
              await doMutation('issue.updateComment', { eventId, text, editedBy: userEmail });
            }}
            onDelete={async (eventId) => {
              if (!confirm('Delete this comment?')) return;
              await doMutation('issue.deleteComment', { eventId });
            }}
          />
        ))}

        {/* Add comment */}
        <div className="flex gap-2 pt-2">
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 rounded bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={async () => {
              if (!comment.trim()) return;
              const ok = await doMutation('issue.addComment', { issueId, text: comment, author: userEmail });
              if (ok) setComment('');
            }}
            disabled={busy || !comment.trim()}
            className="text-sm px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            Comment
          </button>
        </div>
      </section>
    </div>
  );
}
