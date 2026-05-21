import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import type { IPlatformProbe } from '../../core/ports/platform-probe.js';
import type {
  IOllamaControl,
  OllamaModel,
  InstallResult,
  PullResult,
  ProbeResult,
} from '../../core/ports/ollama-control.js';

const DEFAULT_URL = 'http://localhost:11434';
const HEALTH_PROBE_TIMEOUT_MS = 2000;
const PULL_PROGRESS_INTERVAL_MS = 500;

export interface HttpOllamaControlOptions {
  readonly url?: string;
  readonly serveLogPath?: string;
}

export class HttpOllamaControl implements IOllamaControl {
  readonly name = 'HttpOllamaControl';
  private readonly baseUrl: string;
  private readonly serveLogPath: string | null;

  constructor(private readonly platform: IPlatformProbe, options: HttpOllamaControlOptions = {}) {
    this.baseUrl = (options.url ?? DEFAULT_URL).replace(/\/$/, '');
    this.serveLogPath = options.serveLogPath ?? null;
  }

  isInstalled(): Promise<boolean> {
    return this.platform.hasCommand('ollama');
  }

  async isRunning(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); }, HEALTH_PROBE_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }

  async version(): Promise<string | null> {
    const result = await this.platform.runCommand('ollama', ['--version']);
    if (result.code !== 0) {
      return null;
    }
    return result.stdout.trim() || null;
  }

  async installViaBrew(): Promise<InstallResult> {
    const has = await this.platform.hasCommand('brew');
    if (!has) {
      return { ok: false, kind: 'no-brew', details: 'brew not installed' };
    }
    const result = await this.platform.runCommand('brew', ['install', 'ollama']);
    if (result.code === 0) {
      return { ok: true };
    }
    return classifyInstallError(result.stderr);
  }

  async installViaCurl(): Promise<InstallResult> {
    const has = await this.platform.hasCommand('curl');
    if (!has) {
      return { ok: false, kind: 'no-curl', details: 'curl not installed' };
    }
    const result = await this.platform.runCommand('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh']);
    if (result.code === 0) {
      return { ok: true };
    }
    return classifyInstallError(result.stderr);
  }

  async startInBackground(): Promise<void> {
    const stdio: ('ignore' | number)[] = ['ignore', 'ignore', 'ignore'];
    if (this.serveLogPath) {
      try {
        const fh = await open(this.serveLogPath, 'a');
        stdio[1] = fh.fd;
        stdio[2] = fh.fd;
      } catch {
        /* fall back to ignore */
      }
    }
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio,
    });
    child.unref();
  }

  async waitHealthy(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isRunning()) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as { models?: { name: string; size?: number }[] };
      return (data.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size ?? 0 }));
    } catch {
      return [];
    }
  }

  async pullModel(name: string, onProgress?: (pct: number, status: string) => void): Promise<PullResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
      });
      if (!response.ok) {
        return { ok: false, kind: 'hub-down', details: `HTTP ${String(response.status)}` };
      }
      if (!response.body) {
        return { ok: false, kind: 'unknown', details: 'no response body' };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastProgressEmit = Date.now();
      let lastStatus = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) { break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim().length === 0) { continue; }
          const event = parseJsonSafe(line);
          if (!event) { continue; }
          lastStatus = typeof event['status'] === 'string' ? event['status'] : lastStatus;
          if (typeof event['error'] === 'string') {
            return classifyPullError(event['error']);
          }
          const completed = Number(event['completed'] ?? 0);
          const total = Number(event['total'] ?? 0);
          const now = Date.now();
          if (onProgress && total > 0 && now - lastProgressEmit > PULL_PROGRESS_INTERVAL_MS) {
            lastProgressEmit = now;
            onProgress(Math.min(100, Math.round((completed / total) * 100)), lastStatus);
          }
        }
      }
      onProgress?.(100, lastStatus || 'done');
      return { ok: true };
    } catch (err) {
      return { ok: false, kind: 'no-internet', details: err instanceof Error ? err.message : String(err) };
    }
  }

  async probeEmbedding(model: string, text: string, url?: string): Promise<ProbeResult> {
    const target = (url ?? this.baseUrl).replace(/\/$/, '');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); }, 15000);
      const response = await fetch(`${target}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const body = await response.text();
        const lowered = body.toLowerCase();
        if (response.status === 404 || lowered.includes('model') && lowered.includes('not found')) {
          return { ok: false, kind: 'model-not-found', details: body };
        }
        return { ok: false, kind: 'no-response', details: `HTTP ${String(response.status)}: ${body}` };
      }
      const data = await response.json() as { embedding?: unknown };
      const embedding = data.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        return { ok: false, kind: 'wrong-format', details: 'response.embedding missing or empty' };
      }
      if (!embedding.every((v): v is number => typeof v === 'number')) {
        return { ok: false, kind: 'wrong-format', details: 'response.embedding contains non-numbers' };
      }
      return { ok: true, dims: embedding.length };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        kind: isAbort ? 'timeout' : 'no-response',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function parseJsonSafe(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function classifyInstallError(stderr: string): InstallResult {
  const lower = stderr.toLowerCase();
  if (lower.includes('permission denied') || lower.includes('sudo')) {
    return { ok: false, kind: 'permission', details: stderr.trim() };
  }
  if (lower.includes('could not resolve') || lower.includes('network') || lower.includes('timed out')) {
    return { ok: false, kind: 'no-internet', details: stderr.trim() };
  }
  return { ok: false, kind: 'unknown', details: stderr.trim() };
}

function classifyPullError(message: string): PullResult {
  const lower = message.toLowerCase();
  if (lower.includes('no space')) {
    return { ok: false, kind: 'no-space', details: message };
  }
  if (lower.includes('connection') || lower.includes('network') || lower.includes('dial')) {
    return { ok: false, kind: 'no-internet', details: message };
  }
  return { ok: false, kind: 'hub-down', details: message };
}
