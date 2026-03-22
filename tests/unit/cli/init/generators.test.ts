import { describe, it, expect } from 'vitest';
import { generateEnv } from '../../../../src/cli/init/generators.js';
import type {
  JiraSetupResult,
  GitSetupResult,
  GitHubSetupResult,
  CsvSetupResult,
  DbSetupResult,
} from '../../../../src/cli/init/types.js';

/**
 * Local factory functions for init-specific setup results.
 * These are NOT in the SSOT test-constants because they are
 * specific to the init flow and not domain types.
 */

function createJiraSetup(overrides?: Partial<JiraSetupResult>): JiraSetupResult {
  return {
    jiraUrl: 'https://example.atlassian.net',
    jiraEmail: 'dev@example.com',
    jiraToken: 'jira-token-abc123',
    jiraProjects: ['PROJ'],
    ...overrides,
  };
}

function createGitSetup(overrides?: Partial<GitSetupResult>): GitSetupResult {
  return {
    gitRepoPaths: ['/home/user/repo'],
    ...overrides,
  };
}

function createGitHubSetup(overrides?: Partial<GitHubSetupResult>): GitHubSetupResult {
  return {
    githubToken: 'ghp_testtoken123',
    githubOwner: 'test-org',
    githubRepo: 'test-repo',
    ...overrides,
  };
}

function createCsvSetup(overrides?: Partial<CsvSetupResult>): CsvSetupResult {
  return {
    csvFilePath: '/home/user/export.csv',
    ...overrides,
  };
}

function createDbSetup(overrides?: Partial<DbSetupResult>): DbSetupResult {
  return {
    targetDbEngine: 'postgresql',
    targetDbHost: 'prod-db.example.com',
    targetDbPort: 5432,
    targetDbUser: 'readonly',
    targetDbPassword: 'secret',
    targetDbName: 'myapp',
    ...overrides,
  };
}

const DEFAULT_ARGUSTACK_PORT = 5434;

