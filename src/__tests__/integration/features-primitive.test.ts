import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { Feature, hasFeature } from '@/core/features/features';

describe('features primitive', () => {
  it('every Feature enum value resolves to true for a signed-in user today', () => {
    // DEF-004: when tier gating is wired, these expectations will change per-tier.
    // Today, every user has every feature (pre-SaaS stub).
    const userId = 'test-user';
    for (const feature of Object.values(Feature)) {
      expect(hasFeature(userId, feature)).toBe(true);
    }
  });

  it('accepts null userId (anonymous / LAN-bypass sessions)', () => {
    // The UI hook useCurrentUser returns null when no session cookie exists
    // (including during FLUXAOS_LAN_AUTH_BYPASS runs). hasFeature must
    // accept the null case without throwing.
    for (const feature of Object.values(Feature)) {
      expect(hasFeature(null, feature)).toBe(true);
    }
  });

  it('has exactly the expected seed feature flags', () => {
    expect(Object.keys(Feature).sort()).toEqual(
      ['PREVIEW_GATE', 'REVISION_HISTORY', 'ROLE_BASED_PERMISSIONS'].sort(),
    );
  });
});
