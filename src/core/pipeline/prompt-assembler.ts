import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { issue } from '@/core/db/schema';

export interface PromptAssemblyParams {
  issueId: string | null;
  personaSoul: string | null;
  stageName: string;
  skillsDir: string | null;
}

export async function assemblePrompt(
  params: PromptAssemblyParams
): Promise<string> {
  const sections: string[] = [];

  // 1. Persona soul — sets the character/approach
  if (params.personaSoul) {
    sections.push(`## Persona\n\n${params.personaSoul}`);
  }

  // 2. Stage context — what this stage expects
  sections.push(
    `## Stage: ${params.stageName}\n\nYou are executing the "${params.stageName}" stage of a pipeline.`
  );

  // 3. Issue context — the task to work on
  if (params.issueId) {
    try {
      const row = await db.query.issue.findFirst({
        where: eq(issue.id, params.issueId),
      });
      if (row) {
        sections.push(
          `## Task\n\n**${row.title}**\n\n${row.description ?? ''}`
        );
      }
    } catch {
      // Issue lookup failed — continue without it
    }
  }

  // 4. Skills — inline materialized skill files
  if (params.skillsDir) {
    try {
      const files = await readdir(params.skillsDir);
      const skillFiles = files.filter((f) => f.endsWith('.md'));

      if (skillFiles.length > 0) {
        const skillContents: string[] = [];
        for (const file of skillFiles) {
          const content = await readFile(join(params.skillsDir, file), 'utf-8');
          skillContents.push(content.trim());
        }
        sections.push(`## Skills\n\n${skillContents.join('\n\n---\n\n')}`);
      }
    } catch {
      // Skills dir read failed — continue without
    }
  }

  return sections.join('\n\n---\n\n');
}
