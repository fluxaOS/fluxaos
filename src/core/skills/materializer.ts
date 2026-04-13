/**
 * Skill Materializer — writes DB-stored skills and persona config to disk.
 *
 * At execution time, creates an isolated workspace directory with:
 * - CLAUDE.md (persona prompt: soul + identity + brand)
 * - skills/{name}/SKILL.md (skill content from promptTemplate)
 * - context.md (issue context: title, description, state, metadata)
 *
 * The harness reads these files as it normally would.
 * After execution, the workspace is cleaned up.
 *
 * Zero vendor imports. Operates on plain objects, writes to filesystem.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface PersonaInput {
  soul?: string | null;
  identity?: unknown;
  brandToneOfVoice?: string | null;
  brandStyleGuide?: string | null;
}

export interface SkillInput {
  name: string;
  promptTemplate: string | null;
}

export interface IssueInput {
  number: number;
  title: string;
  bodyMd?: string | null;
  state?: string | null;
  priority?: string | null;
  type?: string | null;
  labels?: unknown;
}

export interface MaterializeOptions {
  stageRunId: string;
  persona?: PersonaInput | null;
  skill: SkillInput;
  issue: IssueInput;
  projectName?: string;
}

const WORKSPACE_ROOT = join(tmpdir(), 'fluxaos-runs');

/**
 * Materialize skill + persona + issue context to an isolated temp workspace.
 * Returns the workspace path for the harness to use.
 */
export async function materialize(
  options: MaterializeOptions,
): Promise<string> {
  const workspacePath = join(WORKSPACE_ROOT, options.stageRunId);
  const skillDir = join(workspacePath, 'skills', options.skill.name);

  // Create directories
  await mkdir(skillDir, { recursive: true });

  // 1. Write CLAUDE.md — persona + skill instructions combined
  //    Claude auto-discovers CLAUDE.md from --add-dir directories,
  //    but skills/{name}/SKILL.md requires explicit invocation.
  //    Embedding skill instructions in CLAUDE.md ensures they're always read.
  const parts: string[] = [];
  const personaContent = buildPersonaContent(options.persona);
  if (personaContent) {
    parts.push(personaContent);
  }
  if (options.skill.promptTemplate) {
    parts.push(`## Skill: ${options.skill.name}\n\n${options.skill.promptTemplate}`);
  }
  if (parts.length > 0) {
    await atomicWrite(join(workspacePath, 'CLAUDE.md'), parts.join('\n\n'));
  }

  // 3. Write context.md with issue metadata
  const contextMd = buildContextContent(options.issue, options.projectName);
  await atomicWrite(join(workspacePath, 'context.md'), contextMd);

  return workspacePath;
}

/**
 * Remove the temp workspace directory after execution completes.
 */
export async function cleanup(workspacePath: string): Promise<void> {
  await rm(workspacePath, { recursive: true, force: true });
}

function buildPersonaContent(persona?: PersonaInput | null): string | null {
  if (!persona) return null;

  const parts: string[] = [];

  if (persona.soul) {
    parts.push(persona.soul);
  }

  if (persona.identity) {
    const identity =
      typeof persona.identity === 'string'
        ? persona.identity
        : JSON.stringify(persona.identity, null, 2);
    parts.push(`## Identity\n\n${identity}`);
  }

  if (persona.brandToneOfVoice) {
    parts.push(`## Tone of Voice\n\n${persona.brandToneOfVoice}`);
  }

  if (persona.brandStyleGuide) {
    parts.push(`## Style Guide\n\n${persona.brandStyleGuide}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function buildContextContent(
  issue: IssueInput,
  projectName?: string,
): string {
  const lines: string[] = ['# Issue Context', ''];

  if (projectName) {
    lines.push(`**Project:** ${projectName}`);
  }
  lines.push(`**Issue:** #${issue.number} — ${issue.title}`);

  if (issue.state) lines.push(`**State:** ${issue.state}`);
  if (issue.priority) lines.push(`**Priority:** ${issue.priority}`);
  if (issue.type) lines.push(`**Type:** ${issue.type}`);

  if (issue.labels && Array.isArray(issue.labels) && issue.labels.length > 0) {
    lines.push(`**Labels:** ${issue.labels.join(', ')}`);
  }

  if (issue.bodyMd) {
    lines.push('', '## Description', '', issue.bodyMd);
  }

  return lines.join('\n');
}

/**
 * Atomic write: write to temp file then rename.
 * Prevents harness from reading partially-written files.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, filePath);
}
