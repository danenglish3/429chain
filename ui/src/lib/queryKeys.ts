export const queryKeys = {
  config: ['config'] as const,
  providerStats: ['providerStats'] as const,
  chainStats: ['chainStats'] as const,
  requests: (limit: number) => ['requests', limit] as const,
  rateLimits: ['rateLimits'] as const,
  models: ['models'] as const,
};
