import type {
  HardcodePattern,
  LocalConstantPattern,
  SSOTImportRequirement,
} from './ssot-validator.types.js';

export const HARDCODE_PATTERNS: HardcodePattern[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // JIRA ENTITIES
  // ══════════════════════════════════════════════════════════════════════════
  {
    pattern: /['"`][A-Z]{2,}-\d+['"`]/g,
    suggestion: '-> use TEST_IDS.issueKey or createIssue({ key: ... })',
    severity: 'error',
    category: 'Jira Issue Keys',
  },
  {
    pattern: /['"`]\d{5,6}['"`]/g,
    suggestion: '-> use TEST_IDS.issueId or TEST_IDS.projectId',
    severity: 'error',
    category: 'Numeric IDs',
  },
  {
    pattern: /['"`]comment-\d+['"`]/gi,
    suggestion: '-> use TEST_IDS.commentId',
    severity: 'error',
    category: 'Comment IDs',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GITHUB ENTITIES
  // ══════════════════════════════════════════════════════════════════════════
  {
    pattern: /['"`][\w][\w-]*\/[\w][\w-]*['"`]/g,
    suggestion: '-> use GITHUB_TEST_IDS.repoFullName',
    severity: 'error',
    category: 'Repo Names',
  },
  {
    pattern: /['"`][a-f0-9]{40}['"`]/g,
    suggestion: '-> use SSOT constant for commit hashes',
    severity: 'error',
    category: 'Commit Hashes',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PERSON NAMES (known test values)
  // ══════════════════════════════════════════════════════════════════════════
  {
    pattern: /['"`](johndoe|janedoe)['"`]/gi,
    suggestion: '-> use TEST_IDS.author or createPullRequest({ author: ... })',
    severity: 'error',
    category: 'Person Names',
  },
  {
    pattern: /['"`](John Doe|Jane Smith)['"`]/g,
    suggestion: '-> use TEST_IDS.author or TEST_IDS.reporter',
    severity: 'error',
    category: 'Person Names',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // GENERIC PLACEHOLDERS
  // ══════════════════════════════════════════════════════════════════════════
  {
    pattern: /['"`]\w+-(abc|xyz|foo|bar)['"`]/gi,
    suggestion: '-> use SSOT factory or TEST_IDS constant',
    severity: 'warning',
    category: 'Generic Placeholders',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ASSERTION HARDCODES
  // ══════════════════════════════════════════════════════════════════════════
  {
    pattern: /\.toBe\(\s*['"`][A-Z]{2,}-\d+['"`]\s*\)/g,
    suggestion: '-> use TEST_IDS.issueKey in assertions',
    severity: 'error',
    category: 'Assertion Hardcodes',
  },
  {
    pattern: /\.toEqual\(\s*['"`][A-Z]{2,}-\d+['"`]\s*\)/g,
    suggestion: '-> use TEST_IDS.issueKey in assertions',
    severity: 'error',
    category: 'Assertion Hardcodes',
  },
  {
    pattern: /\.toContain\(\s*['"`][A-Z]{2,}-\d+['"`]\s*\)/g,
    suggestion: '-> use TEST_IDS.issueKey in assertions',
    severity: 'error',
    category: 'Assertion Hardcodes',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECT LITERAL HARDCODES
  // ══════════════════════════════════════════════════════════════════════════
  {
    pattern: /(key|issueKey|projectKey)\s*:\s*['"`][A-Z]{2,}-\d+['"`]/g,
    suggestion: '-> use createIssue() override or TEST_IDS.*',
    severity: 'error',
    category: 'Object Literal Hardcodes',
  },
  {
    pattern: /repoFullName\s*:\s*['"`][\w-]+\/[\w-]+['"`]/g,
    suggestion: '-> use GITHUB_TEST_IDS.repoFullName',
    severity: 'error',
    category: 'Object Literal Hardcodes',
  },
];

export const LOCAL_CONSTANT_PATTERNS: LocalConstantPattern[] = [
  {
    pattern: /const\s+(ISSUE_KEY|PROJECT_KEY|TEST_KEY|REPO_NAME|PR_NUMBER|REVIEW_ID|COMMENT_ID)\s*=/gi,
    suggestion: '-> import from test-constants.ts instead of defining locally',
    severity: 'error',
  },
  {
    pattern: /const\s+\w*(issueKey|projectKey|repoName)\w*\s*=\s*['"`]/gi,
    suggestion: '-> import TEST_IDS or GITHUB_TEST_IDS from test-constants.ts',
    severity: 'error',
  },
];

export const SSOT_IMPORT_REQUIREMENTS: SSOTImportRequirement[] = [
  {
    usagePattern: /createIssue\s*\(/,
    requiredImport: /from\s+['"`].*test-constants/,
    suggestion: "-> add: import { createIssue } from '...test-constants.js'",
  },
  {
    usagePattern: /createBatch\s*\(/,
    requiredImport: /from\s+['"`].*test-constants/,
    suggestion: "-> add: import { createBatch } from '...test-constants.js'",
  },
  {
    usagePattern: /TEST_IDS\./,
    requiredImport: /from\s+['"`].*test-constants/,
    suggestion: "-> add: import { TEST_IDS } from '...test-constants.js'",
  },
  {
    usagePattern: /GITHUB_TEST_IDS\./,
    requiredImport: /from\s+['"`].*test-constants/,
    suggestion: "-> add: import { GITHUB_TEST_IDS } from '...test-constants.js'",
  },
  {
    usagePattern: /IssueBuilder/,
    requiredImport: /from\s+['"`].*builders/,
    suggestion: "-> add: import { IssueBuilder } from '...builders/index.js'",
  },
  {
    usagePattern: /PullRequestBuilder/,
    requiredImport: /from\s+['"`].*builders/,
    suggestion: "-> add: import { PullRequestBuilder } from '...builders/index.js'",
  },
];
