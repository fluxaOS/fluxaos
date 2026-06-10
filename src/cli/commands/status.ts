/**
 * `fluxaos status` — server reachability + project context summary.
 *
 * Calls organization.list (cheap, public, zero-input) plus
 * project.getById to verify both that the API is responding and that
 * the configured project id resolves. Prints OK / NOT FOUND in text
 * mode, or a structured JSON object in --json mode.
 */

import type { CliTrpcClient } from '../client';
import type { CliConfig } from '../config';
import { printJson } from '../format';

export async function runStatus(
  client: CliTrpcClient,
  config: CliConfig,
  json: boolean
): Promise<number> {
  const result: {
    apiUrl: string;
    apiReachable: boolean;
    projectId: string;
    projectFound: boolean;
    projectName?: string;
    error?: string;
  } = {
    apiUrl: config.apiUrl,
    apiReachable: false,
    projectId: config.projectId,
    projectFound: false,
  };

  try {
    // organization.list is the cheapest reach check — public, no inputs.
    await client.organization.list.query();
    result.apiReachable = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    if (json) {
      printJson(result);
    } else {
      console.error(`API unreachable at ${config.apiUrl}: ${result.error}`);
    }
    return 1;
  }

  try {
    const proj = await client.project.getById.query({ id: config.projectId });
    if (proj) {
      result.projectFound = true;
      result.projectName = proj.name;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  if (json) {
    printJson(result);
    return result.projectFound ? 0 : 1;
  }

  console.log(
    `API:     ${config.apiUrl} ${result.apiReachable ? 'OK' : 'DOWN'}`
  );
  console.log(
    `Project: ${config.projectId} ${
      result.projectFound ? `OK (${result.projectName})` : 'NOT FOUND'
    }`
  );
  return result.apiReachable && result.projectFound ? 0 : 1;
}
