/**
 * Command Builder — assembles CLI commands from driver entries.
 *
 * Reads a driver catalog entry and builds the full command array + env.
 * No hardcoded flags, paths, or arguments. Everything from the DB record.
 *
 * Zero vendor imports. Zero domain concepts beyond "driver config → command."
 */

/** Driver config shape — matches driver table columns. */
export interface DriverConfig {
  binary: string;
  defaultArgs: string[] | unknown;
  modelFlag: string | null;
  dirFlag: string | null;
  sessionNameFlag: string | null;
  promptTransport: string;
  outputFormat: string;
  outputFormatFlag: string | null;
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
 * Build a CLI command from a driver entry and execution options.
 *
 * Follows PAT's build_tool_interactive_command pattern:
 * binary + defaultArgs + modelFlag + dirFlag + sessionNameFlag + '--' + prompt
 */
export function buildCommand(
  driver: DriverConfig,
  options: CommandOptions,
): BuiltCommand {
  const args: string[] = [];

  // 1. Default args from driver config
  const defaultArgs = Array.isArray(driver.defaultArgs)
    ? (driver.defaultArgs as string[])
    : [];
  args.push(...defaultArgs);

  // 2. Output format flag
  if (driver.outputFormatFlag && driver.outputFormat) {
    args.push(driver.outputFormatFlag, driver.outputFormat);
  }

  // 3. Model flag + resolved model
  if (driver.modelFlag && options.model) {
    args.push(driver.modelFlag, options.model);
  }

  // 4. Session name flag
  if (driver.sessionNameFlag && options.sessionName) {
    args.push(driver.sessionNameFlag, options.sessionName);
  }

  // 5. Dir flag + workspace path
  if (driver.dirFlag && options.workspacePath) {
    args.push(driver.dirFlag, options.workspacePath);
  }

  // 6. Additional directories
  if (driver.dirFlag && options.additionalDirs) {
    for (const dir of options.additionalDirs) {
      args.push(driver.dirFlag, dir);
    }
  }

  // 7. Env vars from driver config
  const env: Record<string, string> =
    driver.envVars && typeof driver.envVars === 'object' && !Array.isArray(driver.envVars)
      ? { ...(driver.envVars as Record<string, string>) }
      : {};

  // 8. Handle prompt based on transport
  let stdin: string | undefined;
  const transport = driver.promptTransport || 'argv';

  if (transport === 'argv') {
    // PAT pattern: '--' separator then positional prompt
    args.push('--', options.prompt);
  } else if (transport === 'stdin') {
    stdin = options.prompt;
  } else if (transport === 'flag') {
    // promptFlag not in current driver but reserved for future
    args.push('--prompt', options.prompt);
  }

  return {
    binary: driver.binary,
    args,
    env,
    stdin,
  };
}
