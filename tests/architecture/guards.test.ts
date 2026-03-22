import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'src');

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findTsFiles(fullPath));
    } else if (entry.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function readSource(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

describe('architecture guard: SourceType coverage in SOURCE_META', () => {
  it('every SourceType literal has a corresponding key in SOURCE_META', () => {
    const configPath = join(SRC, 'core', 'types', 'config.ts');
    const source = readSource(configPath);

    const typeMatch = /export\s+type\s+SourceType\s*=\s*([^;]+);/s.exec(source);
    expect(
      typeMatch,
      'Could not find SourceType union in src/core/types/config.ts — definition may have moved or been renamed'
    ).not.toBeNull();

    const unionBody = typeMatch?.[1] ?? '';
    const literalMatches = [...unionBody.matchAll(/'([^']+)'/g)];
    const sourceTypes = literalMatches.map((m) => m[1]);

    expect(
      sourceTypes.length,
      'SourceType union appears to have no string literals — check the regex or union syntax'
    ).toBeGreaterThan(0);

    const lines = source.split('\n');
    let inMeta = false;
    let depth = 0;
    const metaKeys: string[] = [];

    for (const line of lines) {
      if (!inMeta && /SOURCE_META\s*[=:]/.test(line)) {
        inMeta = true;
      }
      if (inMeta) {
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        const prevDepth = depth;
        depth += opens - closes;
        if (prevDepth === 1) {
          const keyMatch = /^\s{2}(\w+)\s*:/.exec(line);
          if (keyMatch) {
            metaKeys.push(keyMatch[1]);
          }
        }
        if (depth === 0) {
          break;
        }
      }
    }

    expect(
      inMeta,
      'Could not find SOURCE_META in src/core/types/config.ts — definition may have moved or been renamed'
    ).toBe(true);

    expect(
      metaKeys.length,
      'SOURCE_META appears to have no entries — check the parsing logic or the object definition'
    ).toBeGreaterThan(0);

    const missing = sourceTypes.filter((t) => !metaKeys.includes(t));
    expect(
      missing,
      `SourceType value(s) [${missing.join(', ')}] have no entry in SOURCE_META.\n` +
        `Add a label and description for each new source type in src/core/types/config.ts.`
    ).toHaveLength(0);
  });
});

describe('architecture guard: core ports have corresponding fakes', () => {
  it('every port file in src/core/ports/ has a matching fake in tests/fixtures/fakes/', () => {
    const portsDir = join(SRC, 'core', 'ports');
    const fakesDir = join(ROOT, 'tests', 'fixtures', 'fakes');

    const portFiles = readdirSync(portsDir)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .map((f) => basename(f, '.ts'));

    const fakeFiles = readdirSync(fakesDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => basename(f, '.ts'));

    const missing: string[] = [];

    for (const port of portFiles) {
      const stem = port.replace(/-provider$/, '').replace(/^storage$/, 'storage');

      const hasExact = fakeFiles.includes(`fake-${port}`);
      const hasStemmed = fakeFiles.includes(`fake-${stem}`);
      const hasAny = fakeFiles.some(
        (f) => f.startsWith('fake-') && f.includes(stem.replace(/-provider$/, ''))
      );

      if (!hasExact && !hasStemmed && !hasAny) {
        missing.push(port);
      }
    }

    expect(
      missing,
      `Port file(s) [${missing.map((p) => `${p}.ts`).join(', ')}] have no corresponding fake in tests/fixtures/fakes/.\n` +
        `Create a fake implementation (e.g. fake-${missing[0] ?? 'xxx'}.ts) so use-case integration tests can run without real adapters.`
    ).toHaveLength(0);
  });
});

describe('architecture guard: MCP tool count', () => {
  it('server registers exactly 18 tools', () => {
    const toolFiles = [
      join(SRC, 'mcp', 'tools', 'workspace.ts'),
      join(SRC, 'mcp', 'tools', 'query.ts'),
      join(SRC, 'mcp', 'tools', 'issue.ts'),
      join(SRC, 'mcp', 'tools', 'search.ts'),
      join(SRC, 'mcp', 'tools', 'estimate.ts'),
      join(SRC, 'mcp', 'tools', 'database.ts'),
    ];

    let totalRegistrations = 0;
    const registrationsByFile: Record<string, number> = {};

    for (const filePath of toolFiles) {
      const content = readSource(filePath);
      const matches = [...content.matchAll(/server\.registerTool\s*\(/g)];
      registrationsByFile[basename(filePath)] = matches.length;
      totalRegistrations += matches.length;
    }

    const breakdown = Object.entries(registrationsByFile)
      .map(([f, n]) => `  ${f}: ${String(n)} tool(s)`)
      .join('\n');

    expect(
      totalRegistrations,
      `Expected 20 MCP tool registrations but found ${String(totalRegistrations)}.\n` +
        `Breakdown by file:\n${breakdown}\n\n` +
        `If you added a new tool, update this guard to the new expected count AND add a test in tests/mcp/server.test.ts.`
    ).toBe(20);
  });
});

describe('architecture guard: no cross-adapter dependencies', () => {
  it('adapter files must not import from other adapters', () => {
    const adaptersDir = join(SRC, 'adapters');
    const adapterFiles = findTsFiles(adaptersDir);

    const violations: string[] = [];

    for (const filePath of adapterFiles) {
      const content = readSource(filePath);
      const lines = content.split('\n');
      const relPath = filePath.replace(`${ROOT}/`, '');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (!line.trim().startsWith('import')) {
          continue;
        }

        const fromMatch = /from\s+['"]([^'"]+)['"]/.exec(line);
        if (!fromMatch) {
          continue;
        }

        const importPath = fromMatch[1];

        if (!importPath.startsWith('.')) {
          continue;
        }

        const resolvedImport = resolve(filePath, '..', importPath);

        if (resolvedImport.startsWith(adaptersDir) && !filePath.startsWith(resolvedImport.split('/').slice(0, -1).join('/'))) {
          const importedRelPath = resolvedImport.replace(`${ROOT}/`, '');
          violations.push(`${relPath}:${i + 1} imports ${importedRelPath} (cross-adapter dependency)`);
        }
      }
    }

    expect(
      violations,
      `Adapters must not import from other adapters — each adapter should be independently replaceable.\n` +
        `Violations:\n${violations.join('\n')}\n\n` +
        `Fix: extract shared logic into src/core/ or a shared utility, not another adapter.`
    ).toHaveLength(0);
  });
});

describe('architecture guard: use cases depend only on core/', () => {
  it('use case files must not import from adapters, cli, or mcp', () => {
    const useCasesDir = join(SRC, 'use-cases');
    const useCaseFiles = findTsFiles(useCasesDir);

    const forbidden = [
      join(SRC, 'adapters'),
      join(SRC, 'cli'),
      join(SRC, 'mcp'),
    ];

    const violations: string[] = [];

    for (const filePath of useCaseFiles) {
      const content = readSource(filePath);
      const lines = content.split('\n');
      const relPath = filePath.replace(`${ROOT}/`, '');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (!line.trim().startsWith('import')) {
          continue;
        }

        const fromMatch = /from\s+['"]([^'"]+)['"]/.exec(line);
        if (!fromMatch) {
          continue;
        }

        const importPath = fromMatch[1];

        if (!importPath.startsWith('.')) {
          continue;
        }

        const resolvedImport = resolve(filePath, '..', importPath);

        for (const forbiddenDir of forbidden) {
          if (resolvedImport.startsWith(forbiddenDir)) {
            const importedRelPath = resolvedImport.replace(`${ROOT}/`, '');
            const layerName = forbiddenDir.replace(`${SRC}/`, '');
            violations.push(`${relPath}:${i + 1} imports from ${layerName}/ → ${importedRelPath}`);
          }
        }
      }
    }

    expect(
      violations,
      `Use cases must only depend on core/ (ports and types) — this is the Dependency Rule.\n` +
        `Violations:\n${violations.join('\n')}\n\n` +
        `Fix: use the port interface (IStorage, ISourceProvider, etc.) instead of the concrete adapter class.`
    ).toHaveLength(0);
  });
});
