/**
 * Integration test: CLI surface (FLX-2).
 *
 * Exercises the CLI's tRPC client against the running fluxaOS app server.
 * The CLI itself is a thin HTTP wrapper — no business logic to mock — so
 * this test calls the same `createCliClient` factory the binary uses and
 * asserts the round-trip works against the real server + real Supabase.
 *
 * Skips cleanly when:
 *   - FLUXAOS_API_URL is unset (no server target configured), or
 *   - the server doesn't respond to the same tRPC GET the CLI uses.
 *
 * Hits real Supabase via the live app. No mocks. The dev server must be
 * running with FLUXAOS_LAN_AUTH_BYPASS=1 — same posture every other
 * journey/integration test in this repo assumes. The probe runs at
 * module load (top-level await) so vitest's it.skipIf evaluates against
 * a real result rather than a default false.
 */
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { createCliClient } from '@/cli/client';
import { loadConfig } from '@/cli/config';
import { resolveContext } from '@/cli/context';

const apiUrl = process.env.FLUXAOS_API_URL?.trim();

async function probeServer(url: string): Promise<boolean> {
  try {
    const config = loadConfig();
    const client = createCliClient({ ...config, apiUrl: url });
    // FLX-221: the legacy system.env.getPublic endpoint was retired;
    // organization.list is the new cheapest reach check (public, zero inputs).
    await Promise.race([
      client.organization.list.query(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 3000)
      ),
    ]);
    return true;
  } catch (err) {
    console.warn(
      'CLI integration probe failed:',
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

const serverUp = apiUrl ? await probeServer(apiUrl) : false;
const skipReason = !apiUrl
  ? 'FLUXAOS_API_URL not set'
  : !serverUp
    ? `server at ${apiUrl} not reachable`
    : null;

describe.skipIf(skipReason !== null)(
  `CLI integration (server: ${apiUrl})`,
  () => {
    it('resolves project context by slug', async () => {
      const config = loadConfig();
      const client = createCliClient(config);
      const context = await resolveContext(client, config);
      expect(context.projectId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(context.projectSlug).toBe(config.projectSlug);
    });

    it('issue.list returns rows for the seeded project', async () => {
      const config = loadConfig();
      const client = createCliClient(config);
      const context = await resolveContext(client, config);
      const issues = await client.issue.list.query({
        projectId: context.projectId,
      });
      expect(Array.isArray(issues)).toBe(true);
      // Schema check on whatever rows exist — don't assume a specific count
      // because the dev DB is shared with manual operator activity.
      for (const issue of issues) {
        expect(typeof issue.number).toBe('number');
        expect(typeof issue.title).toBe('string');
        expect(typeof issue.typeId).toBe('string');
        expect(typeof issue.priorityId).toBe('string');
        expect(typeof issue.stateId).toBe('string');
      }
    });

    it('issue.create round-trips and is visible by number', async () => {
      const config = loadConfig();
      const client = createCliClient(config);
      const context = await resolveContext(client, config);

      const [types, priorities] = await Promise.all([
        client.issueCatalog.types.list.query({ projectId: context.projectId }),
        client.issueCatalog.priorities.list.query({
          projectId: context.projectId,
        }),
      ]);
      const taskType = types.find((t) => t.key === 'task');
      const lowPriority = priorities.find((p) => p.key === 'low');
      if (!taskType || !lowPriority) {
        throw new Error(
          'Seeded catalog missing "task" type or "low" priority — re-run npm run db:seed'
        );
      }

      const title = `CLI integration test ${Date.now()}`;
      const created = await client.issue.create.mutate({
        projectId: context.projectId,
        title,
        typeId: taskType.id,
        priorityId: lowPriority.id,
      });

      expect(created.id).toBeTruthy();
      expect(created.number).toBeGreaterThan(0);
      expect(created.title).toBe(title);

      const fetched = await client.issue.getByNumber.query({
        projectId: context.projectId,
        number: created.number,
      });
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.title).toBe(title);
    });

    it('catalog lookup surfaces keys the CLI advertises', async () => {
      const config = loadConfig();
      const client = createCliClient(config);
      const context = await resolveContext(client, config);
      const types = await client.issueCatalog.types.list.query({
        projectId: context.projectId,
      });
      const keys = types.map((t) => t.key);
      // The CLI's --type flag surfaces these keys in error messages, so
      // a regression in catalog key shape would surface here too.
      expect(keys).toContain('task');
      expect(keys.length).toBeGreaterThan(0);
    });
  }
);

if (skipReason !== null) {
  describe('CLI integration', () => {
    it('skipped', () => {
      console.warn(`CLI integration test skipped: ${skipReason}`);
      expect(true).toBe(true);
    });
  });
}
