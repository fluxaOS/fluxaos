import { describe, expect, it } from 'vitest';
import type {
  BrandFilter,
  CreateBrandInput,
  UpdateBrandInput,
} from '@/core/brands/types';

describe('brand types', () => {
  it('CreateBrandInput accepts required fields', () => {
    const input: CreateBrandInput = {
      orgId: '00000000-0000-0000-0000-000000000001',
      name: 'fluxaOS Brand',
    };
    expect(input.name).toBe('fluxaOS Brand');
    expect(input.colors).toBeUndefined();
  });

  it('CreateBrandInput accepts full brand identity', () => {
    const input: CreateBrandInput = {
      orgId: '00000000-0000-0000-0000-000000000001',
      projectId: '00000000-0000-0000-0000-000000000002',
      name: 'Project Brand',
      colors: { primary: '#6366f1', secondary: '#8b5cf6', accent: '#06b6d4' },
      fonts: { heading: 'Inter', body: 'IBM Plex Sans' },
      toneOfVoice: 'Professional yet approachable',
      styleGuide: 'Use active voice. Keep sentences short.',
      logoUrl: 'https://example.com/logo.svg',
    };
    expect((input.colors as Record<string, string>).primary).toBe('#6366f1');
    expect(input.toneOfVoice).toBe('Professional yet approachable');
  });

  it('UpdateBrandInput allows partial updates', () => {
    const input: UpdateBrandInput = {
      toneOfVoice: 'Casual and friendly',
    };
    expect(input.toneOfVoice).toBe('Casual and friendly');
    expect(input.name).toBeUndefined();
  });

  it('BrandFilter supports org and project filtering', () => {
    const filter: BrandFilter = {
      orgId: '00000000-0000-0000-0000-000000000001',
    };
    expect(filter.orgId).toBeDefined();
    expect(filter.projectId).toBeUndefined();
  });
});

describe('brand-persona relationship', () => {
  it('persona can reference a brand by id', () => {
    const persona = {
      name: 'Writer',
      brandId: '00000000-0000-0000-0000-000000000001',
    };
    const brand = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Corporate',
      toneOfVoice: 'Formal and authoritative',
    };
    expect(persona.brandId).toBe(brand.id);
  });
});
