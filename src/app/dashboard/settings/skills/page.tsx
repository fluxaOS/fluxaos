'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

export default function SkillSettingsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const skillsQuery = trpc.skill.list.useQuery();
  const skills = skillsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Skills</h2>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
        >
          {showCreate ? 'Cancel' : 'New Skill'}
        </button>
      </div>

      {showCreate && (
        <CreateSkillForm
          onCreated={() => {
            setShowCreate(false);
            skillsQuery.refetch();
          }}
        />
      )}

      {skills.length === 0 ? (
        <EmptyState title="No skills configured" />
      ) : (
        <div className="space-y-3">
          {skills.map((s) => (
            <div
              key={s.id}
              className="bg-sidebar border border-sidebar-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-2 text-xs text-muted">
                    v{s.version} &middot; {s.scope}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(expandedId === s.id ? null : s.id)
                  }
                  className="text-xs text-muted hover:text-foreground"
                >
                  {expandedId === s.id ? 'Close' : 'Details'}
                </button>
              </div>
              {s.description && (
                <p className="text-xs text-muted mt-1">{s.description}</p>
              )}
              {s.tags != null && Array.isArray(s.tags) && (
                <div className="flex gap-1 mt-1">
                  {(s.tags as string[]).map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {expandedId === s.id && (
                <div className="mt-3 pt-3 border-t border-sidebar-border">
                  {s.promptTemplate != null && (
                    <div>
                      <span className="text-xs text-muted">
                        Prompt Template:
                      </span>
                      <pre className="text-xs text-foreground/70 mt-1 bg-background rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48">
                        {String(s.promptTemplate)}
                      </pre>
                    </div>
                  )}
                  {s.inputSchema != null && (
                    <div className="mt-2">
                      <span className="text-xs text-muted">Input Schema:</span>
                      <pre className="text-xs text-foreground/70 mt-1 bg-background rounded p-2 overflow-x-auto">
                        {JSON.stringify(s.inputSchema, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateSkillForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const projectId = projectsQuery.data?.[0]?.id;

  const createMutation = trpc.skill.create.useMutation({
    onSuccess: () => onCreated(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const tags = tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        createMutation.mutate({
          name: name.trim(),
          description: description.trim() || undefined,
          promptTemplate: promptTemplate.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
          projectId,
        });
      }}
      className="bg-sidebar border border-sidebar-border rounded-lg p-4 space-y-3"
    >
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-muted">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-muted">Tags (comma-separated)</span>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="coding, review, docs"
            className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
      </div>
      <label>
        <span className="text-xs text-muted">Description</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label>
        <span className="text-xs text-muted">Prompt Template</span>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          rows={5}
          className="w-full bg-background border border-sidebar-border rounded-md px-3 py-2 text-sm text-foreground mt-1 font-mono resize-none"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {createMutation.isPending ? 'Creating...' : 'Create'}
      </button>
    </form>
  );
}
