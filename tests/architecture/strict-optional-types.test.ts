/**
 * Strict Optional Types Architecture Test — Argustack
 *
 * Scans src/ for `Type | undefined` anti-pattern in interfaces and types.
 *
 * WHY THIS TEST EXISTS:
 * - TypeScript's exactOptionalPropertyTypes requires `field?: Type` syntax
 * - Using `field: Type | undefined` bypasses this protection
 * - This test catches violations before they reach production
 *
 * CORRECT vs WRONG:
 * WRONG:  password: string | undefined;  // allows { password: undefined }
 * CORRECT: password?: string;             // forbids { password: undefined }
 *
 * FIX ORDER (Hexagonal Architecture layers):
 * 1. CORE        - types, ports (no dependencies)
 * 2. USE CASES   - depends on Core
 * 3. ADAPTERS    - depends on Core
 * 4. CLI + MCP   - driving adapters (depends on everything)
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../src');

interface LayerConfig {
  name: string;
  order: number;
  emoji: string;
  directories: string[];
  description: string;
}

const LAYERS: LayerConfig[] = [
  {
    name: 'CORE',
    order: 1,
    emoji: '\u{1F3DB}\u{FE0F}',
    directories: ['core'],
    description: 'Fix FIRST - no dependencies on other layers',
  },
  {
    name: 'USE CASES',
    order: 2,
    emoji: '\u{2699}\u{FE0F}',
    directories: ['use-cases'],
    description: 'Fix SECOND - depends only on Core',
  },
  {
    name: 'ADAPTERS',
    order: 3,
    emoji: '\u{1F527}',
    directories: ['adapters'],
    description: 'Fix THIRD - depends on Core',
  },
  {
    name: 'CLI',
    order: 4,
    emoji: '\u{1F4BB}',
    directories: ['cli'],
    description: 'Fix FOURTH - driving adapter',
  },
  {
    name: 'MCP',
    order: 5,
    emoji: '\u{1F916}',
    directories: ['mcp'],
    description: 'Fix FIFTH - driving adapter',
  },
  {
    name: 'WORKSPACE',
    order: 6,
    emoji: '\u{1F4C1}',
    directories: ['workspace'],
    description: 'Fix LAST - infrastructure',
  },
];

const EXCLUDED_FILES: RegExp[] = [/\.test\.ts$/, /\.spec\.ts$/, /index\.ts$/];

const UNDEFINED_UNION_PATTERN = /^\s*(\w+):\s*([A-Z][\w[\]<>,\s]*)\s*\|\s*undefined\s*[;,]?\s*$/;
const MULTI_UNION_UNDEFINED_PATTERN = /^\s*(\w+):\s*(.+)\s*\|\s*undefined\s*[;,]?\s*$/;

interface Violation {
  file: string;
  line: number;
  fieldName: string;
  currentType: string;
  suggestion: string;
  layer: string;
  layerOrder: number;
}

interface LayerViolations {
  layer: LayerConfig;
  violations: Violation[];
}

function getLayerForFile(filePath: string): { layer: LayerConfig; name: string } {
  const relativePath = path.relative(SRC_ROOT, filePath);

  for (const layer of LAYERS) {
    for (const dir of layer.directories) {
      if (relativePath.startsWith(dir)) {
        return { layer, name: layer.name };
      }
    }
  }

  return {
    layer: {
      name: 'OTHER',
      order: 99,
      emoji: '\u{2753}',
      directories: [],
      description: 'Files outside standard layers',
    },
    name: 'OTHER',
  };
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const { layer, name: layerName } = getLayerForFile(filePath);

  let inInterfaceOrType = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNumber = i + 1;

    if (/^\s*(export\s+)?(interface|type)\s+\w+/.test(line)) {
      inInterfaceOrType = true;
      braceDepth = 0;
    }

    const openBraces = (line.match(/{/g) ?? []).length;
    const closeBraces = (line.match(/}/g) ?? []).length;
    braceDepth += openBraces - closeBraces;

    if (braceDepth <= 0 && inInterfaceOrType && closeBraces > 0) {
      inInterfaceOrType = false;
    }

    if (!inInterfaceOrType) {
      continue;
    }

    if (/^\s*\/\//.test(line) || /^\s*\/\*/.test(line) || /^\s*\*/.test(line)) {
      continue;
    }

    const match = UNDEFINED_UNION_PATTERN.exec(line) ?? MULTI_UNION_UNDEFINED_PATTERN.exec(line);

    if (match?.[1] && match[2]) {
      const fieldName = match[1];
      const typeStr = match[2];
      const cleanType = typeStr.trim();

      violations.push({
        file: filePath,
        line: lineNumber,
        fieldName,
        currentType: `${cleanType} | undefined`,
        suggestion: `${fieldName}?: ${cleanType}`,
        layer: layerName,
        layerOrder: layer.order,
      });
    }
  }

  return violations;
}

