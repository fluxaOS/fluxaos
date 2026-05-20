/**
 * Routing Resolver — determines which provider/model/driver to use for a stage.
 *
 * Reads routing rules from DB. No hardcoded provider names, model names, or
 * driver names. The resolver matches rules by stage name pattern, then picks
 * the best model based on the sort strategy.
 *
 * Zero vendor imports. Receives Database via DI.
 */
import { eq, inArray } from 'drizzle-orm';
import { DEFAULT_SORT_STRATEGY } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { model, pipelineStage, project, routingRule } from '@/core/db/schema';
import { createProviderService, createRoutingService } from '@/core/services';
import { resolveProjectScopeContext } from '@/core/services/resolve-scoped';
import type { ResolvedRouting } from './types';

export interface RoutingResolver {
  /**
   * Resolve routing for a pipeline stage.
   *
   * @param stageId   - Pipeline stage ID
   * @param projectId - Project ID (for org-level provider lookup)
   * @returns Resolved routing or null if no match
   */
  resolve(stageId: string, projectId: string): Promise<ResolvedRouting | null>;
}

export function createRoutingResolver(db: Database): RoutingResolver {
  return {
    async resolve(
      stageId: string,
      projectId: string
    ): Promise<ResolvedRouting | null> {
      // 1. Get the stage (for name and driver override)
      const [stage] = await db
        .select({
          name: pipelineStage.name,
          driver: pipelineStage.driver,
          personaId: pipelineStage.personaId,
        })
        .from(pipelineStage)
        .where(eq(pipelineStage.id, stageId));

      if (!stage) return null;

      // 2. Get the project's org (providers are org-scoped)
      const [proj] = await db
        .select({ orgId: project.orgId })
        .from(project)
        .where(eq(project.id, projectId));

      if (!proj) return null;

      const scope = await resolveProjectScopeContext(db, projectId);

      // 3. Find matching routing rules from effective routing profiles.
      // First try: rules with a stage name pattern that matches this stage
      // Then fall back to rules with no stage name (wildcard)
      const profiles =
        await createRoutingService(db).listEffectiveProfiles(scope);
      const profileIds = profiles.map((profile) => profile.id);
      const rules =
        profileIds.length > 0
          ? await db
              .select({
                id: routingRule.id,
                stageName: routingRule.stageName,
                allowedModelsPattern: routingRule.allowedModelsPattern,
                preferredDriver: routingRule.preferredDriver,
                sortStrategy: routingRule.sortStrategy,
                maxCostUsd: routingRule.maxCostUsd,
                profileId: routingRule.profileId,
              })
              .from(routingRule)
              .where(inArray(routingRule.profileId, profileIds))
          : [];

      // Match: exact stage name > null (wildcard)
      const exactMatch = rules.find((r) => r.stageName === stage.name);
      const wildcardMatch = rules.find((r) => r.stageName === null);
      const rule = exactMatch ?? wildcardMatch;

      // 4. Get available providers + models for this scope. Models inherit
      // through their resolved provider row.
      const providers = await createProviderService(db).listEffective(scope);
      const healthyProviders = providers.filter((row) => row.isHealthy);
      const providerById = new Map(
        healthyProviders.map((provider) => [provider.id, provider])
      );
      const providerIds = healthyProviders.map((provider) => provider.id);
      const modelRows =
        providerIds.length > 0
          ? await db
              .select({
                providerId: model.providerId,
                modelId: model.id,
                modelName: model.name,
                modelIdentifier: model.identifier,
                costPer1kInput: model.costPer1kInput,
                costPer1kOutput: model.costPer1kOutput,
              })
              .from(model)
              .where(inArray(model.providerId, providerIds))
          : [];
      const candidates = modelRows.flatMap((row) => {
        const provider = providerById.get(row.providerId);
        if (!provider) return [];
        return [
          {
            providerId: provider.id,
            providerName: provider.name,
            providerType: provider.type,
            baseUrl: provider.baseUrl,
            apiKeyRef: provider.apiKeyRef,
            isHealthy: provider.isHealthy,
            modelId: row.modelId,
            modelName: row.modelName,
            modelIdentifier: row.modelIdentifier,
            costPer1kInput: row.costPer1kInput,
            costPer1kOutput: row.costPer1kOutput,
          },
        ];
      });

      // 5. Filter by routing rule constraints
      if (candidates.length === 0) return null;

      let matchingCandidates = candidates;

      if (rule?.allowedModelsPattern) {
        const pattern = rule.allowedModelsPattern;
        // Guard against patterns that are too long or invalid (ReDoS mitigation).
        // Write-time validation enforces 500 chars; this is the use-time safety net.
        if (pattern.length > 500) {
          console.warn(
            `[routing-resolver] allowedModelsPattern exceeds 500 chars in rule ${rule.id} — treating as no-match`
          );
          return null;
        }
        let compiled: RegExp | null = null;
        try {
          compiled = new RegExp(pattern);
        } catch {
          // Invalid regex stored in DB — treat as no-match (fail-safe).
          // Write-time validation in the routing router prevents this in practice.
          console.warn(
            `[routing-resolver] Invalid allowedModelsPattern in rule ${rule.id}: ${pattern}`
          );
          return null;
        }
        matchingCandidates = matchingCandidates.filter((c) =>
          compiled!.test(c.modelIdentifier)
        );
      }

      if (rule?.maxCostUsd) {
        const maxCost = Number(rule.maxCostUsd);
        matchingCandidates = matchingCandidates.filter(
          (c) => Number(c.costPer1kInput ?? 0) <= maxCost
        );
      }

      if (matchingCandidates.length === 0) return null;

      // 6. Sort by strategy
      const strategy = rule?.sortStrategy ?? DEFAULT_SORT_STRATEGY;
      if (strategy === 'cost') {
        matchingCandidates.sort(
          (a, b) =>
            Number(a.costPer1kInput ?? 0) - Number(b.costPer1kInput ?? 0)
        );
      }
      // 'quality' = first available (no cost sorting)

      const pick = matchingCandidates[0];

      // 7. Resolve driver: per-stage override wins over the matched rule's
      // configured driver. This is scope precedence (stage-level beats
      // rule-level), not a fallback chain — both columns are user-configured
      // at different scopes and there are no implicit defaults. If neither
      // scope sets a driver, return null and let stage-runner fail fast.
      let driver: string | null = null;
      if (stage.driver) {
        driver = stage.driver;
      } else if (rule?.preferredDriver) {
        driver = rule.preferredDriver;
      }
      if (!driver) {
        return null; // No driver configured — caller must handle
      }

      return {
        providerId: pick.providerId,
        providerName: pick.providerName,
        providerBaseUrl: pick.baseUrl,
        providerApiKeyRef: pick.apiKeyRef,
        modelId: pick.modelId,
        modelIdentifier: pick.modelIdentifier,
        driver,
        costPer1kInput: Number(pick.costPer1kInput ?? 0),
        costPer1kOutput: Number(pick.costPer1kOutput ?? 0),
      };
    },
  };
}
