export interface IssueContext {
  title: string;
  description: string | null;
  stageName: string;
  projectName: string;
  resultDocPath: string;
  artifactsDir: string;
}

export interface SkillRef {
  name: string;
  description: string | null;
  promptTemplate: string;
}

const RESULT_DOC_CONTRACT = `## Output Contract

When your work is complete, write a result document to the path specified in your context.
The result document must be valid JSON with the following shape:

{
  "verdict": "pass" | "fail" | "blocked",
  "summary": "<one sentence describing what you did>",
  "artifacts": ["<relative path to any files you created>"]
}

Verdicts:
- "pass" — work is complete and ready for the next stage
- "fail" — work cannot be completed (ambiguous requirements, missing context)
- "blocked" — you need operator input before continuing

Do NOT transition issue states directly. Do NOT create git commits or branches unless your persona explicitly instructs it.
Write the result document, then stop.`;

export function composePrompt(
  personaSoul: string,
  skills: SkillRef[],
  issueContext: IssueContext
): string {
  const parts: string[] = [];

  parts.push(personaSoul);

  if (skills.length > 0) {
    const skillBlock = skills
      .map((s) => `### ${s.name}\n\n${s.promptTemplate}`)
      .join('\n\n---\n\n');
    parts.push(`## Available Tool References\n\n${skillBlock}`);
  }

  parts.push(`## Current Task

**Issue:** ${issueContext.title}
**Stage:** ${issueContext.stageName}
**Project:** ${issueContext.projectName}

${issueContext.description ?? ''}

**Result document path:** ${issueContext.resultDocPath}
**Artifacts directory:** ${issueContext.artifactsDir}`);

  parts.push(RESULT_DOC_CONTRACT);

  return parts.join('\n\n---\n\n');
}
