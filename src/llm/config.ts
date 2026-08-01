/**
 * LLM Layer — Configuration Loading
 *
 * Loads configuration from, in order of increasing precedence:
 *   1. Hardcoded defaults (provider factories)
 *   2. .env file (via dotenv)
 *   3. miniclaw.json / miniclaw.config.json
 *   4. Environment variables
 *   5. CLI arguments (handled by callers)
 *   6. Runtime registration (registerProvider)
 *
 * This module loads .env + config file once at first use and exposes the
 * resolved LLM config (default provider, per-provider overrides, custom providers).
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// ─── .env Loading ────────────────────────────────────────────────────────────

let envLoaded = false;

/**
 * Load the .env file from the current working directory (or explicit path).
 * Safe to call multiple times — only loads once.
 */
export function loadEnvFile(envPath?: string): void {
  if (envLoaded) return;
  const target = envPath || path.join(process.cwd(), '.env');
  if (fs.existsSync(target)) {
    dotenv.config({ path: target });
  }
  envLoaded = true;
}

// ─── Config File Types ───────────────────────────────────────────────────────

/** Provider override in the config file */
export interface ProviderConfigOverride {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Custom OpenAI-compatible provider definition */
export interface CustomProviderConfig {
  id: string;
  name?: string;
  baseURL: string;
  apiKeyEnvVar?: string;
  models?: string[];
}

/** Top-level miniclaw config file shape */
export interface MiniclawConfig {
  defaultProvider?: string;
  providers?: Record<string, ProviderConfigOverride>;
  customProviders?: CustomProviderConfig[];
}

// ─── Config File Loading ─────────────────────────────────────────────────────

const CONFIG_FILE_NAMES = ['miniclaw.json', 'miniclaw.config.json'];

let loadedConfig: MiniclawConfig | undefined;
let configPath: string | undefined;

/**
 * Resolve the config file path. Explicit configPath wins; otherwise auto-discover
 * in cwd. Returns undefined if none exists.
 */
export function resolveConfigPath(configPath?: string): string | undefined {
  if (configPath) {
    return fs.existsSync(configPath) ? configPath : undefined;
  }
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(process.cwd(), name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Load the miniclaw config file (JSON). Loads once and caches.
 */
export function loadConfigFile(explicitPath?: string): MiniclawConfig | undefined {
  if (loadedConfig) return loadedConfig;
  const resolved = resolveConfigPath(explicitPath);
  if (!resolved) return undefined;

  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    loadedConfig = JSON.parse(raw) as MiniclawConfig;
    configPath = resolved;
    return loadedConfig;
  } catch (error) {
    console.error(`[Config] Failed to parse config file ${resolved}:`, error);
    return undefined;
  }
}

// ─── Config Accessors ────────────────────────────────────────────────────────

/** Get the default provider id (config file → env var → "deepseek") */
export function getDefaultProvider(): string {
  loadEnvFile();
  const config = loadConfigFile();
  return (
    config?.defaultProvider ||
    process.env.MINICLAW_DEFAULT_PROVIDER ||
    'deepseek'
  );
}

/** Get provider override settings for a provider id */
export function getProviderOverride(providerId: string): ProviderConfigOverride | undefined {
  const config = loadConfigFile();
  return config?.providers?.[providerId];
}

/** Get custom provider definitions */
export function getCustomProviders(): CustomProviderConfig[] | undefined {
  const config = loadConfigFile();
  return config?.customProviders;
}

/** Path of the loaded config file (for CLI --list-providers / debugging) */
export function getLoadedConfigPath(): string | undefined {
  return configPath;
}

/**
 * Resolve the effective config for a provider, merging config-file overrides
 * with the LLMConfig the caller passed. Precedence: caller args > env > config file.
 */
export function resolveEffectiveConfig(
  providerId: string,
  callerConfig: { apiKey?: string; baseURL?: string; model?: string },
): { apiKey?: string; baseURL?: string; model?: string } {
  loadEnvFile();
  const override = getProviderOverride(providerId);

  const apiKey = callerConfig.apiKey ||
    override?.apiKey ||
    process.env[`${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`] ||
    process.env.LLM_API_KEY;

  const baseURL = callerConfig.baseURL || override?.baseURL;

  const model = callerConfig.model || override?.model;

  return { apiKey, baseURL, model };
}
