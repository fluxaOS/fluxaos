import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issue } from '@/core/db/schema';
import { createIssueService } from '@/core/services/issue';
import { createIssueCommentService } from '@/core/services/issue-comment';
import type { AuditResult } from './playbook-auditor';

export interface PaperworkInput {
  issueId: string;
  projectId: string;
  db: Database;
  audit: AuditResult;
}

export async function executePaperwork(input: PaperworkInput): Promise<void> {
  const { issueId, projectId, db, audit } = input;

  const issueService = createIssueService(db);
  const commentService = createIssueCommentService(db);

  // 1. Post comment if present
  if (audit.comment) {
    await commentService.create(issueId, {
      bodyMd: audit.comment,
      author: 'orchestrator',
    });
  }

  // 2. Post blocker summary as a single formatted comment.
  //    No blocker relation table exists yet; a follow-up ticket will add proper
  //    blocker-issue creation once the relation table is in place.
  if (audit.blockers && audit.blockers.length > 0) {
    const lines = [
      `Stage flagged ${audit.blockers.length} blocker(s):`,
      '',
      ...audit.blockers.map(
        (b, i) => `**${i + 1}. ${b.title}**\n${b.description}`
      ),
    ];
    await commentService.create(issueId, {
      bodyMd: lines.join('\n'),
      author: 'orchestrator',
    });
  }

  // 3. Transition issue state.
  //    Must read current version from DB before calling transition() or close() —
  //    version is positional arg 3 on transition(id, toStateId, version, userId?).
  const [issueRow] = await db.select().from(issue).where(eq(issue.id, issueId));
  if (!issueRow) return; // issue deleted concurrently — skip

  if (audit.targetState === 'complete') {
    await issueService.close(issueId, issueRow.version, 'orchestrator');
  } else if (audit.targetState === 'blocked') {
    // 'blocked' is a status sentinel — update status without changing state
    const blockedStatusId = await issueService.getStatusIdByConfigKey(
      projectId,
      'issues.status.on_blocked_key'
    );
    await issueService.updateStatus(
      issueId,
      blockedStatusId,
      'orchestrator',
      'stage blocked'
    );
  } else {
    const targetState = await issueService.getStateByKey(
      projectId,
      audit.targetState
    );
    await issueService.transition(
      issueId,
      targetState.id,
      issueRow.version,
      'orchestrator'
    );
  }
}
