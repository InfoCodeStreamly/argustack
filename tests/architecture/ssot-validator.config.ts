import { resolve, join } from 'node:path';

export const TESTS_ROOT = resolve(import.meta.dirname, '..');

export const FIXTURES_DIR = join(TESTS_ROOT, 'fixtures');

/**
 * Files excluded from HARDCODE scanning (SSOT definition files only).
 * Fixture files and builders are NOT excluded — they must use SSOT values.
 */
export const EXCLUDED_FILES_FOR_HARDCODE: RegExp[] = [
  /test-constants\.ts$/,
  /no-hardcoded-ids\.test\.ts$/,
  /ssot-validator\.\w+\.ts$/,
  /no-eslint-disable\.test\.ts$/,
];

export const EXCLUDED_FILES_COMPLETELY: RegExp[] = [
  /test-constants\.ts$/,
  /no-hardcoded-ids\.test\.ts$/,
  /ssot-validator\.\w+\.ts$/,
  /builders\/[\w-]+\.ts$/,
];

/**
 * Line patterns to exclude from hardcode detection (legitimate uses).
 */
export const EXCLUDED_LINE_PATTERNS: RegExp[] = [
  /** Import statements */
  /^import\s+/,
  /from\s+['"`]/,

  /** Test descriptions */
  /^\s*(describe|it|test)\s*\(\s*['"`]/,

  /** Comments */
  /^\s*\/\//,
  /^\s*\/\*/,
  /^\s*\*/,

  /** SSOT constant usage */
  /TEST_IDS\.\w+/,
  /GITHUB_TEST_IDS\.\w+/,

  /** SSOT factory usage */
  /create(Issue|Batch|Comment|Changelog|Worklog|Link|Project|PullRequest|PrReview|PrComment|PrFile|Release|GitHubBatch|EmptyBatch|EmptyGitHubBatch|WorkspaceConfig)\s*\(/,

  /** Builder usage */
  /new\s+(Issue|PullRequest)Builder\s*\(/,
  /\.(withKey|withId|withNumber|withState|withStatus|withType|withAuthor|build)\s*\(/,
  /\.(done|bug|story|open|merged|closed|draft|highPriority|unassigned)\s*\(/,

  /** Error messages and throw */
  /Error\s*\(\s*['"`]/,
  /throw\s+new/,
  /['"`][\w\s]+ not found['"`]/i,

  /** Date strings */
  /['"`]\d{4}-\d{2}-\d{2}/,

  /** URLs */
  /https?:\/\//,

  /** SQL queries */
  /SELECT\s+/i,
  /INSERT\s+/i,
  /UPDATE\s+/i,
  /WHERE\s+/i,
  /FROM\s+/i,

  /** Type assertions */
  /as\s+\{/,
  /as\s+\w+/,

  /** Vitest matchers with variables */
  /expect\([^)]*\)\.(toHaveLength|toBeGreaterThan|toBe(true|false|null|undefined)|toHaveBeenCalled)/,

  /** Regex patterns */
  /\/\^[^/]+\$?\//,
  /toMatch\s*\(\s*\//,

  /** File paths */
  /['"`]\.\.?\//,
  /['"`]src\//,

  /** Git branch names */
  /['"`](feature|bugfix|hotfix|release|fix|chore|docs|refactor)\//,
  /ref:\s*['"`]/,
  /headRef|baseRef/,

  /** Mock/spy setup */
  /vi\.(mock|fn|spyOn)\s*\(/,

  /** Seed/helper calls (test infrastructure) */
  /\.(seed|seedLastUpdated|seedProjects|seedBatches|seedReleases)\s*\(/,
];

export const REQUIRED_SSOT_FILES: string[] = [
  'fixtures/shared/test-constants.ts',
  'fixtures/builders/issue-builder.ts',
  'fixtures/builders/pull-request-builder.ts',
];
