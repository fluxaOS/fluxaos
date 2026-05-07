#!/usr/bin/env node
// Doc-drift gate: hard gate (file-path map) + LLM soft nudge (Claude API).
// Called by .github/workflows/doc-drift.yml with env vars set by the workflow.
//
// Env vars required:
//   CHANGED_FILES   — newline-separated list of files changed in this PR
//   PR_DIFF         — full unified diff of the PR (for LLM nudge)
//   ANTHROPIC_API_KEY — for LLM nudge (optional; nudge skipped if absent)
//   GITHUB_TOKEN    — for posting the PR comment
//   GITHUB_REPOSITORY — e.g. "fluxaOS/fluxaos"
//   PR_NUMBER       — pull request number
//   MAP_FILE        — path to doc-drift-map.yml (default: .github/doc-drift-map.yml)
//   SKIP_LLM        — set to "true" to disable the LLM nudge layer (hard gate still runs)

import fs from 'fs';
import { load as yamlLoad } from 'js-yaml';

const changedFiles = (process.env.CHANGED_FILES || '')
  .split('\n')
  .filter(Boolean);
const prDiff = process.env.PR_DIFF || '';
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const githubToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const mapFile = process.env.MAP_FILE || '.github/doc-drift-map.yml';
const skipLlm = process.env.SKIP_LLM === 'true';
const prTitle = process.env.PR_TITLE || '';
const prLabels = (process.env.PR_LABELS || '').split(',').map((l) => l.trim());

// ── Escape hatch ───────────────────────────────────────────────────────────

const hasSkipLabel = prLabels.includes('skip-doc-drift');
const hasSkipTitle = prTitle.includes('[skip-doc-drift]');

if (hasSkipLabel || hasSkipTitle) {
  console.log(
    'ℹ️  skip-doc-drift flag set — bypassing doc-drift check entirely.'
  );
  process.exit(0);
}

// ── Layer 1: Hard gate ─────────────────────────────────────────────────────

const map = yamlLoad(fs.readFileSync(mapFile, 'utf-8'));
const violations = [];

for (const entry of map.critical) {
  const sourceChanged = changedFiles.some(
    (f) => f === entry.match || f.startsWith(entry.match + '/')
  );
  if (!sourceChanged) continue;

  const anyDocChanged = entry.docs.some((doc) => changedFiles.includes(doc));
  if (!anyDocChanged) {
    violations.push({ source: entry.match, docs: entry.docs });
  }
}

if (violations.length > 0) {
  let msg =
    '❌ **Doc drift detected** — the following source files changed without updating their mapped doc pages:\n\n';
  for (const v of violations) {
    msg += `**\`${v.source}\`** changed but none of these doc pages were updated:\n`;
    for (const d of v.docs) {
      msg += `  - \`${d}\`\n`;
    }
    msg += '\n';
  }
  msg +=
    '_Update at least one mapped doc page, or add the `skip-doc-drift` PR label if no user-visible behavior changed._';
  console.error(msg.replace(/\*\*/g, '').replace(/`/g, ''));
  await postComment(msg);
  process.exit(1);
}

console.log('✅ Hard gate passed — no critical doc drift detected.');

// ── Layer 2: LLM soft nudge ────────────────────────────────────────────────

if (skipLlm) {
  console.log('ℹ️  SKIP_LLM=true — skipping LLM soft nudge.');
  process.exit(0);
}

if (!anthropicKey) {
  console.log('ℹ️  ANTHROPIC_API_KEY not set — skipping LLM soft nudge.');
  process.exit(0);
}

if (!prDiff) {
  console.log('ℹ️  No PR diff available — skipping LLM soft nudge.');
  process.exit(0);
}

const docPages = [
  'concepts/index',
  'concepts/skills',
  'concepts/drivers',
  'concepts/pipelines',
  'concepts/gates',
  'concepts/signals',
  'concepts/state-vs-status',
  'guides/01-first-setup',
  'guides/02-build-a-pipeline',
  'guides/03-add-an-issue',
  'guides/04-run-a-pipeline',
  'guides/05-read-the-results',
  'reference/env-vars',
  'reference/signal-types',
  'reference/gate-rules',
  'reference/issue-states',
  'reference/playbook-schema',
  'reference/daemon',
];

const prompt = `You are reviewing a code diff for a product called fluxaOS — an AI orchestration OS that runs pipelines of AI-powered stages against software issues.

Determine whether any user-visible behavior changed in this diff. "User-visible" means: changes to how users configure skills, drivers, pipelines, or gates; changes to issue state/status transitions; changes to environment variables; changes to signal/verdict types; changes to the playbook YAML schema; changes to daemon behavior.

If user-visible behavior changed, identify which doc pages from the list below likely need updating.

Doc pages:
${docPages.map((p) => `- ${p}`).join('\n')}

Reply with ONLY a JSON object (no markdown, no explanation):
{"changed": boolean, "pages": string[], "reason": string}

PR diff:
\`\`\`
${prDiff.slice(0, 8000)}
\`\`\``;

let nudgeComment = null;

try {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  const raw = data.content?.[0]?.text || '';
  const text = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const result = JSON.parse(text);

  if (result.changed && result.pages.length > 0) {
    nudgeComment = `💡 **Doc nudge** — Claude thinks this PR may affect user-visible behavior:\n\n> ${result.reason}\n\nConsider updating:\n${result.pages.map((p) => `- \`${p}\``).join('\n')}\n\n_This is advisory only and does not block the PR. Add the \`skip-doc-drift\` label to silence this nudge._`;
    console.log('LLM nudge:', result.reason);
  } else {
    console.log('LLM nudge: no user-visible changes detected.');
  }
} catch (err) {
  console.warn('LLM nudge failed (non-blocking):', err.message);
}

if (nudgeComment) {
  await postComment(nudgeComment);
}

process.exit(0);

// ── Helpers ────────────────────────────────────────────────────────────────

async function postComment(body) {
  if (!githubToken || !repo || !prNumber) {
    console.log('(no GitHub token / repo / PR number — skipping comment)');
    return;
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    );
    if (!res.ok) {
      console.warn(`GitHub comment failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn('GitHub comment error (non-blocking):', err.message);
  }
}
