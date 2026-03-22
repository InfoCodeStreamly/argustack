import { spawn, type ChildProcess } from 'node:child_process';
import type { ISkillRunner } from '../../core/ports/skill-runner.js';

export class ClaudeSkillRunner implements ISkillRunner {
  private readonly processes = new Map<string, ChildProcess>();
  private executionCounter = 0;

  async *execute(skillName: string, args: string[]): AsyncGenerator<string> {
    const executionId = String(++this.executionCounter);
    const prompt = `/${skillName} ${args.join(' ')}`;

    const child = spawn('claude', ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.processes.set(executionId, child);

    try {
      const iterator = this.streamOutput(child, executionId);
      for await (const chunk of iterator) {
        yield chunk;
      }
    } finally {
      this.processes.delete(executionId);
    }
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.on('close', (code) => { resolve(code === 0); });
      child.on('error', () => { resolve(false); });
    });
  }

  cancel(executionId: string): void {
    const child = this.processes.get(executionId);
    if (child) {
      child.kill('SIGTERM');
      this.processes.delete(executionId);
    }
  }

  private async *streamOutput(child: ChildProcess, executionId: string): AsyncGenerator<string> {
    const stdout = child.stdout;
    const stderr = child.stderr;

    if (!stdout || !stderr) { return; }

    const chunks: string[] = [];
    const state = { done: false };

    stdout.setEncoding('utf-8');
    stderr.setEncoding('utf-8');

    stdout.on('data', (data: string) => { chunks.push(data); });
    stderr.on('data', (data: string) => { chunks.push(data); });

    child.on('close', () => { state.done = true; });
    child.on('error', () => { state.done = true; });

    while (!state.done || chunks.length > 0) {
      const chunk = chunks.shift();
      if (chunk !== undefined) {
        yield chunk;
      } else {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    this.processes.delete(executionId);
  }
}