function scanDirectory(dirPath: string): Violation[] {
  const violations: Violation[] = [];

  if (!fs.existsSync(dirPath)) {
    return violations;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      violations.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const isExcluded = EXCLUDED_FILES.some(pattern => pattern.test(entry.name));
      if (isExcluded) {
        continue;
      }

      violations.push(...scanFile(fullPath));
    }
  }

  return violations;
}

function scanAllLayers(): LayerViolations[] {
  const allViolations = scanDirectory(SRC_ROOT);
  const layerMap = new Map<string, Violation[]>();

  for (const violation of allViolations) {
    const layer = violation.layer;
    if (!layerMap.has(layer)) {
      layerMap.set(layer, []);
    }
    const items = layerMap.get(layer);
    if (items) { items.push(violation); }
  }

  const results: LayerViolations[] = [];

  for (const layer of LAYERS) {
    const violations = layerMap.get(layer.name) ?? [];
    if (violations.length > 0) {
      results.push({ layer, violations });
    }
  }

  const otherViolations = layerMap.get('OTHER') ?? [];
  if (otherViolations.length > 0) {
    results.push({
      layer: {
        name: 'OTHER',
        order: 99,
        emoji: '\u{2753}',
        directories: [],
        description: 'Files outside standard layers - check paths',
      },
      violations: otherViolations,
    });
  }

  results.sort((a, b) => a.layer.order - b.layer.order);

  return results;
}

