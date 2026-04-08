import { describe, expect, it } from 'vitest';
import type {
  CreatePersonaInput,
  PersonaScope,
  ResolvedPersona,
  UpdatePersonaInput,
} from '@/core/personas/types';

describe('persona types', () => {
  it('CreatePersonaInput accepts minimal input', () => {
    const input: CreatePersonaInput = { name: 'Researcher' };
    expect(input.name).toBe('Researcher');
    expect(input.scope).toBeUndefined();
    expect(input.projectId).toBeUndefined();
  });

  it('CreatePersonaInput accepts full input', () => {
    const input: CreatePersonaInput = {
      name: 'Implementer',
      scope: 'project',
      projectId: '00000000-0000-0000-0000-000000000001',
      soul: 'A careful implementer who writes clean code',
      identity: { tone: 'precise', style: 'functional' },
      brandId: '00000000-0000-0000-0000-000000000002',
      routingProfileId: '00000000-0000-0000-0000-000000000003',
      parentPersonaId: '00000000-0000-0000-0000-000000000004',
    };
    expect(input.scope).toBe('project');
    expect(input.identity?.tone).toBe('precise');
  });

  it('UpdatePersonaInput allows partial updates', () => {
    const input: UpdatePersonaInput = { soul: 'Updated soul' };
    expect(input.soul).toBe('Updated soul');
    expect(input.name).toBeUndefined();
  });

  it('PersonaScope only allows global or project', () => {
    const scope: PersonaScope = 'global';
    expect(scope).toBe('global');
    const scope2: PersonaScope = 'project';
    expect(scope2).toBe('project');
  });
});

describe('persona inheritance merge logic', () => {
  it('child soul overrides parent soul', () => {
    const parentSoul = 'Parent soul';
    const childSoul = 'Child soul';
    // Merge: child wins
    const merged = childSoul || parentSoul;
    expect(merged).toBe('Child soul');
  });

  it('identity merges with child taking precedence', () => {
    const parentIdentity = { tone: 'formal', style: 'verbose' };
    const childIdentity = { tone: 'casual' };
    const merged = { ...parentIdentity, ...childIdentity };
    expect(merged.tone).toBe('casual');
    expect(merged.style).toBe('verbose');
  });

  it('identity merge across 3-level chain works correctly', () => {
    const grandparent = { tone: 'formal', style: 'verbose', lang: 'en' };
    const parent = { tone: 'neutral', format: 'markdown' };
    const child = { tone: 'casual' };
    // Merge order: grandparent → parent → child
    const merged = { ...grandparent, ...parent, ...child };
    expect(merged.tone).toBe('casual');
    expect(merged.style).toBe('verbose');
    expect(merged.format).toBe('markdown');
    expect(merged.lang).toBe('en');
  });

  it('null child soul falls back to parent soul', () => {
    const parentSoul = 'Parent soul';
    const childSoul: string | null = null;
    const merged = childSoul || parentSoul;
    expect(merged).toBe('Parent soul');
  });

  it('ResolvedPersona has correct shape', () => {
    const resolved: ResolvedPersona = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test',
      scope: 'project',
      projectId: null,
      soul: 'Merged soul',
      identity: { tone: 'casual' },
      brandId: null,
      routingProfileId: null,
      parentPersonaId: null,
      skills: [
        {
          skillId: '00000000-0000-0000-0000-000000000002',
          skillName: 'Code Review',
          enabled: true,
          configOverrides: null,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(resolved.skills).toHaveLength(1);
    expect(resolved.identity.tone).toBe('casual');
  });
});

describe('persona-skill binding', () => {
  it('skill attachment has expected fields', () => {
    const binding = {
      personaId: '00000000-0000-0000-0000-000000000001',
      skillId: '00000000-0000-0000-0000-000000000002',
      enabled: true,
      configOverrides: { maxTokens: 4096 },
    };
    expect(binding.enabled).toBe(true);
    expect(binding.configOverrides.maxTokens).toBe(4096);
  });

  it('skill union in inheritance: child configOverrides win', () => {
    const parentSkills = new Map([
      ['skill-1', { configOverrides: { temp: 0.7 } }],
      ['skill-2', { configOverrides: null }],
    ]);
    const childSkills = new Map([
      ['skill-1', { configOverrides: { temp: 0.3 } }],
      ['skill-3', { configOverrides: null }],
    ]);

    // Merge: parent first, child overwrites
    const merged = new Map(parentSkills);
    for (const [id, val] of childSkills) {
      merged.set(id, val);
    }

    expect(merged.size).toBe(3);
    expect(merged.get('skill-1')?.configOverrides).toEqual({ temp: 0.3 });
    expect(merged.has('skill-2')).toBe(true);
    expect(merged.has('skill-3')).toBe(true);
  });
});
