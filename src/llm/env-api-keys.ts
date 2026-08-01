/**
 * LLM Layer — Environment API Key Discovery
 *
 * Maps provider ids to known environment variable names and discovers which
 * providers are configured. Inspired by pi's env-api-keys.ts.
 */

/** Provider id → conventional API key env var */
export const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
};

/** Env vars that must NOT be treated as LLM provider keys (server auth, generic fallback) */
const NON_PROVIDER_KEYS = new Set(['LLM_API_KEY', 'MINICLAW_API_KEY']);

/** Additional env vars checked for a provider (multiple keys fallbacks) */
export function getApiKeyEnvVars(provider: string): string[] {
  const conventional = PROVIDER_ENV_MAP[provider] || `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  return [...new Set([conventional, 'LLM_API_KEY'])];
}

/**
 * Find which environment variables can provide an API key for a provider.
 * Returns the configured env var names, or undefined if none set.
 */
export function findEnvKeys(provider: string): string[] | undefined {
  const envVars = getApiKeyEnvVars(provider);
  const found = envVars.filter((v) => !!process.env[v]);
  return found.length > 0 ? found : undefined;
}

/**
 * Get the API key for a provider from known env vars, or undefined if not set.
 * Prefers the provider-specific key over the generic LLM_API_KEY fallback.
 */
export function getEnvApiKey(provider: string): string | undefined {
  const envVars = getApiKeyEnvVars(provider);
  const specific = envVars.find((v) => !NON_PROVIDER_KEYS.has(v) && !!process.env[v]);
  if (specific) return process.env[specific];
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY;
  return undefined;
}

/**
 * Return the provider-specific env var for a provider (excludes generic fallbacks).
 * Used to determine whether a provider is genuinely configured.
 */
export function getSpecificApiKeyEnvVar(provider: string): string | undefined {
  const conventional = PROVIDER_ENV_MAP[provider] || `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  return process.env[conventional] ? conventional : undefined;
}

/** List all known provider ids that have a provider-specific API key configured */
export function listConfiguredProviders(): string[] {
  const configured = new Set<string>();

  // Known providers with their conventional key set
  for (const id of Object.keys(PROVIDER_ENV_MAP)) {
    if (getSpecificApiKeyEnvVar(id)) configured.add(id);
  }

  // Generic: any <PROVIDER>_API_KEY env var (excluding non-provider keys)
  for (const envKey of Object.keys(process.env)) {
    if (!/^[A-Z0-9_]+_API_KEY$/.test(envKey)) continue;
    if (NON_PROVIDER_KEYS.has(envKey)) continue;
    const id = envKey.replace(/_API_KEY$/, '').toLowerCase().replace(/_/g, '-');
    configured.add(id);
  }

  return Array.from(configured);
}
