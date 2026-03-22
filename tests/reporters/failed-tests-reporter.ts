/**
 * Custom Vitest Reporter — Failed Tests Logger for AI Agents.
 * Captures failed tests and writes detailed logs to tests/logs/.
 * Adapted from paperlink.online test infrastructure.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter, TestCase, TestModule } from 'vitest/node';
import type { SerializedError } from '@vitest/utils';

interface FailedTest {
  file: string;
  testName: string;
  error: string;
  location: string;
}

export default class FailedTestsReporter implements Reporter {
  private readonly failedTests: FailedTest[] = [];
  private unhandledErrors: string[] = [];

  onTestCaseResult(testCase: TestCase): void {
    const result = testCase.result();

    if (result.state === 'failed') {
      const errors = result.errors ?? []; // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- result.errors can be undefined at runtime

      for (const error of errors) {
        this.failedTests.push({
          file: testCase.module.moduleId,
          testName: this.getFullTestName(testCase),
          error: this.formatError(error),
          location: this.extractLocation(error),
        });
      }
    }
  }

  onTestRunEnd(
    _testModules: readonly TestModule[],
    unhandledErrors: readonly SerializedError[],
  ): void {
    if (unhandledErrors.length > 0) {
      this.unhandledErrors = unhandledErrors.map((err) => this.formatError(err));
    }

    if (this.failedTests.length === 0 && this.unhandledErrors.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = join(process.cwd(), 'tests', 'logs');
    const logFile = join(logDir, `failed-tests-${timestamp}.log`);

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    writeFileSync(logFile, this.buildLogContent(), 'utf-8');

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log(
      `║  FAILED: ${this.failedTests.length} test(s), ${this.unhandledErrors.length} unhandled error(s)`,
    );
    console.log(`║  Report: tests/logs/failed-tests-${timestamp}.log`);
    console.log('╚══════════════════════════════════════════════════════════╝');
  }

  private buildLogContent(): string {
    const lines: string[] = [];
    const sep = '═'.repeat(80);
    const thin = '─'.repeat(80);

    lines.push('', sep);
    lines.push('  FAILED TESTS REPORT');
    lines.push(`  Generated: ${new Date().toISOString()}`);
    lines.push(`  Total Failures: ${this.failedTests.length}`);
    lines.push(sep, '');

    // Quick summary
    if (this.failedTests.length > 0) {
      const uniqueFiles = [...new Set(this.failedTests.map((t) => t.file))];
      lines.push(`Files with failures: ${uniqueFiles.length}`);
      for (const file of uniqueFiles) {
        const count = this.failedTests.filter((t) => t.file === file).length;
        lines.push(`  - ${file} (${count} failures)`);
      }
      lines.push('', thin, '');

      // Details
      lines.push('## DETAILED FAILURES:', '');
      for (const [index, test] of this.failedTests.entries()) {
        lines.push(`### [${index + 1}/${this.failedTests.length}] ${thin.slice(0, 50)}`);
        lines.push('', `FILE: ${test.file}`, `TEST: ${test.testName}`, '');
        lines.push('ERROR:', test.error, '');
        if (test.location) {
          lines.push(`LOCATION: ${test.location}`, '');
        }
        lines.push(thin, '');
      }
    }

    // Unhandled errors
    if (this.unhandledErrors.length > 0) {
      lines.push('', '## UNHANDLED ERRORS:', '');
      for (const [index, error] of this.unhandledErrors.entries()) {
        lines.push(`[Unhandled ${index + 1}]`, error, '', thin, '');
      }
    }

    lines.push('', sep, '');
    return lines.join('\n');
  }

  private getFullTestName(testCase: TestCase): string {
    const names: string[] = [];
    let current: TestCase['parent'] | undefined = testCase.parent;
    while (current && 'name' in current) {
      names.unshift(current.name);
      current = 'parent' in current ? current.parent : undefined;
    }
    names.push(testCase.name);
    return names.join(' > ');
  }

  private formatError(error: unknown): string {
    if (!error) {
      return 'Unknown error';
    }
    if (typeof error === 'string') {
      return error;
    }

    const err = error as Record<string, unknown>;
    const lines: string[] = [];

    const rawName = err['name'] ?? err['nameStr'];
    const name = typeof rawName === 'string' ? rawName : 'Error';
    const rawMessage = err['message'];
    const message = typeof rawMessage === 'string' ? rawMessage : 'Unknown error';
    lines.push(`${name}: ${message}`);

    if (err['expected'] !== undefined && err['actual'] !== undefined) {
      lines.push('', '- Expected:', `  ${this.stringify(err['expected'])}`);
      lines.push('+ Actual:', `  ${this.stringify(err['actual'])}`);
    }

    const stack = err['stack'] ?? err['stackStr'];
    if (typeof stack === 'string') {
      lines.push('', 'Stack:', ...stack.split('\n').slice(0, 8).map((l) => `  ${l}`));
    }

    return lines.join('\n');
  }

  private extractLocation(error: unknown): string {
    if (!error) {
      return '';
    }
    const err = error as Record<string, unknown>;
    const raw = err['stack'] ?? err['stackStr'] ?? '';
    if (typeof raw !== 'string') {
      return '';
    }

    const match = /at .+ \((.+):(\d+):(\d+)\)/.exec(raw) ?? /(.+):(\d+):(\d+)/.exec(raw);
    if (match) {
      return `${match[1]}:${match[2]}:${match[3]}`;
    }
    return '';
  }

  private stringify(value: unknown): string {
    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return typeof value === 'object' ? '[object]' : `${value as string | number | boolean}`;
    }
  }
}
