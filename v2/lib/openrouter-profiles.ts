export type OpenRouterProviderRouting = {
  order?: string[];
  allow_fallbacks?: boolean;
  sort?: string | { by: string; partition?: string };
  preferred_min_throughput?: number;
  preferred_max_latency?: number;
  max_price?: { prompt?: number; completion?: number };
};

export type OpenRouterProfile = {
  name: string;
  model: string;
  display?: string;
  configPath?: string;
  provider?: OpenRouterProviderRouting;
  contextWindow?: number;
  compactionThreshold?: number;
};

export const DEFAULT_OPENROUTER_PROFILES: Record<string, OpenRouterProfile> = {
  kimi: {
    name: 'kimi',
    model: 'moonshotai/kimi-k2.6',
    display: 'Kimi K2.6',
    contextWindow: 262144,
    compactionThreshold: 210000,
    provider: { order: ['WandB', 'Cloudflare', 'Fireworks'], allow_fallbacks: false },
  },
  minimax: {
    name: 'minimax',
    model: 'minimax/minimax-m2.7',
    display: 'MiniMax M2.7',
    contextWindow: 197000,
    compactionThreshold: 160000,
    provider: { order: ['Fireworks', 'Morph', 'SambaNova'], allow_fallbacks: false },
  },
  grok: {
    name: 'grok',
    model: 'x-ai/grok-4.3',
    display: 'Grok 4.3',
    contextWindow: 1000000,
    compactionThreshold: 350000,
    provider: { allow_fallbacks: true },
  },
};

export function normalizeProfileName(name: string): string {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(clean)) {
    throw new Error('Profile name must be 1-32 chars: lowercase letters, numbers, underscore, or hyphen.');
  }
  return clean;
}

export function normalizeModelId(model: string): string {
  let clean = String(model || '').trim();
  if (clean.startsWith('openrouter/')) clean = clean.slice('openrouter/'.length);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+$/.test(clean)) {
    throw new Error('OpenRouter model ID must look like provider/model.');
  }
  return clean;
}

export function modelWithProvider(model: string): string {
  return `openrouter/${normalizeModelId(model)}`;
}

export function parseProviderOrder(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

export function resolveOpenRouterProfile(
  name = 'kimi',
  config: { defaultOpenRouterProfile?: string; openRouterProfiles?: Record<string, OpenRouterProfile> } = {}
): OpenRouterProfile & { modelWithProvider: string } {
  const profileName = normalizeProfileName(name || config.defaultOpenRouterProfile || 'kimi');
  const merged = { ...DEFAULT_OPENROUTER_PROFILES, ...(config.openRouterProfiles || {}) };
  const profile = merged[profileName];
  if (!profile) throw new Error(`Unknown OpenRouter profile "${profileName}".`);
  const model = normalizeModelId(profile.model);
  return {
    ...profile,
    name: profileName,
    model,
    modelWithProvider: modelWithProvider(model),
    provider: profile.provider || {},
  };
}
