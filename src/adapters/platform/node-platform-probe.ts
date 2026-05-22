import { spawn } from 'node:child_process';
import type {
  IPlatformProbe,
  OsKind,
  PortStatus,
  CommandResult,
} from '../../core/ports/index.js';

const DEFAULT_LSOF_TIMEOUT_MS = 3000;

export class NodePlatformProbe implements IPlatformProbe {
  readonly name = 'NodePlatformProbe';

  detectOS(): OsKind {
    const platform: NodeJS.Platform = process.platform;
    if (platform === 'darwin') { return 'macos'; }
    if (platform === 'linux') { return 'linux'; }
    if (platform === 'win32') { return 'windows'; }
    return 'unknown';
  }

  async hasCommand(command: string): Promise<boolean> {
    const probe = this.detectOS() === 'windows' ? 'where' : 'which';
    const result = await this.runCommand(probe, [command]);
    return result.code === 0;
  }

  async checkPort(port: number): Promise<PortStatus> {
    const os = this.detectOS();
    if (os === 'windows') {
      return { free: true, port };
    }
    const result = await this.runCommand(
      'lsof',
      ['-nP', `-iTCP:${  String(port)}`, '-sTCP:LISTEN'],
      DEFAULT_LSOF_TIMEOUT_MS,
    );
    if (result.code !== 0 || result.stdout.trim().length === 0) {
      return { free: true, port };
    }
    const lines = result.stdout.trim().split('\n');
    const dataLine = lines.length > 1 ? lines[1] : undefined;
    if (dataLine === undefined || dataLine === '') {
      return { free: true, port };
    }
    const parts = dataLine.split(/\s+/);
    const processName = parts[0] ?? 'unknown';
    const pid = Number(parts[1] ?? '0');
    return {
      free: false,
      port,
      pid: Number.isFinite(pid) ? pid : 0,
      processName,
    };
  }

  async runCommand(command: string, args: readonly string[], timeoutMs?: number): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(command, [...args]);
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = timeoutMs !== undefined && timeoutMs > 0
        ? setTimeout(() => {
            if (!settled) {
              settled = true;
              try { child.kill('SIGKILL'); } catch { /* ignore */ }
              resolve({ stdout, stderr: `${stderr  }\n[timeout]`, code: 124 });
            }
          }, timeoutMs)
        : null;

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

      child.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          if (timeout !== null) { clearTimeout(timeout); }
          resolve({ stdout, stderr: `${stderr  }\n${  err.message}`, code: 127 });
        }
      });

      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          if (timeout !== null) { clearTimeout(timeout); }
          resolve({ stdout, stderr, code: code ?? 0 });
        }
      });
    });
  }
}
