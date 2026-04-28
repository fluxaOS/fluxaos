// src/app/[org]/[user]/[project]/settings/skills/SkillRevisionHistory.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { trpc } from '@/lib/trpc/client';
import type { SkillRecord } from './descriptor';

type Props = {
  skill: SkillRecord;
};

export function SkillRevisionHistory({ skill }: Props) {
  const utils = trpc.useUtils();
  const historyQuery = trpc.skill.listHistory.useQuery({ id: skill.id });
  const revertMutation = trpc.skill.revertToRevision.useMutation();
  const [error, setError] = useState<string | null>(null);

  const revisions = historyQuery.data ?? [];

  const onRevert = async (revisionNumber: number) => {
    setError(null);
    try {
      await revertMutation.mutateAsync({
        id: skill.id,
        version: skill.version,
        revisionNumber,
      });
      await utils.skill.list.invalidate();
      await utils.skill.listHistory.invalidate({ id: skill.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div data-testid="skill-revision-history">
      <Card padding="p-6">
        <h3 className="text-sm font-semibold text-white mb-3">
          Revision history
        </h3>
        {error ? (
          <div className="mb-3 px-3 py-2 rounded-lg text-sm bg-red-600/10 text-red-300 border border-red-600/30">
            {error}
          </div>
        ) : null}
        {historyQuery.isLoading ? (
          <p className="text-xs text-slate-500">Loading history…</p>
        ) : revisions.length === 0 ? (
          <p className="text-xs text-slate-500">
            No revisions yet. Saving an edit creates the first snapshot.
          </p>
        ) : (
          <ul className="divide-y divide-slate-700/30">
            {revisions.map((rev) => (
              <li
                key={rev.id}
                className="flex items-center justify-between py-2 text-xs"
                data-testid={`skill-revision-row-${rev.revisionNumber}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-slate-300 font-medium">
                    Revision #{rev.revisionNumber}
                  </div>
                  <div className="text-slate-500">
                    {new Date(rev.snapshotAt).toLocaleString()}
                    {rev.snapshotBy ? ` · ${rev.snapshotBy}` : ''} ·{' '}
                    <span className="font-mono">{rev.name}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRevert(rev.revisionNumber)}
                  disabled={revertMutation.isPending}
                  className="ml-3 px-3 py-1 rounded-md text-xs font-medium bg-slate-800 text-soft-violet hover:bg-slate-700 disabled:opacity-50"
                >
                  {revertMutation.isPending ? 'Reverting…' : 'Revert'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
