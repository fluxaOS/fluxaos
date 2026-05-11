/**
 * Shared .gitignore management helper.
 *
 * Promoted from worktree-isolation-provider.ts during R-ARTIFACTS W2-T5.
 * Parametrized so R-RUNTIME (.fluxaos-worktrees/) and R-ARTIFACTS
 * (.fluxaos-artifacts/) can share one implementation.
 *
 * The helper itself reads no config — callers decide whether to invoke it
 * at all (e.g. skip when an external workspace root points outside the
 * repo). Keeping config-gating out of this module avoids cross-feature
 * coupling (`runtime.workspace_root` vs FLUXAOS_ARTIFACTS_ROOT).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Ensure `entry` appears in `<repoPath>/.gitignore`. Idempotent — exits
 * early if the entry (or a recognised alternative form) is already present.
 * Creates `.gitignore` if it doesn't exist.
 *
 * Alternative forms checked (to avoid duplicate lines on re-run):
 *   - exact: `entry`
 *   - no trailing slash: `entry` without a trailing '/'
 *   - leading slash variants: `/entry` and `/entry/` (where relevant)
 *
 * @param repoPath absolute path to the target repo
 * @param entry the line to append (e.g. '.fluxaos-worktrees/')
 * @param comment human-readable comment written above the entry on first add
 */
export async function ensureGitignoreEntry(
  repoPath: string,
  entry: string,
  comment: string
): Promise<void> {
  const gitignorePath = join(repoPath, '.gitignore');

  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const trimmedEntry = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  const slashTrimmed = trimmedEntry.startsWith('/')
    ? trimmedEntry.slice(1)
    : trimmedEntry;
  const variants = new Set<string>([
    entry,
    trimmedEntry,
    slashTrimmed,
    `${slashTrimmed}/`,
    `/${slashTrimmed}`,
    `/${slashTrimmed}/`,
  ]);

  const lines = content.split('\n');
  const alreadyPresent = lines.some((l) => variants.has(l.trim()));
  if (alreadyPresent) return;

  const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
  const suffix = `${needsLeadingNewline ? '\n' : ''}\n# ${comment}\n${entry}\n`;
  await writeFile(gitignorePath, content + suffix, 'utf-8');
}
