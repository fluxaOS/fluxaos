import { asc, eq } from 'drizzle-orm';
import { db } from '@/core/db';
import {
  model,
  provider,
  routingProfile,
  type routingRule,
} from '@/core/db/schema';
import { resolvePersona } from '@/core/personas';

export interface RouteSelection {
  providerId: string;
  providerName: string;
  modelId: string;
  modelIdentifier: string;
  harness: string;
}

function matchesPattern(identifier: string, pattern: string): boolean {
  if (!pattern || pattern === '*') return true;
  // Simple glob: convert * to regex .*
  const regex = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
  );
  return regex.test(identifier);
}

export async function resolveRoute(
  personaId: string | null,
  stageName: string,
  stageHarness: string | null
): Promise<RouteSelection> {
  let routingProfileId: string | null = null;

  // 1. Resolve persona to get routing profile
  if (personaId) {
    const resolved = await resolvePersona(personaId);
    routingProfileId = resolved.routingProfileId;
  }

  // 2. Load routing rules if profile exists
  let rules: (typeof routingRule.$inferSelect)[] = [];
  let profileHarness: string | null = null;
  let fallbackHarness: string | null = null;
  let modelsPattern: string | null = null;
  let sortStrategy = 'quality';

  if (routingProfileId) {
    const profile = await db.query.routingProfile.findFirst({
      where: eq(routingProfile.id, routingProfileId),
      with: { rules: true },
    });

    if (profile) {
      rules = profile.rules;
    }
  }

  // 3. Find best matching rule: exact stageName first, then wildcard (null)
  const exactRule = rules.find((r) => r.stageName === stageName);
  const wildcardRule = rules.find(
    (r) => r.stageName === null || r.stageName === '*'
  );
  const matchedRule = exactRule ?? wildcardRule;

  if (matchedRule) {
    modelsPattern = matchedRule.allowedModelsPattern;
    profileHarness = matchedRule.preferredHarness;
    fallbackHarness = matchedRule.fallbackHarness;
    sortStrategy = matchedRule.sortStrategy ?? 'quality';
  }

  // 4. Harness precedence: stage config > rule preferred > rule fallback
  const harness =
    stageHarness ?? profileHarness ?? fallbackHarness ?? 'claude-code';

  // 5. Find available providers (healthy only) and their models
  const providers = await db
    .select()
    .from(provider)
    .where(eq(provider.isHealthy, true))
    .orderBy(asc(provider.name));

  for (const prov of providers) {
    const models = await db
      .select()
      .from(model)
      .where(eq(model.providerId, prov.id))
      .orderBy(
        sortStrategy === 'cost' ? asc(model.costPer1kInput) : asc(model.name)
      );

    for (const m of models) {
      if (!modelsPattern || matchesPattern(m.identifier, modelsPattern)) {
        return {
          providerId: prov.id,
          providerName: prov.name,
          modelId: m.id,
          modelIdentifier: m.identifier,
          harness,
        };
      }
    }
  }

  // No provider/model found — return a fallback with empty provider
  // (the worker should handle this case gracefully)
  throw new Error(
    `No healthy provider/model found for stage "${stageName}"` +
      (modelsPattern ? ` matching pattern "${modelsPattern}"` : '')
  );
}
