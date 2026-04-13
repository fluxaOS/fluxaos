/**
 * Command Builder — assembles CLI commands from harness_catalog entries.
 *
 * Reads a harness catalog entry and builds the full command array + env.
 * No hardcoded flags, paths, or arguments. Everything from the DB record.
 *
 * Zero vendor imports. Zero domain concepts beyond "harness config → command."
 */

/** Harness config shape — matches harness_catalog table columns. */
export interface HarnessConfig {
  binary: string;
  defaultArgs: string[] | unknown;
  modelFlag: string | null;
  dirFlag: string | null;
  sessionNameFlag: string | null;
  promptTransport: string;
  issuePromptTemplate: string | null;
  queuePromptTemplate: string | null;
  envVars: Record<string, string> | unknown;
}

export interface CommandOptions {
  model: string;
  workspacePath: string;
  prompt: string;
  sessionName?: string;
  additionalDirs?: string[];
}

export interface BuiltCommand {
  binary: string;
  args: string[];
  env: Record<string, string>;
  stdin?: string;
}

export interface TemplateVariables {
  issue_number?: number;
  issue_title?: string;
  issue_description?: string;
  issue_state?: string;
  issue_priority?: string;
  issue_type?: string;
  skill_name?: string;
  workspace_path?: string;
  project_name?: string;
}

/**
 * Render a template string, replacing `{{variable}}` with values.
 * Unknown variables are left as-is.
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariables,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables[key as keyof TemplateVariables];
    return value !== undefined && value !== null ? String(value) : match;
  });
}

/**
 * Build a CLI command from a harness_catalog entry and execution options.
 *
 * Follows PAT's build_tool_interactive_command pattern:
 * binary + defaultArgs + modelFlag + dirFlag + sessionNameFlag + '--' + prompt
 */
export function buildCommand(
  harness: HarnessConfig,
  options: CommandOptions,
): BuiltCommand {
  const args: string[] = [];

  // 1. Default args from harness config
  const defaultArgs = Array.isArray(harness.defaultArgs)
    ? (harness.defaultArgs as string[])
    : [];
  args.push(...defaultArgs);

  // 2. Model flag + resolved model
  if (harness.modelFlag && options.model) {
    args.push(harness.modelFlag, options.model);
  }

  // 3. Session name flag
  if (harness.sessionNameFlag && options.sessionName) {
    args.push(harness.sessionNameFlag, options.sessionName);
  }

  // 4. Dir flag + workspace path
  if (harness.dirFlag && options.workspacePath) {
    args.push(harness.dirFlag, options.workspacePath);
  }

  // 5. Additional directories
  if (harness.dirFlag && options.additionalDirs) {
    for (const dir of options.additionalDirs) {
      args.push(harness.dirFlag, dir);
    }
  }

  // 6. Env vars from harness config
  const env: Record<string, string> =
    harness.envVars && typeof harness.envVars === 'object' && !Array.isArray(harness.envVars)
      ? { ...(harness.envVars as Record<string, string>) }
      : {};

  // 7. Handle prompt based on transport
  let stdin: string | undefined;
  const transport = harness.promptTransport || 'argv';

  if (transport === 'argv') {
    // PAT pattern: '--' separator then positional prompt
    args.push('--', options.prompt);
  } else if (transport === 'stdin') {
    stdin = options.prompt;
  } else if (transport === 'flag') {
    // promptFlag not in current harness_catalog but reserved for future
    args.push('--prompt', options.prompt);
  }

  return {
    binary: harness.binary,
    args,
    env,
    stdin,
  };
}
