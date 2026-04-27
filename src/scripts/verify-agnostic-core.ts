/**
 * verify-agnostic-core.ts — FLX-73
 *
 * Greps src/core/ for vendor-name and stage-name literals. The engine is
 * agnostic by contract: stage/provider/driver/state/skill names live in
 * the database (catalogs, config_entry, driver.contextLayout, etc.) and
 * MUST NOT appear as string literals in src/core/.
 *
 * Exits non-zero on hit. Wired into pre-push and CI to fail builds when
 * a leak re-appears.
 *
 * Allowlist: a small set of pre-existing leaks documented as follow-up
 * tickets in the alpha project. Each entry has a Linear ticket; new hits
 * not on the allowlist are blockers.
 */
import { execSync } from 'node:child_process';

// Patterns flagged as vendor-name leaks. Filtered post-grep in JS so we
// can use ECMAScript-only constructs (lookahead/behind) that POSIX grep
// rejects.
const VENDOR_PATTERNS: RegExp[] = [
  /\banthropic\b/i,
  /\bclaude\b/i, // matches CLAUDE.md, claude-code, etc.
  /\bopenai\b/i,
  /\bgpt-\d/i,
  /\bchatgpt\b/i,
];
const VENDOR_PLAIN_GREP = 'anthropic|claude|openai|gpt-|chatgpt';
const VENDOR_FALSE_POSITIVES = [/claude-mem/i];

// Patterns flagged as stage/state-name leaks (engine should resolve via
// config_entry / pipeline_stage rows, not literal keys). 'rework' is a
// GateVerdict union member, not a state literal — skip.
const STATE_KEY_PATTERNS: RegExp[] = [
  /['"]research['"]/,
  /['"]implement['"]/,
  /['"]review['"]/,
  /['"]deploy['"]/,
  /['"]complete['"]/,
];
const STATE_PLAIN_GREP = "'research'|'implement'|'review'|'deploy'|'complete'";

// Documented allowlist: file:line → Linear ticket. New hits anywhere else
// are failures. Pre-existing hits get retired by the linked tickets.
//
// FLX-78 + FLX-79 retired 2026-04-27 — list intentionally empty. Any new
// vendor-name or stage/state literal in src/core/ fails the build.
type Allow = { file: string; line: number; reason: string; ticket: string };
const ALLOWLIST: Allow[] = [];

interface Hit {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

function grep(
  plainAlternation: string,
  refinePatterns: RegExp[],
  excludePatterns: RegExp[] = []
): Hit[] {
  const hits: Hit[] = [];
  let raw: string;
  try {
    // git grep with case-insensitive POSIX alternation; refine in JS.
    const cmd = `git grep -niE "${plainAlternation}" -- 'src/core/**/*.ts' 'src/core/**/*.tsx' || true`;
    raw = execSync(cmd, { encoding: 'utf8' });
  } catch {
    return hits;
  }
  for (const ln of raw.split('\n').filter(Boolean)) {
    const m = ln.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    const [, file, lineStr, text] = m;
    if (excludePatterns.some((p) => p.test(text))) continue;
    const matched = refinePatterns.find((p) => p.test(text));
    if (!matched) continue;
    hits.push({
      file,
      line: Number(lineStr),
      text: text.trim(),
      pattern: matched.source,
    });
  }
  return hits;
}

function isAllowed(hit: Hit): Allow | undefined {
  return ALLOWLIST.find((a) => a.file === hit.file && a.line === hit.line);
}

function report(label: string, hits: Hit[]): { ok: boolean; unallowed: Hit[] } {
  const unallowed = hits.filter((h) => !isAllowed(h));
  console.log(
    `\n[verify-agnostic-core] ${label}: ${hits.length} hit(s), ${unallowed.length} unallowed`
  );
  for (const h of hits) {
    const allow = isAllowed(h);
    const tag = allow ? `[allow:${allow.ticket}]` : '[FAIL]';
    console.log(`  ${tag} ${h.file}:${h.line}  ${h.text}`);
  }
  return { ok: unallowed.length === 0, unallowed };
}

const vendor = report(
  'vendor-name literals',
  grep(VENDOR_PLAIN_GREP, VENDOR_PATTERNS, VENDOR_FALSE_POSITIVES)
);
const state = report(
  'state/stage literals',
  grep(STATE_PLAIN_GREP, STATE_KEY_PATTERNS)
);

if (!vendor.ok || !state.ok) {
  console.log(
    '\n[verify-agnostic-core] FAIL: src/core/ contains unallowed vendor or stage literals.'
  );
  console.log(
    'File a follow-up ticket and add the entry to the ALLOWLIST in this script (or fix the leak).'
  );
  process.exit(1);
}

console.log('\n[verify-agnostic-core] PASS: src/core/ is agnostic.');
