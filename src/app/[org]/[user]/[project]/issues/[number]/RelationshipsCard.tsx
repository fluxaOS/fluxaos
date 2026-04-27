'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/card';
import { trpc } from '@/lib/trpc/client';

/**
 * R-EPIC: surfaces parent + children relationships on the issue detail page.
 *
 * Shape:
 *   - If the issue has a parent: "Parent: #N — title" link row.
 *   - If the issue has any children: a list of "#N — title" rows, closed
 *     children rendered with strikethrough + muted color.
 *   - Always renders the "Create child issue" button.
 *   - Returns null only if the issue has neither parent nor any children,
 *     which collapses the card for unrelated issues so the detail page
 *     doesn't grow a permanent empty panel.
 *
 * Consumer passes issueId, projectId, and the current parentIssueId from
 * the loaded issue row. The component fetches children independently.
 */
export function RelationshipsCard({
  issueId,
  parentIssueId,
  basePath,
}: {
  issueId: string;
  parentIssueId: string | null;
  basePath: string;
}) {
  const childrenQuery = trpc.issue.getChildren.useQuery({ parentId: issueId });
  const parentQuery = trpc.issue.getById.useQuery(
    { id: parentIssueId ?? '' },
    { enabled: !!parentIssueId }
  );

  const children = childrenQuery.data ?? [];
  const parent = parentIssueId ? parentQuery.data : null;

  const hasParent = !!parent;
  const hasChildren = children.length > 0;

  if (!hasParent && !hasChildren) {
    // Still render the "Create child issue" button as a small affordance so
    // operators can start a hierarchy from any issue. But minimize the card.
    return (
      <Card hover={false} padding="p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-400">
            Relationships
          </h3>
          <Link
            href={`${basePath}/issues/new?parent=${issueId}`}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-electric-violet/10 hover:bg-electric-violet/20 text-electric-violet border border-electric-violet/30 transition-colors"
          >
            <Plus size={12} />
            Create Child Issue
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card hover={false} padding="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-400">Relationships</h3>
        <Link
          href={`${basePath}/issues/new?parent=${issueId}`}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-electric-violet/10 hover:bg-electric-violet/20 text-electric-violet border border-electric-violet/30 transition-colors"
        >
          <Plus size={12} />
          Create child issue
        </Link>
      </div>

      {hasParent && parent && (
        <div className="pt-2 border-t border-slate-700/20">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
            Parent
          </div>
          <Link
            href={`${basePath}/issues/${parent.number}`}
            className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
          >
            <span className="font-mono text-slate-500">#{parent.number}</span>
            <span className={parent.isClosed ? 'line-through opacity-60' : ''}>
              {parent.title}
            </span>
          </Link>
        </div>
      )}

      {hasChildren && (
        <div className="pt-2 border-t border-slate-700/20">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 mb-2">
            Children ({children.filter((c) => !c.isClosed).length} open /{' '}
            {children.length} total)
          </div>
          <ul className="space-y-1.5">
            {children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`${basePath}/issues/${child.number}`}
                  className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
                >
                  <span className="font-mono text-slate-500">
                    #{child.number}
                  </span>
                  <span
                    className={child.isClosed ? 'line-through opacity-60' : ''}
                  >
                    {child.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
