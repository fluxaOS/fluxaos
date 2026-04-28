import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { Feature, hasFeature } from '@/core/features/features';

describe('features primitive (FLX-14 tier-keyed)', () => {
  it('free tier has no gated features', () => {
    for (const feature of Object.values(Feature)) {
      expect(hasFeature('free', feature)).toBe(false);
    }
  });

  it('pro tier has every catalog feature', () => {
    for (const feature of Object.values(Feature)) {
      expect(hasFeature('pro', feature)).toBe(true);
    }
  });

  it('enterprise tier has every catalog feature', () => {
    for (const feature of Object.values(Feature)) {
      expect(hasFeature('enterprise', feature)).toBe(true);
    }
  });

  it('Feature enum lists exactly the expected entries', () => {
    expect(Object.keys(Feature).sort()).toEqual(
      ['PREVIEW_GATE', 'REVISION_HISTORY'].sort()
    );
  });
});