describe('generateEnv', () => {
  describe('all sources provided', () => {
    it('includes all sections in the output', () => {
      const result = generateEnv(
        createJiraSetup(),
        createGitSetup(),
        createGitHubSetup(),
        createCsvSetup(),
        createDbSetup(),
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result).toContain('# === Jira ===');
      expect(result).toContain('# === Git ===');
      expect(result).toContain('# === GitHub ===');
      expect(result).toContain('# === Jira CSV ===');
      expect(result).toContain('# === Target Database (project DB to analyze) ===');
      expect(result).toContain('# === Argustack internal PostgreSQL (match docker-compose.yml) ===');
    });

    it('writes correct values for every source field', () => {
      const jira = createJiraSetup();
      const git = createGitSetup();
      const github = createGitHubSetup();
      const csv = createCsvSetup();
      const db = createDbSetup();

      const result = generateEnv(jira, git, github, csv, db, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain(`JIRA_URL=${jira.jiraUrl}`);
      expect(result).toContain(`JIRA_EMAIL=${jira.jiraEmail}`);
      expect(result).toContain(`JIRA_API_TOKEN=${jira.jiraToken}`);
      expect(result).toContain(`JIRA_PROJECTS=${jira.jiraProjects[0]}`);
      expect(result).toContain(`GIT_REPO_PATHS=${git.gitRepoPaths[0]}`);
      expect(result).toContain(`GITHUB_TOKEN=${github.githubToken}`);
      expect(result).toContain(`GITHUB_OWNER=${github.githubOwner}`);
      expect(result).toContain(`GITHUB_REPO=${github.githubRepo}`);
      expect(result).toContain(`CSV_FILE_PATH=${csv.csvFilePath}`);
      expect(result).toContain(`TARGET_DB_ENGINE=${db.targetDbEngine}`);
      expect(result).toContain(`TARGET_DB_HOST=${db.targetDbHost}`);
      expect(result).toContain(`TARGET_DB_PORT=${String(db.targetDbPort)}`);
      expect(result).toContain(`TARGET_DB_USER=${db.targetDbUser}`);
      expect(result).toContain(`TARGET_DB_PASSWORD=${db.targetDbPassword}`);
      expect(result).toContain(`TARGET_DB_NAME=${db.targetDbName}`);
    });

    it('ends with a trailing newline', () => {
      const result = generateEnv(
        createJiraSetup(),
        createGitSetup(),
        createGitHubSetup(),
        createCsvSetup(),
        createDbSetup(),
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result.endsWith('\n')).toBe(true);
    });
  });

  describe('only Jira provided', () => {
    it('includes Jira block and Argustack DB block', () => {
      const result = generateEnv(
        createJiraSetup(),
        null,
        null,
        null,
        null,
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result).toContain('# === Jira ===');
      expect(result).toContain('# === Argustack internal PostgreSQL (match docker-compose.yml) ===');
    });

    it('does not include Git, GitHub, CSV, or target DB sections', () => {
      const result = generateEnv(
        createJiraSetup(),
        null,
        null,
        null,
        null,
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result).not.toContain('# === Git ===');
      expect(result).not.toContain('# === GitHub ===');
      expect(result).not.toContain('# === Jira CSV ===');
      expect(result).not.toContain('# === Target Database (project DB to analyze) ===');
    });
  });

  describe('only Git provided', () => {
    it('includes Git block and Argustack DB block', () => {
      const result = generateEnv(
        null,
        createGitSetup(),
        null,
        null,
        null,
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result).toContain('# === Git ===');
      expect(result).toContain('# === Argustack internal PostgreSQL (match docker-compose.yml) ===');
    });

    it('does not include Jira, GitHub, CSV, or target DB sections', () => {
      const result = generateEnv(
        null,
        createGitSetup(),
        null,
        null,
        null,
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result).not.toContain('# === Jira ===');
      expect(result).not.toContain('# === GitHub ===');
      expect(result).not.toContain('# === Jira CSV ===');
      expect(result).not.toContain('# === Target Database (project DB to analyze) ===');
    });
  });

  describe('only target DB provided', () => {
    it('includes target DB block and Argustack DB block', () => {
      const result = generateEnv(
        null,
        null,
        null,
        null,
        createDbSetup(),
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result).toContain('# === Target Database (project DB to analyze) ===');
      expect(result).toContain('# === Argustack internal PostgreSQL (match docker-compose.yml) ===');
    });

    it('does not include Jira, Git, GitHub, or CSV sections', () => {
      const result = generateEnv(
        null,
        null,
        null,
        null,
        createDbSetup(),
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result).not.toContain('# === Jira ===');
      expect(result).not.toContain('# === Git ===');
      expect(result).not.toContain('# === GitHub ===');
      expect(result).not.toContain('# === Jira CSV ===');
    });
  });

  describe('no sources provided', () => {
    it('returns only the Argustack DB block and OpenAI comment', () => {
      const result = generateEnv(null, null, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain('# === Argustack internal PostgreSQL (match docker-compose.yml) ===');
      expect(result).toContain('# === OpenAI embeddings (optional, for semantic search) ===');
    });

    it('does not include any source sections', () => {
      const result = generateEnv(null, null, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).not.toContain('# === Jira ===');
      expect(result).not.toContain('# === Git ===');
      expect(result).not.toContain('# === GitHub ===');
      expect(result).not.toContain('# === Jira CSV ===');
      expect(result).not.toContain('# === Target Database (project DB to analyze) ===');
    });
  });

  describe('multiple Git repos', () => {
    it('joins repo paths with a comma in GIT_REPO_PATHS', () => {
      const git = createGitSetup({ gitRepoPaths: ['/repos/alpha', '/repos/beta', '/repos/gamma'] });

      const result = generateEnv(null, git, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain('GIT_REPO_PATHS=/repos/alpha,/repos/beta,/repos/gamma');
    });

    it('handles a single repo path without a trailing comma', () => {
      const git = createGitSetup({ gitRepoPaths: ['/repos/only'] });

      const result = generateEnv(null, git, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain('GIT_REPO_PATHS=/repos/only');
      expect(result).not.toContain('GIT_REPO_PATHS=/repos/only,');
    });
  });

  describe('multiple Jira projects', () => {
    it('joins project keys with a comma in JIRA_PROJECTS', () => {
      const jira = createJiraSetup({ jiraProjects: ['ALPHA', 'BETA', 'GAMMA'] });

      const result = generateEnv(jira, null, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain('JIRA_PROJECTS=ALPHA,BETA,GAMMA');
    });

    it('handles a single project key without a trailing comma', () => {
      const jira = createJiraSetup({ jiraProjects: ['SOLO'] });

      const result = generateEnv(jira, null, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain('JIRA_PROJECTS=SOLO');
      expect(result).not.toContain('JIRA_PROJECTS=SOLO,');
    });
  });

  describe('Argustack DB port', () => {
    it('writes the given port number to DB_PORT', () => {
      const result = generateEnv(null, null, null, null, null, 5999);

      expect(result).toContain('DB_PORT=5999');
    });

    it('uses the default port 5434 when passed as argument', () => {
      const result = generateEnv(null, null, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain('DB_PORT=5434');
    });

    it('always writes fixed Argustack DB credentials regardless of source setup', () => {
      const result = generateEnv(null, null, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain('DB_HOST=localhost');
      expect(result).toContain('DB_USER=argustack');
      expect(result).toContain('DB_PASSWORD=argustack_local');
      expect(result).toContain('DB_NAME=argustack');
    });
  });

  describe('OpenAI section', () => {
    it('always appends the commented-out OpenAI API key line', () => {
      const result = generateEnv(null, null, null, null, null, DEFAULT_ARGUSTACK_PORT);

      expect(result).toContain('# OPENAI_API_KEY=sk-...');
    });

    it('includes OpenAI section even when all sources are configured', () => {
      const result = generateEnv(
        createJiraSetup(),
        createGitSetup(),
        createGitHubSetup(),
        createCsvSetup(),
        createDbSetup(),
        DEFAULT_ARGUSTACK_PORT,
      );

      expect(result).toContain('# OPENAI_API_KEY=sk-...');
    });
  });
});
