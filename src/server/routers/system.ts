/**
 * System router — exposes a small whitelisted surface of environment
 * variables so Settings UI can render them without the UI reaching
 * into process.env directly.
 *
 * Alpha: only FLUXAOS_TARGET_REPO_PATH is whitelisted. Add new keys
 * here with explicit intent — do NOT read arbitrary env vars.
 */
import { publicProcedure, router } from '../trpc';

const ALLOWED_ENV_VARS = ['FLUXAOS_TARGET_REPO_PATH'] as const;
type AllowedEnvVar = (typeof ALLOWED_ENV_VARS)[number];

export const systemRouter = router({
  env: router({
    getPublic: publicProcedure.query(() => {
      const out: Record<AllowedEnvVar, string | null> = {
        FLUXAOS_TARGET_REPO_PATH: null,
      };
      for (const key of ALLOWED_ENV_VARS) {
        out[key] = process.env[key] ?? null;
      }
      return out;
    }),
  }),
});
