/**
 * Deterministic IDs used by the seed (FLX-266).
 *
 * The default project is inserted with a FIXED UUID so that operator config
 * (`FLUXAOS_PROJECT_ID` in `.env.local`, consumed by `e2e/helpers/setup.ts`)
 * survives every nuke + reseed cycle. Without this, each reseed generated a
 * fresh random project UUID and there was no producer for the env var the
 * e2e helper hard-requires.
 *
 * This is NOT a code-level fallback: nothing reads this constant at runtime
 * when `FLUXAOS_PROJECT_ID` is missing — the e2e helper still fails fast.
 * The constant only makes the seed's output deterministic.
 *
 * Lives in its own module (not seed.ts) because seed.ts executes on import.
 */
export const SEED_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
