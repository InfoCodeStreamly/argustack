import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  TESTS_ROOT,
  EXCLUDED_FILES_FOR_HARDCODE,
  EXCLUDED_FILES_COMPLETELY,
  EXCLUDED_LINE_PATTERNS,
} from './ssot-validator.config.js';
import {
  HARDCODE_PATTERNS,
  LOCAL_CONSTANT_PATTERNS,
  SSOT_IMPORT_REQUIREMENTS,
} from './ssot-validator.patterns.js';
import type {
  Violation,
  LocalConstantViolation,
  ImportViolation,
} from './ssot-validator.types.js';

function collectFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) {return results;}

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'logs') {continue;}
      results.push(...collectFiles(fullPath, pattern));
    } else if (pattern.test(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

export function findTestFiles(): string[] {
  return collectFiles(TESTS_ROOT, /\.test\.ts$/);
}

export function findFixtureFiles(): string[] {
  return collectFiles(join(TESTS_ROOT, 'fixtures'), /\.ts$/);
}

export function findAllScannable(): string[] {
  return [...findTestFiles(), ...findFixtureFiles()];
}

export function isExcludedFromHardcodeScan(filePath: string): boolean {
  return EXCLUDED_FILES_FOR_HARDCODE.some((p) => p.test(filePath));
}

export function isExcludedCompletely(filePath: string): boolean {
  return EXCLUDED_FILES_COMPLETELY.some((p) => p.test(filePath));
}

function isExcludedLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.length < 3) {return true;}
  return EXCLUDED_LINE_PATTERNS.some((p) => p.test(trimmed));
}

export function scanFileForHardcodes(filePath: string): Violation[] {
  if (isExcludedFromHardcodeScan(filePath)) {return [];}

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];
  const relPath = relative(TESTS_ROOT, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (isExcludedLine(line)) {continue;}

    for (const hp of HARDCODE_PATTERNS) {
      const regex = new RegExp(hp.pattern.source, hp.pattern.flags);
      let match = regex.exec(line);
      while (match) {
        violations.push({
          file: relPath,
          line: i + 1,
          content: line.trim(),
          match: match[0],
          suggestion: hp.suggestion,
          severity: hp.severity,
          category: hp.category,
        });
        match = regex.exec(line);
      }
    }
  }

  return violations;
}

export function scanFileForLocalConstants(filePath: string): LocalConstantViolation[] {
  if (isExcludedCompletely(filePath)) {return [];}

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: LocalConstantViolation[] = [];
  const relPath = relative(TESTS_ROOT, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {continue;}

    for (const lcp of LOCAL_CONSTANT_PATTERNS) {
      const regex = new RegExp(lcp.pattern.source, lcp.pattern.flags);
      if (regex.test(trimmed)) {
        violations.push({
          file: relPath,
          line: i + 1,
          content: trimmed,
          suggestion: lcp.suggestion,
        });
      }
    }
  }

  return violations;
}

export function validateSSOTImports(filePath: string): ImportViolation[] {
  if (isExcludedCompletely(filePath)) {return [];}

  const content = readFileSync(filePath, 'utf-8');
  const violations: ImportViolation[] = [];
  const relPath = relative(TESTS_ROOT, filePath);

  for (const req of SSOT_IMPORT_REQUIREMENTS) {
    if (req.usagePattern.test(content) && !req.requiredImport.test(content)) {
      violations.push({
        file: relPath,
        usage: req.usagePattern.source,
        suggestion: req.suggestion,
      });
    }
  }

  return violations;
}
