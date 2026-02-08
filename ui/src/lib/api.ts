const API_KEY_STORAGE_KEY = '429chain-api-key';

export function getApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearApiKey(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };

  const apiKey = getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (options?.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearApiKey();
    }

    let errorMessage = response.statusText;
    try {
      const errorJson = await response.json();
      if (errorJson.error) {
        errorMessage = errorJson.error;
      }
    } catch {
      // Fallback to statusText if JSON parsing fails
    }

    throw new Error(errorMessage);
  }

  return response.json();
}

export const api = {
  getConfig: () => apiFetch<{ providers: any[], chains: any[] }>('/v1/admin/config'),
  putProvider: (id: string, data: any) =>
    apiFetch<{ provider: any }>(`/v1/admin/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deleteProvider: (id: string) =>
    apiFetch<{ deleted: string }>(`/v1/admin/providers/${id}`, { method: 'DELETE' }),
  putChain: (name: string, data: any) =>
    apiFetch<{ chain: any }>(`/v1/admin/chains/${name}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deleteChain: (name: string) =>
    apiFetch<{ deleted: string }>(`/v1/admin/chains/${name}`, { method: 'DELETE' }),
  getProviderStats: () => apiFetch<{ providers: any[] }>('/v1/stats/providers'),
  getChainStats: () => apiFetch<{ chains: any[] }>('/v1/stats/chains'),
  getRequests: (limit = 50) => apiFetch<{ requests: any[] }>(`/v1/stats/requests?limit=${limit}`),
  getSummaryStats: () => apiFetch<{ summary: { totalRequests: number; waterfallRequests: number; avgLatencyMs: number } }>('/v1/stats/summary'),
  getRateLimits: () => apiFetch<{ ratelimits: any[] }>('/v1/ratelimits'),
  getModels: () => apiFetch<{ data: any[] }>('/v1/models'),
  chatCompletion: (body: any) => apiFetch<any>('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body)
  }),
  testChain: (chainName: string, prompt?: string) =>
    apiFetch<{
      chain: string;
      results: Array<{
        provider: string;
        model: string;
        status: 'ok' | 'error';
        latencyMs: number;
        response?: string;
        tokens?: { prompt: number; completion: number; total: number };
        error?: string;
      }>;
      summary: { total: number; ok: number; failed: number };
    }>(`/v1/test/chain/${chainName}`, {
      method: 'POST',
      body: JSON.stringify({ prompt: prompt || undefined }),
    }),
};
