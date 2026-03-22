import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceConfig, SourceType } from '../core/types/index.js';

const CONFIG_FILE = '.argustack/config.json';

/**
 * Create a fresh empty workspace config.
 */
export function createEmptyConfig(): WorkspaceConfig {
  return {
    version: 1,
    sources: {},
    order: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Read config.json from workspace root.
 * Returns null if not found.
 */
export function readConfig(workspaceRoot: string): WorkspaceConfig | null {
  const path = join(workspaceRoot, CONFIG_FILE);
  if (!existsSync(path)) {
    return null;
  }

  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as WorkspaceConfig;
}

/**
 * Write config.json to workspace root.
 */
export function writeConfig(workspaceRoot: string, config: WorkspaceConfig): void {
  const path = join(workspaceRoot, CONFIG_FILE);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Add a new source to the config (first-time setup).
 */
export function addSource(config: WorkspaceConfig, source: SourceType): WorkspaceConfig {
  const existing = config.sources[source];

  config.sources[source] = {
    enabled: true,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };

  if (!config.order.includes(source)) {
    config.order.push(source);
  }

  return config;
}

/**
 * Re-enable a previously disabled source.
 * Different from addSource — doesn't reset addedAt, just flips enabled.
 */
export function enableSource(config: WorkspaceConfig, source: SourceType): WorkspaceConfig {
  const existing = config.sources[source];
  if (!existing) {
    return addSource(config, source);
  }

  existing.enabled = true;
  delete existing.disabledAt;

  if (!config.order.includes(source)) {
    config.order.push(source);
  }

  return config;
}

/**
 * Disable a source (soft — keeps credentials in .env).
 */
export function disableSource(config: WorkspaceConfig, source: SourceType): WorkspaceConfig {
  const existing = config.sources[source];
  if (existing) {
    existing.enabled = false;
    existing.disabledAt = new Date().toISOString();
  }

  config.order = config.order.filter((s) => s !== source);

  return config;
}

/**
 * Get enabled sources in order.
 */
export function getEnabledSources(config: WorkspaceConfig): SourceType[] {
  return config.order.filter((s) => config.sources[s]?.enabled);
}

/**
 * Check if a specific source is enabled.
 */
export function isSourceEnabled(config: WorkspaceConfig, source: SourceType): boolean {
  return config.sources[source]?.enabled === true;
}
