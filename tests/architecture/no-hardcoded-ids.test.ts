import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { TESTS_ROOT, REQUIRED_SSOT_FILES } from './ssot-validator.config.js';
import {
  findAllScannable,
  scanFileForHardcodes,
  scanFileForLocalConstants,
  validateSSOTImports,
} from './ssot-validator.scanner.js';
import {
  formatHardcodeReport,
  formatLocalConstantReport,
  formatImportReport,
  formatStatistics,
} from './ssot-validator.formatter.js';

describe('SSOT: No Hardcoded IDs', () => {
  const files = findAllScannable();

  it('should scan a reasonable number of files', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('should have SSOT fixture files in place', () => {
    for (const requiredFile of REQUIRED_SSOT_FILES) {
      const fullPath = join(TESTS_ROOT, requiredFile);
      expect(existsSync(fullPath), `Missing SSOT file: ${requiredFile}`).toBe(true);
    }
  });

  it('should not contain hardcoded entity IDs', () => {
    const allViolations = files.flatMap(scanFileForHardcodes);
    const errors = allViolations.filter((v) => v.severity === 'error');

    if (errors.length > 0) {
      const report = formatHardcodeReport(errors);
      const stats = formatStatistics(allViolations, [], [], files.length);
      expect.fail(`Found ${errors.length} hardcoded entity IDs:\n${report}\n${stats}`);
    }
  });

  it('should not contain local constant anti-patterns', () => {
    const allViolations = files.flatMap(scanFileForLocalConstants);

    if (allViolations.length > 0) {
      const report = formatLocalConstantReport(allViolations);
      expect.fail(`Found ${allViolations.length} local constant anti-patterns:\n${report}`);
    }
  });

  it('should have correct SSOT imports', () => {
    const allViolations = files.flatMap(validateSSOTImports);

    if (allViolations.length > 0) {
      const report = formatImportReport(allViolations);
      expect.fail(`Found ${allViolations.length} missing SSOT imports:\n${report}`);
    }
  });
});
