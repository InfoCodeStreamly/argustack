import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { createEmptyConfig, addSource, writeConfig } from '../../workspace/config.js';
import { resolveServerPath } from '../mcp-install.js';
import type {
  JiraSetupResult,
  GitSetupResult,
  GitHubSetupResult,
  CsvSetupResult,
  DbSetupResult,
} from './types.js';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

function getTemplatesDir(): string {
  const templatesDir = resolve(currentDir, '..', '..', '..', 'templates');
  if (!existsSync(templatesDir)) {
    throw new Error(`Templates directory not found: ${templatesDir}`);
  }
  return templatesDir;
}

export function generateEnv(
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
  github: GitHubSetupResult | null,
  csv: CsvSetupResult | null,
  db: DbSetupResult | null,
  argustackDbPort: number,
): string {
  const lines: string[] = [];

  if (jira) {
    lines.push(
      '# === Jira ===',
      `JIRA_URL=${jira.jiraUrl}`,
      `JIRA_EMAIL=${jira.jiraEmail}`,
      `JIRA_API_TOKEN=${jira.jiraToken}`,
      `JIRA_PROJECTS=${jira.jiraProjects.join(',')}`,
      '',
    );
  }

  if (git) {
    lines.push(
      '# === Git ===',
      `GIT_REPO_PATHS=${git.gitRepoPaths.join(',')}`,
      '',
    );
  }

  if (github) {
    lines.push(
      '# === GitHub ===',
      `GITHUB_TOKEN=${github.githubToken}`,
      `GITHUB_OWNER=${github.githubOwner}`,
      `GITHUB_REPO=${github.githubRepo}`,
      '',
    );
  }

  if (csv) {
    lines.push(
      '# === Jira CSV ===',
      `CSV_FILE_PATH=${csv.csvFilePath}`,
      '',
    );
  }

  if (db) {
    lines.push(
      '# === Target Database (project DB to analyze) ===',
      `TARGET_DB_HOST=${db.targetDbHost}`,
      `TARGET_DB_PORT=${db.targetDbPort}`,
      `TARGET_DB_USER=${db.targetDbUser}`,
      `TARGET_DB_PASSWORD=${db.targetDbPassword}`,
      `TARGET_DB_NAME=${db.targetDbName}`,
      '',
    );
  }

  lines.push(
    '# === Argustack internal PostgreSQL (match docker-compose.yml) ===',
    'DB_HOST=localhost',
    `DB_PORT=${argustackDbPort}`,
    'DB_USER=argustack',
    'DB_PASSWORD=argustack_local',
    'DB_NAME=argustack',
    '',
    '# === OpenAI embeddings (optional, for semantic search) ===',
    '# OPENAI_API_KEY=sk-...',
  );

  return lines.join('\n') + '\n';
}

export function generateDockerCompose(dbPort: number, pgwebPort: number): string {
  return `services:
  db:
    image: pgvector/pgvector:pg16
    container_name: argustack-db
    ports:
      - "${dbPort}:5432"
    environment:
      POSTGRES_USER: argustack
      POSTGRES_PASSWORD: argustack_local
      POSTGRES_DB: argustack
    volumes:
      - argustack-data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U argustack"]
      interval: 2s
      timeout: 5s
      retries: 15

  pgweb:
    image: sosedoff/pgweb
    container_name: argustack-pgweb
    ports:
      - "${pgwebPort}:8081"
    environment:
      PGWEB_DATABASE_URL: postgres://argustack:argustack_local@db:5432/argustack?sslmode=disable
    depends_on:
      db:
        condition: service_healthy
    restart: on-failure

volumes:
  argustack-data:
`;
}

export function createWorkspaceFiles(
  workspaceDir: string,
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
  github: GitHubSetupResult | null,
  csv: CsvSetupResult | null,
  db: DbSetupResult | null,
  dbPort: number,
  pgwebPort: number,
): void {
  const templatesDir = getTemplatesDir();

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(workspaceDir, '.argustack'), { recursive: true });
  mkdirSync(join(workspaceDir, 'db'), { recursive: true });
  mkdirSync(join(workspaceDir, 'data'), { recursive: true });

  let config = createEmptyConfig();
  if (jira) {
    config = addSource(config, 'jira');
  }
  if (git) {
    config = addSource(config, 'git');
  }
  if (github) {
    config = addSource(config, 'github');
  }
  if (csv) {
    config = addSource(config, 'csv');
  }
  if (db) {
    config = addSource(config, 'db');
  }
  writeConfig(workspaceDir, config);

  writeFileSync(join(workspaceDir, '.env'), generateEnv(jira, git, github, csv, db, dbPort));

  writeFileSync(join(workspaceDir, 'docker-compose.yml'), generateDockerCompose(dbPort, pgwebPort));

  copyFileSync(join(templatesDir, 'init.sql'), join(workspaceDir, 'db', 'init.sql'));

  copyFileSync(join(templatesDir, 'gitignore'), join(workspaceDir, '.gitignore'));

  try {
    const serverPath = resolveServerPath();
    const mcpConfig = {
      mcpServers: {
        argustack: {
          command: 'node',
          args: [serverPath],
        },
      },
    };
    writeFileSync(
      join(workspaceDir, '.mcp.json'),
      JSON.stringify(mcpConfig, null, 2) + '\n',
    );
  } catch { /* optional file, ignore */ }
}

export function printSummary(
  workspaceDir: string,
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
  github: GitHubSetupResult | null,
  csv: CsvSetupResult | null,
  db: DbSetupResult | null,
  pgwebPort: number,
  willAutoStart: boolean,
): void {
  console.log('');
  console.log(chalk.green.bold('  Done! Your workspace is ready.'));
  console.log('');

  console.log(chalk.dim('  Sources configured:'));
  if (jira) {
    console.log(`    ${chalk.green('✓')} Jira — ${jira.jiraUrl}`);
  }
  if (git) {
    for (const p of git.gitRepoPaths) {
      console.log(`    ${chalk.green('✓')} Git — ${p}`);
    }
  }
  if (github) {
    console.log(`    ${chalk.green('✓')} GitHub — ${github.githubOwner}/${github.githubRepo}`);
  }
  if (csv) {
    console.log(`    ${chalk.green('✓')} Jira CSV — ${csv.csvFilePath}`);
  }
  if (db) {
    console.log(`    ${chalk.green('✓')} Database — ${db.targetDbHost}:${db.targetDbPort}`);
  }
  if (!jira && !git && !github && !csv && !db) {
    console.log(`    ${chalk.yellow('—')} None yet. Use ${chalk.cyan('argustack source add <type>')}`);
  }

  if (!willAutoStart) {
    console.log('');
    console.log(chalk.dim('  Next steps:'));
    console.log(`  ${chalk.cyan('cd')} ${workspaceDir}`);
    console.log(`  ${chalk.cyan('docker compose up -d')}          # start database`);
    if (jira) {
      console.log(`  ${chalk.cyan('argustack sync jira')}            # sync from Jira`);
    }
    console.log(`  ${chalk.cyan(`http://localhost:${pgwebPort}`)}            # browse data in pgweb`);

    console.log('');
    console.log(chalk.dim('  Claude integration:'));
    console.log(`    Claude Code:    ${chalk.green('Open this folder — MCP tools ready!')}`);
    console.log(`    Claude Desktop: ${chalk.cyan('argustack mcp install')}`);
  }

  console.log('');
}
