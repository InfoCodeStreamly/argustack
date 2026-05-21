import type { CodeLayer } from '../core/types/code.js';

const HEURISTICS: { pattern: RegExp; layer: CodeLayer }[] = [
  { pattern: /(?:^|\/)domain(?:\/|$)/, layer: 'domain' },
  { pattern: /(?:^|\/)use-cases?(?:\/|$)/, layer: 'application' },
  { pattern: /(?:^|\/)application(?:\/|$)/, layer: 'application' },
  { pattern: /(?:^|\/)adapters?(?:\/|$)/, layer: 'infrastructure' },
  { pattern: /(?:^|\/)infrastructure(?:\/|$)/, layer: 'infrastructure' },
  { pattern: /(?:^|\/)infra(?:\/|$)/, layer: 'infrastructure' },
  { pattern: /(?:^|\/)cli(?:\/|$)/, layer: 'presentation' },
  { pattern: /(?:^|\/)mcp(?:\/|$)/, layer: 'presentation' },
  { pattern: /(?:^|\/)presentation(?:\/|$)/, layer: 'presentation' },
];

/**
 * Detect Clean Architecture layer for a file.
 * Priority: explicit prefix-mapping from `layerConfig` > path heuristic.
 * Returns null when no layer can be inferred — caller must decide whether
 * to skip or store as "unclassified".
 */
export function detectLayer(
  relativePath: string,
  layerConfig: Record<string, CodeLayer> = {},
): CodeLayer | null {
  for (const [prefix, layer] of Object.entries(layerConfig)) {
    if (relativePath.startsWith(prefix)) {
      return layer;
    }
  }
  for (const { pattern, layer } of HEURISTICS) {
    if (pattern.test(relativePath)) {
      return layer;
    }
  }
  return null;
}
