/**
 * `fluxaos status` — server reachability + project context summary.
 *
 * Calls system.env.getPublic (cheap, public, zero-input) plus
 * project.getBySlug to verify both that the API is responding and that
 * the configured project slug resolves. Prints OK / NOT FOUND in text
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
    projectSlug: string;
    projectFound: boolean;
    projectId?: string;
    error?: string;
  } = {
    apiUrl: config.apiUrl,
    apiReachable: false,
    projectSlug: config.projectSlug,
    projectFound: false,
  };

  try {
    // system.env.getPublic is the cheapest reach check — public, no inputs.
    await client.system.env.getPublic.query();
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
    const proj = await client.project.getBySlug.query({
      slug: config.projectSlug,
    });
    if (proj) {
      result.projectFound = true;
      result.projectId = proj.id;
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
    `Project: ${config.projectSlug} ${
      result.projectFound ? `OK (${result.projectId})` : 'NOT FOUND'
    }`
  );
  return result.apiReachable && result.projectFound ? 0 : 1;
}
