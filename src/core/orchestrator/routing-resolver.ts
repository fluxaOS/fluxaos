/**
 * Routing Resolver — determines which provider/model/driver to use for a stage.
 *
 * Reads routing rules from DB. No hardcoded provider names, model names, or
 * driver names. The resolver matches rules by stage name pattern, then picks
 * the best model based on the sort strategy.
 *
 * Zero vendor imports. Receives Database via DI.
 */
import { and, eq } from 'drizzle-orm';
import { DEFAULT_SORT_STRATEGY } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import {
  model,
  pipelineStage,
  project,
  provider,
  routingProfile,
  routingRule,
} from '@/core/db/schema';
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

      // 3. Find matching routing rules
      // First try: rules with a stage name pattern that matches this stage
      // Then fall back to rules with no stage name (wildcard)
      const rules = await db
        .select({
          id: routingRule.id,
          stageName: routingRule.stageName,
          allowedModelsPattern: routingRule.allowedModelsPattern,
          preferredDriver: routingRule.preferredDriver,
          fallbackDriver: routingRule.fallbackDriver,
          sortStrategy: routingRule.sortStrategy,
          maxCostUsd: routingRule.maxCostUsd,
          profileId: routingRule.profileId,
        })
        .from(routingRule)
        .innerJoin(routingProfile, eq(routingRule.profileId, routingProfile.id))
        .where(eq(routingProfile.orgId, proj.orgId));

      // Match: exact stage name > null (wildcard)
      const exactMatch = rules.find((r) => r.stageName === stage.name);
      const wildcardMatch = rules.find((r) => r.stageName === null);
      const rule = exactMatch ?? wildcardMatch;

      // 4. Get available providers + models for this org
      const providers = await db
        .select({
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.type,
          baseUrl: provider.baseUrl,
          apiKeyRef: provider.apiKeyRef,
          isHealthy: provider.isHealthy,
          modelId: model.id,
          modelName: model.name,
          modelIdentifier: model.identifier,
          costPer1kInput: model.costPer1kInput,
          costPer1kOutput: model.costPer1kOutput,
        })
        .from(provider)
        .innerJoin(model, eq(model.providerId, provider.id))
        .where(
          and(eq(provider.orgId, proj.orgId), eq(provider.isHealthy, true))
        );

      if (providers.length === 0) return null;

      // 5. Filter by routing rule constraints
      let candidates = providers;

      if (rule?.allowedModelsPattern) {
        const pattern = rule.allowedModelsPattern;
        candidates = candidates.filter((c) => {
          try {
            return new RegExp(pattern).test(c.modelIdentifier);
          } catch {
            return c.modelIdentifier.includes(pattern);
          }
        });
      }

      if (rule?.maxCostUsd) {
        const maxCost = Number(rule.maxCostUsd);
        candidates = candidates.filter(
          (c) => Number(c.costPer1kInput ?? 0) <= maxCost
        );
      }

      if (candidates.length === 0) return null;

      // 6. Sort by strategy
      const strategy = rule?.sortStrategy ?? DEFAULT_SORT_STRATEGY;
      if (strategy === 'cost') {
        candidates.sort(
          (a, b) =>
            Number(a.costPer1kInput ?? 0) - Number(b.costPer1kInput ?? 0)
        );
      }
      // 'quality' = first available (no cost sorting)

      const pick = candidates[0];

      // 7. Resolve driver: stage override > rule preferred > rule fallback (fail fast)
      const driver =
        stage.driver ?? rule?.preferredDriver ?? rule?.fallbackDriver;
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