function formatViolationsReport(layerResults: LayerViolations[]): string {
  const totalViolations = layerResults.reduce((sum, lr) => sum + lr.violations.length, 0);
  const totalFiles = new Set(layerResults.flatMap(lr => lr.violations.map(v => v.file))).size;

  if (totalViolations === 0) {
    return 'No Type | undefined anti-patterns found!';
  }

  const lines: string[] = [
    '',
    '='.repeat(70),
    'STRICT OPTIONAL TYPES VIOLATIONS',
    '='.repeat(70),
    '',
    `Found ${totalViolations} violation(s) in ${totalFiles} file(s)`,
    '',
    '+' + '-'.repeat(68) + '+',
    '| FIX ORDER (Hexagonal Architecture - fix from inside out):          |',
    '|                                                                    |',
    '|   1  CORE        -> Fix FIRST (no dependencies)                   |',
    '|   2  USE CASES   -> Fix SECOND (depends on Core)                  |',
    '|   3  ADAPTERS    -> Fix THIRD (depends on Core)                   |',
    '|   4  CLI + MCP   -> Fix LAST (driving adapters)                   |',
    '|                                                                    |',
    '| After src/ is fixed, run: npm run check                           |',
    '| TypeScript will catch "field: undefined" in tests!                |',
    '+' + '-'.repeat(68) + '+',
    '',
    'HOW TO FIX EACH VIOLATION:',
    '  WRONG:  fieldName: string | undefined;',
    '  CORRECT: fieldName?: string;',
    '',
  ];

  lines.push('+' + '-'.repeat(20) + '+' + '-'.repeat(10) + '+' + '-'.repeat(9) + '+');
  lines.push('| Layer              | Files    | Errors  |');
  lines.push('+' + '-'.repeat(20) + '+' + '-'.repeat(10) + '+' + '-'.repeat(9) + '+');

  for (const { layer, violations } of layerResults) {
    const fileCount = new Set(violations.map(v => v.file)).size;
    const layerName = `${layer.emoji} ${layer.name}`.padEnd(18);
    const files = String(fileCount).padStart(6);
    const errCount = String(violations.length).padStart(7);
    lines.push(`| ${layerName} | ${files} | ${errCount} |`);
  }

  lines.push('+' + '-'.repeat(20) + '+' + '-'.repeat(10) + '+' + '-'.repeat(9) + '+');
  lines.push('');

  for (const { layer, violations } of layerResults) {
    const fileCount = new Set(violations.map(v => v.file)).size;

    lines.push('='.repeat(70));
    lines.push(
      `${layer.emoji} LAYER ${layer.order}: ${layer.name} (${violations.length} violations in ${fileCount} files)`
    );
    lines.push(`   ${layer.description}`);
    lines.push('-'.repeat(70));

    const byFile = new Map<string, Violation[]>();
    for (const v of violations) {
      const relativePath = path.relative(SRC_ROOT, v.file);
      if (!byFile.has(relativePath)) {
        byFile.set(relativePath, []);
      }
      const items = byFile.get(relativePath);
      if (items) { items.push(v); }
    }

    for (const [file, fileViolations] of byFile) {
      lines.push(`\n   ${file}`);

      for (const v of fileViolations) {
        lines.push(`      Line ${v.line}: ${v.fieldName}: ${v.currentType}`);
        lines.push(`      -> Fix: ${v.suggestion}`);
      }
    }

    lines.push('');
  }

  lines.push('='.repeat(70));
  lines.push('');
  lines.push('AFTER FIXING ALL LAYERS:');
  lines.push('   1. Run: npm run check');
  lines.push('   2. TypeScript will show "field: undefined" errors in tests');
  lines.push('   3. Fix tests by REMOVING "field: undefined" (just omit the field)');
  lines.push('');
  lines.push('='.repeat(70));

  return lines.join('\n');
}

describe('Strict Optional Types (src/ anti-pattern detection)', () => {
  it('should not have Type | undefined pattern in interfaces', () => {
    const layerResults = scanAllLayers();
    const totalViolations = layerResults.reduce((sum, lr) => sum + lr.violations.length, 0);

    if (totalViolations > 0) {
      const report = formatViolationsReport(layerResults);
      expect.fail(`Found ${totalViolations} Type | undefined anti-pattern(s).\n${report}`);
    }

    expect(totalViolations).toBe(0);
  });

  it('should have exactOptionalPropertyTypes enabled in tsconfig', () => {
    const tsconfigPath = path.resolve(__dirname, '../../tsconfig.json');
    const raw = fs.readFileSync(tsconfigPath, 'utf-8');
    const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const tsconfig = JSON.parse(stripped) as {
      compilerOptions?: { exactOptionalPropertyTypes?: boolean };
    };

    expect(tsconfig.compilerOptions?.exactOptionalPropertyTypes).toBe(true);
  });

  it('should have strict mode enabled in tsconfig', () => {
    const tsconfigPath = path.resolve(__dirname, '../../tsconfig.json');
    const raw = fs.readFileSync(tsconfigPath, 'utf-8');
    const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const tsconfig = JSON.parse(stripped) as {
      compilerOptions?: { strict?: boolean; noUnusedLocals?: boolean; noImplicitReturns?: boolean };
    };

    expect(tsconfig.compilerOptions?.strict).toBe(true);
    expect(tsconfig.compilerOptions?.noUnusedLocals).toBe(true);
    expect(tsconfig.compilerOptions?.noImplicitReturns).toBe(true);
  });

  it('should scan all configured layer directories', () => {
    const existingDirs: string[] = [];
    const missingDirs: string[] = [];

    for (const layer of LAYERS) {
      for (const dir of layer.directories) {
        const fullPath = path.join(SRC_ROOT, dir);
        if (fs.existsSync(fullPath)) {
          existingDirs.push(dir);
        } else {
          missingDirs.push(dir);
        }
      }
    }

    expect(existingDirs.length).toBeGreaterThan(0);
  });
});
