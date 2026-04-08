import { z } from 'zod';
import {
  createModel,
  createProvider,
  deleteModel,
  deleteProvider,
  getModel,
  getProvider,
  listModels,
  listProviders,
  updateModel,
  updateProvider,
} from '@/core/providers';
import { publicProcedure, router } from '@/server/trpc';

export const providerRouter = router({
  create: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        name: z.string().min(1),
        type: z.string().min(1),
        baseUrl: z.string().url().optional(),
        apiKeyRef: z.string().optional(),
      })
    )
    .mutation(({ input }) => createProvider(input)),

  list: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ input }) => listProviders(input.orgId)),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getProvider(input.id)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        baseUrl: z.string().url().optional(),
        apiKeyRef: z.string().optional(),
        isHealthy: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateProvider(id, updates);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => deleteProvider(input.id)),

  // Model sub-routes
  createModel: publicProcedure
    .input(
      z.object({
        providerId: z.string().uuid(),
        name: z.string().min(1),
        identifier: z.string().min(1),
        capabilities: z.record(z.string(), z.unknown()).optional(),
        costPer1kInput: z.string().optional(),
        costPer1kOutput: z.string().optional(),
      })
    )
    .mutation(({ input }) => createModel(input)),

  listModels: publicProcedure
    .input(z.object({ providerId: z.string().uuid() }))
    .query(({ input }) => listModels(input.providerId)),

  getModel: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getModel(input.id)),

  updateModel: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        identifier: z.string().min(1).optional(),
        capabilities: z.record(z.string(), z.unknown()).optional(),
        costPer1kInput: z.string().optional(),
        costPer1kOutput: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateModel(id, updates);
    }),

  deleteModel: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => deleteModel(input.id)),
});
