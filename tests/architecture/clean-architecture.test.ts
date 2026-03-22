/**
 * Clean Architecture Layer Validation — Argustack
 *
 * Uses dependency-cruiser programmatic API to validate Hexagonal Architecture:
 *   core/       → ZERO dependencies on outer layers
 *   use-cases/  → depends only on core/
 *   adapters/   → depends only on core/, NOT on cli/mcp/use-cases
 *   cli/ + mcp/ → composition root, can depend on everything
 *
 * Rules defined in .dependency-cruiser.cjs
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
  summary: {
    violations: CruiseViolation[];
    error: number;
    warn: number;
    info: number;
  };
}

interface CruiseResult {
  output: CruiseOutput;
}

const cruise = rawCruise as unknown as (dirs: string[], options: Record<string, unknown>) => Promise<CruiseResult>;

const SRC_DIR = path.resolve(__dirname, '../../src');
const CONFIG_PATH = path.resolve(__dirname, '../../.dependency-cruiser.cjs');

function formatViolations(violations: CruiseViolation[]): string {
  if (violations.length === 0) {
    return 'No violations found';
  }

  const grouped = violations.reduce<Record<string, string[]>>((acc, v) => {
    const ruleName = v.rule.name;
    acc[ruleName] ??= [];
    acc[ruleName].push(`  ${v.from} → ${v.to}`);
    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([rule, deps]) => `\n${rule}:\n${deps.join('\n')}`)
    .join('\n');
}

function getErrorViolations(violations: CruiseViolation[]): CruiseViolation[] {
  return violations.filter(v => v.rule.severity === 'error');
}

function filterByRulePattern(violations: CruiseViolation[], pattern: string): CruiseViolation[] {
  return violations.filter(v => v.rule.name.includes(pattern));
}

describe('Hexagonal Architecture Layer Validation', () => {
  let errors: CruiseViolation[];
  let summary: CruiseOutput['summary'];

  beforeAll(async () => {
    const config = await import(CONFIG_PATH) as { default: { options?: Record<string, unknown> } };
    const cruiseOptions = {
      validate: true,
      ruleSet: config.default,
      ...config.default.options,
    };

    const result = await cruise([SRC_DIR], cruiseOptions);
    errors = getErrorViolations(result.output.summary.violations);
    summary = result.output.summary;
  }, 60_000);

  describe('Core Layer Isolation (ZERO external dependencies)', () => {
    it('should not depend on adapters', () => {
      const violations = filterByRulePattern(errors, 'core-no-adapters');
      if (violations.length > 0) {
        expect.fail(`Core must not depend on adapters:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not depend on use-cases', () => {
      const violations = filterByRulePattern(errors, 'core-no-use-cases');
      if (violations.length > 0) {
        expect.fail(`Core must not depend on use-cases:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not depend on CLI', () => {
      const violations = filterByRulePattern(errors, 'core-no-cli');
      if (violations.length > 0) {
        expect.fail(`Core must not depend on CLI:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not depend on MCP', () => {
      const violations = filterByRulePattern(errors, 'core-no-mcp');
      if (violations.length > 0) {
        expect.fail(`Core must not depend on MCP:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not import pg (database-specific)', () => {
      const violations = filterByRulePattern(errors, 'core-no-pg');
      if (violations.length > 0) {
        expect.fail(`Core must not import pg:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not import jira.js (adapter-specific)', () => {
      const violations = filterByRulePattern(errors, 'core-no-jira');
      if (violations.length > 0) {
        expect.fail(`Core must not import jira.js:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not import octokit (adapter-specific)', () => {
      const violations = filterByRulePattern(errors, 'core-no-octokit');
      if (violations.length > 0) {
        expect.fail(`Core must not import octokit:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not import openai (adapter-specific)', () => {
      const violations = filterByRulePattern(errors, 'core-no-openai');
      if (violations.length > 0) {
        expect.fail(`Core must not import openai:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not import express (framework-specific)', () => {
      const violations = filterByRulePattern(errors, 'core-no-express');
      if (violations.length > 0) {
        expect.fail(`Core must not import express:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe('Use Cases Isolation (depends only on core/)', () => {
    it('should not depend on adapters', () => {
      const violations = filterByRulePattern(errors, 'use-cases-no-adapters');
      if (violations.length > 0) {
        expect.fail(`Use cases must use core/ports, not adapters:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not depend on CLI', () => {
      const violations = filterByRulePattern(errors, 'use-cases-no-cli');
      if (violations.length > 0) {
        expect.fail(`Use cases must not depend on CLI:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not depend on MCP', () => {
      const violations = filterByRulePattern(errors, 'use-cases-no-mcp');
      if (violations.length > 0) {
        expect.fail(`Use cases must not depend on MCP:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not import pg directly', () => {
      const violations = filterByRulePattern(errors, 'use-cases-no-pg');
      if (violations.length > 0) {
        expect.fail(`Use cases must not import pg directly:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not import jira.js directly', () => {
      const violations = filterByRulePattern(errors, 'use-cases-no-jira');
      if (violations.length > 0) {
        expect.fail(`Use cases must not import jira.js directly:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe('Adapters Isolation (depends only on core/)', () => {
    it('should not depend on CLI', () => {
      const violations = filterByRulePattern(errors, 'adapters-no-cli');
      if (violations.length > 0) {
        expect.fail(`Adapters must not depend on CLI:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not depend on MCP', () => {
      const violations = filterByRulePattern(errors, 'adapters-no-mcp');
      if (violations.length > 0) {
        expect.fail(`Adapters must not depend on MCP:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });

    it('should not depend on use-cases', () => {
      const violations = filterByRulePattern(errors, 'adapters-no-use-cases');
      if (violations.length > 0) {
        expect.fail(`Adapters must not depend on use-cases:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe('No Circular Dependencies', () => {
    it('should have no circular imports', () => {
      const violations = filterByRulePattern(errors, 'no-circular');
      if (violations.length > 0) {
        expect.fail(`Circular dependencies found:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });
  });

  describe('Test Boundaries', () => {
    it('should not import test files from production code', () => {
      const violations = filterByRulePattern(errors, 'not-to-test');
      if (violations.length > 0) {
        expect.fail(`Production code imports test files:\n${formatViolations(violations)}`);
      }
      expect(violations).toHaveLength(0);
    });
  });

  it('should provide violation summary', () => {
    console.log('\n Dependency Analysis Summary:');
    console.log(`   Errors: ${summary.error}`);
    console.log(`   Warnings: ${summary.warn}`);
    console.log(`   Info: ${summary.info}`);
    console.log(`   Total violations: ${summary.violations.length}`);

    expect(true).toBe(true);
  });
});
