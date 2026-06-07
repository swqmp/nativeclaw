const DEFAULT_OPENROUTER_PROFILES = {
  kimi: {
    name: 'kimi',
    model: 'moonshotai/kimi-k2.6',
    display: 'Kimi K2.6',
    contextWindow: 262144,
    compactionThreshold: 210000,
    provider: {
      order: ['WandB', 'Cloudflare', 'Fireworks'],
      allow_fallbacks: false,
    },
  },
  minimax: {
    name: 'minimax',
    model: 'minimax/minimax-m2.7',
    display: 'MiniMax M2.7',
    contextWindow: 197000,
    compactionThreshold: 160000,
    provider: {
      order: ['Fireworks', 'Morph', 'SambaNova'],
      allow_fallbacks: false,
    },
  },
  grok: {
    name: 'grok',
    model: 'x-ai/grok-4.3',
    display: 'Grok 4.3',
    contextWindow: 1000000,
    compactionThreshold: 350000,
    provider: {
      allow_fallbacks: true,
    },
  },
  glm: {
    name: 'glm',
    model: 'z-ai/glm-5.1',
    display: 'GLM 5.1',
    contextWindow: 202752,
    compactionThreshold: 160000,
    provider: {
      allow_fallbacks: true,
    },
  },
  mimo: {
    name: 'mimo',
    model: 'xiaomi/mimo-v2.5-pro',
    display: 'MiMo V2.5 Pro',
    contextWindow: 1048576,
    compactionThreshold: 350000,
    provider: {
      allow_fallbacks: true,
    },
  },
};

function normalizeProfileName(name) {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(clean)) {
    throw new Error('Profile name must be 1-32 chars: lowercase letters, numbers, underscore, or hyphen.');
  }
  return clean;
}

function normalizeModelId(model) {
  let clean = String(model || '').trim();
  if (clean.startsWith('openrouter/')) clean = clean.slice('openrouter/'.length);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+$/.test(clean)) {
    throw new Error('OpenRouter model ID must look like provider/model, for example moonshotai/kimi-k2.6.');
  }
  return clean;
}

function modelWithProvider(model) {
  return `openrouter/${normalizeModelId(model)}`;
}

function parseProviderOrder(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function normalizeProvider(provider = {}) {
  const normalized = {};
  const order = parseProviderOrder(provider.order);
  if (order.length > 0) normalized.order = order;
  if (typeof provider.allow_fallbacks === 'boolean') normalized.allow_fallbacks = provider.allow_fallbacks;
  if (typeof provider.sort === 'string' || (provider.sort && typeof provider.sort === 'object')) normalized.sort = provider.sort;
  if (Number.isFinite(Number(provider.preferred_min_throughput))) normalized.preferred_min_throughput = Number(provider.preferred_min_throughput);
  if (Number.isFinite(Number(provider.preferred_max_latency))) normalized.preferred_max_latency = Number(provider.preferred_max_latency);
  if (provider.max_price && typeof provider.max_price === 'object') normalized.max_price = provider.max_price;
  return normalized;
}

function normalizeProfile(name, profile = {}) {
  const profileName = normalizeProfileName(profile.name || name);
  const model = normalizeModelId(profile.model);
  const display = String(profile.display || profileName).trim();
  const contextWindow = Number.isFinite(Number(profile.contextWindow)) ? Number(profile.contextWindow) : null;
  const compactionThreshold = Number.isFinite(Number(profile.compactionThreshold)) ? Number(profile.compactionThreshold) : null;
  const normalized = {
    name: profileName,
    model,
    modelWithProvider: modelWithProvider(model),
    display,
    provider: normalizeProvider(profile.provider || {}),
  };
  if (contextWindow) normalized.contextWindow = contextWindow;
  if (compactionThreshold) normalized.compactionThreshold = compactionThreshold;
  if (profile.configPath) normalized.configPath = String(profile.configPath);
  if (profile.toolPack) normalized.toolPack = String(profile.toolPack).trim().toLowerCase();
  return normalized;
}

function mergedProfiles(config = {}) {
  const configured = config.openRouterProfiles || {};
  const merged = { ...DEFAULT_OPENROUTER_PROFILES };
  for (const [name, profile] of Object.entries(configured)) {
    merged[normalizeProfileName(name)] = { ...profile, name };
  }
  return merged;
}

function resolveOpenRouterProfile(name, config = {}) {
  const profileName = normalizeProfileName(name || config.defaultOpenRouterProfile || 'kimi');
  const profiles = mergedProfiles(config);
  if (!profiles[profileName]) {
    throw new Error(`Unknown OpenRouter profile "${profileName}". Use /or list or /or set ${profileName} provider/model.`);
  }
  return normalizeProfile(profileName, profiles[profileName]);
}

function listOpenRouterProfiles(config = {}) {
  return Object.keys(mergedProfiles(config))
    .sort()
    .map((name) => resolveOpenRouterProfile(name, config));
}

function upsertOpenRouterProfile(existing = {}, name, profile) {
  const profileName = normalizeProfileName(name);
  const normalized = normalizeProfile(profileName, { ...profile, name: profileName });
  return {
    ...existing,
    [profileName]: {
      name: profileName,
      model: normalized.model,
      display: normalized.display,
      provider: normalized.provider,
      contextWindow: normalized.contextWindow,
      compactionThreshold: normalized.compactionThreshold,
      configPath: normalized.configPath,
      toolPack: normalized.toolPack,
    },
  };
}

module.exports = {
  DEFAULT_OPENROUTER_PROFILES,
  normalizeProfileName,
  normalizeModelId,
  modelWithProvider,
  parseProviderOrder,
  normalizeProvider,
  normalizeProfile,
  resolveOpenRouterProfile,
  listOpenRouterProfiles,
  upsertOpenRouterProfile,
};
