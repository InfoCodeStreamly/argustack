import chalk from 'chalk';
import type { PortInUse } from '../../core/ports/platform-probe.js';
import type { CheckVersionsFailure } from '../../use-cases/init/check-versions.js';
import type { ProbeError } from '../../core/ports/ollama-control.js';

export function printHeader(): void {
  console.log('');
  console.log(chalk.bold('  Argustack — initialization'));
  console.log(chalk.dim('  One hub of containers + workspaces + optional code-intel.\n'));
}

export function printVersionFailure(f: CheckVersionsFailure): void {
  console.log('');
  switch (f.kind) {
    case 'node-too-old':
      console.log(chalk.red(`  Node ${f.required}+ required (you have ${f.current}).`));
      console.log(chalk.dim('  Install: brew install node  (macOS) or https://nodejs.org/'));
      break;
    case 'docker-missing':
      console.log(chalk.red('  Docker not installed.'));
      console.log(chalk.dim('  Recommended: https://orbstack.dev (lighter than Docker Desktop)'));
      console.log(chalk.dim('  Alternative: https://docker.com/get-started'));
      break;
    case 'docker-too-old':
      console.log(chalk.red(`  Docker ${f.required}+ required (you have ${f.current}).`));
      console.log(chalk.dim('  Update via Orbstack/Docker Desktop UI.'));
      break;
    case 'compose-v1':
      console.log(chalk.red(`  Docker Compose v2 required (you have ${f.current}).`));
      console.log(chalk.dim('  Update Docker Desktop / Orbstack — compose v2 is bundled.'));
      break;
    default:
      break;
  }
  console.log('');
}

export function printDockerNotRunning(): void {
  console.log('');
  console.log(chalk.yellow('  Docker is not running.'));
  console.log(chalk.dim('  Start it from /Applications (Docker.app / OrbStack.app).'));
  console.log(chalk.dim('  argustack init will poll every 5 sec for 10 min.\n'));
}

export function printDockerTimeout(): void {
  console.log('');
  console.log(chalk.red('  Docker did not start within 10 min.'));
  console.log(chalk.dim('  Open Docker / OrbStack manually and re-run `argustack init`.\n'));
}

export function printPortConflict(conflicts: readonly PortInUse[]): void {
  console.log('');
  console.log(chalk.red('  Required ports are in use:'));
  for (const c of conflicts) {
    console.log(`    port ${String(c.port)} — process "${c.processName}" (PID ${String(c.pid)})`);
  }
  console.log(chalk.dim('  Either stop those processes, or edit ~/.argustack/code/docker-compose.yml.\n'));
}

export function printBootstrapFailure(stage: string, details: string): void {
  console.log('');
  console.log(chalk.red(`  Bootstrap failed at stage "${stage}".`));
  console.log(chalk.dim(`  ${  details.split('\n').slice(0, 5).join('\n  ')}`));
  console.log('');
}

export function printNoInteractiveMissingName(): void {
  console.log('');
  console.log(chalk.red('  --no-interactive requires --name <workspace-name>.'));
  console.log('');
}

export function printSlugError(): void {
  console.log(chalk.red('  Invalid name. Use only a-z, 0-9, dashes. Example: my-project'));
}

export function printOllamaInstallFailed(details: string): void {
  console.log('');
  console.log(chalk.red('  Failed to install Ollama:'));
  console.log(chalk.dim(`  ${  details.split('\n').slice(0, 3).join('\n  ')}`));
  console.log(chalk.dim('  Manual: https://ollama.com/download'));
  console.log('');
}

export function printOllamaWindowsLink(): void {
  console.log('');
  console.log(chalk.yellow('  Ollama on Windows must be installed manually:'));
  console.log(chalk.cyan('  https://ollama.com/download/windows'));
  console.log('');
}

export function printOllamaTimeout(): void {
  console.log('');
  console.log(chalk.red('  Ollama did not become healthy after install.'));
  console.log(chalk.dim('  Start it manually: ollama serve'));
  console.log('');
}

export function printPullFailed(kind: string, details: string): void {
  console.log('');
  console.log(chalk.red(`  Failed to pull embedding model (${kind}).`));
  console.log(chalk.dim(`  ${  details.split('\n').slice(0, 3).join('\n  ')}`));
  console.log(chalk.dim('  Retry: ollama pull nomic-embed-text'));
  console.log('');
}

export function printProbeError(kind: ProbeError, details: string): void {
  const messages: Record<ProbeError, string> = {
    'no-response': 'LLM server did not respond. Check URL / firewall.',
    'wrong-format': 'LLM returned a response but not an embedding vector. Likely a chat model, not embedding.',
    'model-not-found': 'Model not found on the server.',
    'timeout': 'LLM probe timed out.',
  };
  console.log(chalk.red(`  Probe failed: ${messages[kind]}`));
  console.log(chalk.dim(`  ${  details.split('\n').slice(0, 3).join('\n  ')}`));
}

export function printWriteConfigFailed(details: string): void {
  console.log('');
  console.log(chalk.red('  Cannot write ~/.argustack/config.env.'));
  console.log(chalk.dim(`  ${  details}`));
  console.log('');
}

export function printDone(name: string, withLlm: boolean): void {
  console.log('');
  console.log(chalk.bold.green('  Init complete.'));
  console.log(chalk.dim(`  Active workspace: ${name}`));
  if (withLlm) {
    console.log(chalk.dim('  Code intelligence: configured (Ollama + nomic-embed-text).'));
  } else {
    console.log(chalk.dim('  Code intelligence: not configured. Re-run `argustack init` to set up.'));
  }
  console.log('');
  console.log(chalk.dim('  Next:'));
  console.log(chalk.cyan(`    argustack add code --workspace ${name} --root <path>`));
  console.log(chalk.cyan(`    argustack add jira --workspace ${name} --url ... --email ... --token ...`));
  console.log('');
}

export function printStaleActiveCleared(staleId: string): void {
  console.log(chalk.dim(`  Active workspace pointer pointed at "${staleId}" (deleted) — cleared.`));
}

export function printWorkspaceList(names: readonly string[]): void {
  if (names.length === 0) {
    return;
  }
  console.log(chalk.dim(`  Existing workspaces: ${names.join(', ')}`));
}

export function printSwitchedTo(name: string): void {
  console.log(chalk.dim(`  → switched to existing workspace "${name}"`));
}

export function printLlmHealthyAtReinit(model: string): void {
  console.log(chalk.dim(`  Code intelligence already configured (${model}). Skipping setup.`));
}

export interface PortPlanLine {
  readonly label: string;
  readonly port: number;
  readonly fromDefault: boolean;
}

export function printPortPlan(lines: readonly PortPlanLine[]): void {
  console.log('');
  console.log(chalk.bold('  Hub ports:'));
  for (const l of lines) {
    const note = l.fromDefault ? '' : chalk.yellow(' (custom)');
    console.log(`    ${l.label.padEnd(14)} ${String(l.port)}${note}`);
  }
  console.log('');
}

export function printPortsAborted(): void {
  console.log('');
  console.log(chalk.yellow('  Init aborted — pick free ports and try again.'));
  console.log('');
}
