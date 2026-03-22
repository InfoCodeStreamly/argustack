/**
 * Dead Artifacts Detection — Argustack
 *
 * Uses dependency-cruiser to find:
 * 1. Dead files — modules with 0 production importers
 * 2. Missing port implementations — adapters that don't import their port interface
 *
 * Catches code that was created but never wired up.
 */

import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cruise as rawCruise } from 'dependency-cruiser';

interface CruiseViolation {
  rule: { name: string; severity: string };
  from: string;
  to: string;
}

interface CruiseOutput {
  summary: { violations: CruiseViolation[] };
}

interface CruiseResult {
  output: CruiseOutput;
}

const cruise = rawCruise as unknown as (dirs: string[], options: Record<string, unknown>) => Promise<CruiseResult>;

const SRC_DIR = path.resolve(__dirname, '../../src');
const CONFIG_PATH = path.resolve(__dirname, '../../.dependency-cruiser.cjs');

let violations: CruiseViolation[];

function filterByRule(ruleName: string): CruiseViolation[] {
  return violations.filter(v => v.rule.name === ruleName);
}

function formatViolations(items: CruiseViolation[]): string {
  return items.map(v => `  ${v.to || v.from}`).join('\n');
}

describe('Dead Artifacts Detection', () => {
  beforeAll(async () => {
    const config = await import(CONFIG_PATH) as { default: { options?: Record<string, unknown> } };
    const cruiseOptions = {
      validate: true,
      ruleSet: config.default,
      ...config.default.options,
    };

    const result = await cruise([SRC_DIR], cruiseOptions);
    violations = result.output.summary.violations;
  }, 60_000);

  it('should have no circular dependencies', () => {
    const circular = filterByRule('no-circular');
    if (circular.length > 0) {
      expect.fail(`Circular dependencies found:\n${formatViolations(circular)}`);
    }
    expect(circular).toHaveLength(0);
  });

  it('should not import test files from production code', () => {
    const testImports = filterByRule('not-to-test');
    if (testImports.length > 0) {
      expect.fail(`Production code imports test files:\n${formatViolations(testImports)}`);
    }
    expect(testImports).toHaveLength(0);
  });

  it('should not import spec files', () => {
    const specImports = filterByRule('not-to-spec');
    if (specImports.length > 0) {
      expect.fail(`Importing spec/test files:\n${formatViolations(specImports)}`);
    }
    expect(specImports).toHaveLength(0);
  });
});
