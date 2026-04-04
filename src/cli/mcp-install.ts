import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { findWorkspaceRoot } from '../workspace/resolver.js';

interface McpServerEntry {
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
}

interface ClaudeClient {
  readonly name: 'Claude Code' | 'Claude Desktop';
  readonly configPath: string;
  readonly installed: boolean;
  readonly argustackConfigured: boolean;
}

export function getClaudeCodeConfigPath(): string {
  return join(homedir(), '.claude.json');
}

function getClaudeDesktopConfigPath(): string {
  return join(
    homedir(),
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json',
  );
}

/**
 * Resolve absolute path to `dist/mcp/server.js`.
 *
 * Works whether running from source (tsx) or compiled (dist/).
 * Uses import.meta.url to find our own location, then walks to package root.
 */
export function resolveServerPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(currentFile), '..', '..');
  const serverPath = join(packageRoot, 'dist', 'mcp', 'server.js');

  if (!existsSync(serverPath)) {
    throw new Error(
      `MCP server not found at ${serverPath}. Run: npm run build`,
    );
  }

  return serverPath;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function writeJsonFile(
  filePath: string,
  data: Record<string, unknown>,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function detectClaudeClients(): ClaudeClient[] {
  const clients: ClaudeClient[] = [];

  const codeConfigPath = getClaudeCodeConfigPath();
  const codeDir = dirname(codeConfigPath);
  const codeInstalled = existsSync(codeDir);
  let codeConfigured = false;
  if (codeInstalled && existsSync(codeConfigPath)) {
    const config = readJsonFile(codeConfigPath);
    const servers = config['mcpServers'] as Record<string, unknown> | undefined;
    codeConfigured = servers !== undefined && 'argustack' in servers;
  }
  clients.push({
    name: 'Claude Code',
    configPath: codeConfigPath,
    installed: codeInstalled,
    argustackConfigured: codeConfigured,
  });

  const desktopConfigPath = getClaudeDesktopConfigPath();
  const desktopDir = dirname(desktopConfigPath);
  const desktopInstalled = existsSync(desktopDir);
  let desktopConfigured = false;
  if (desktopInstalled && existsSync(desktopConfigPath)) {
    const config = readJsonFile(desktopConfigPath);
    const servers = config['mcpServers'] as Record<string, unknown> | undefined;
    desktopConfigured = servers !== undefined && 'argustack' in servers;
  }
  clients.push({
    name: 'Claude Desktop',
    configPath: desktopConfigPath,
    installed: desktopInstalled,
    argustackConfigured: desktopConfigured,
  });

  return clients;
}

export function installIntoConfig(
  configPath: string,
  entry: McpServerEntry,
): void {
  const config = readJsonFile(configPath);

  if (!config['mcpServers'] || typeof config['mcpServers'] !== 'object') {
    config['mcpServers'] = {};
  }

  const servers = config['mcpServers'] as Record<string, unknown>;
  servers['argustack'] = entry;

  writeJsonFile(configPath, config);
}

function uninstallFromConfig(configPath: string): boolean {
  if (!existsSync(configPath)) {
    return false;
  }

  const config = readJsonFile(configPath);
  const servers = config['mcpServers'] as Record<string, unknown> | undefined;

  if (!servers || !('argustack' in servers)) {
    return false;
  }

  delete servers['argustack'];
  writeJsonFile(configPath, config);
  return true;
}

export function buildMcpEntry(
  serverPath: string,
  workspacePath: string,
): McpServerEntry {
  return {
    command: 'node',
    args: [serverPath],
    env: {
      ARGUSTACK_WORKSPACE: workspacePath,
    },
  };
}

export function registerMcpCommands(mcpCmd: Command): void {
  mcpCmd
    .command('install')
    .description('Configure Claude Code / Claude Desktop to use Argustack MCP')
    .option(
      '-w, --workspace <path>',
      'Workspace directory (default: auto-detect from cwd)',
    )
    .action((options: { workspace?: string }) => {
      try {
        const workspacePath = options.workspace
          ? resolve(options.workspace)
          : findWorkspaceRoot();

        if (!workspacePath) {
          console.log(chalk.red('\n  No Argustack workspace found.'));
          console.log(
            chalk.dim('  Run from a workspace, or specify: --workspace <path>'),
          );
          console.log(
            chalk.dim('  Create one: argustack init'),
          );
          process.exit(1);
        }

        const serverPath = resolveServerPath();

        const clients = detectClaudeClients();
        const installedClients = clients.filter((c) => c.installed);

        if (installedClients.length === 0) {
          console.log(chalk.red('\n  No Claude clients found.'));
          console.log(chalk.dim('  Install Claude Code or Claude Desktop first.'));
          process.exit(1);
        }

        console.log('');
        console.log(chalk.bold('  Argustack MCP — install'));
        console.log('');
        console.log(chalk.dim(`  Workspace: ${workspacePath}`));
        console.log(chalk.dim(`  Server:    ${serverPath}`));
        console.log('');

        const entry = buildMcpEntry(serverPath, workspacePath);

        for (const client of installedClients) {
          installIntoConfig(client.configPath, entry);
          console.log(
            `  ${chalk.green('✓')} ${chalk.bold(client.name)}  ${chalk.dim(client.configPath)}`,
          );
        }

        console.log('');
        console.log(chalk.dim('  Restart Claude to activate.'));
        console.log('');
      } catch (err: unknown) {
        console.error(
          chalk.red(
            `\n  Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    });

  mcpCmd
    .command('uninstall')
    .description('Remove Argustack from Claude MCP configuration')
    .action(() => {
      try {
        console.log('');
        console.log(chalk.bold('  Argustack MCP — uninstall'));
        console.log('');

        const clients = detectClaudeClients();
        let removedAny = false;

        for (const client of clients) {
          if (!client.installed) {
            continue;
          }

          const removed = uninstallFromConfig(client.configPath);
          if (removed) {
            console.log(`  ${chalk.green('✓')} Removed from ${chalk.bold(client.name)}`);
            removedAny = true;
          } else {
            console.log(`  ${chalk.dim('—')} ${chalk.dim(client.name)} — not configured`);
          }
        }

        console.log('');

        if (removedAny) {
          console.log(chalk.dim('  Restart Claude to apply changes.'));
        } else {
          console.log(chalk.dim('  Nothing to remove.'));
        }

        console.log('');
      } catch (err: unknown) {
        console.error(
          chalk.red(
            `\n  Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    });
}
