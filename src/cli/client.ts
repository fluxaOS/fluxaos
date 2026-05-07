/**
 * tRPC client for the CLI.
 *
 * Uses the same `AppRouter` type the web UI's React provider uses, so the
 * CLI gets full type safety on every call without redefining a single
 * payload shape. Transport is `httpBatchLink` over fetch — no cookies, no
 * session; the CLI relies on FLUXAOS_LAN_AUTH_BYPASS=1 on the server side.
 */
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@/server/root';
import type { CliConfig } from './config';

export type CliTrpcClient = ReturnType<typeof createTRPCClient<AppRouter>>;

export function createCliClient(config: CliConfig): CliTrpcClient {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: config.apiUrl,
        // No credentials/cookies — CLI auth is server-side LAN bypass.
      }),
    ],
  });
}
