import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LlmSetupPlan } from '../../core/types/init.js';
import { hubConfigPath } from '../../workspace/hub-config.js';
import type { HubPorts } from './resolve-hub-ports.js';

export interface WriteConfigEnvInput {
  readonly llm?: LlmSetupPlan;
  readonly ports?: HubPorts;
  /** Override path — defaults to hubConfigPath(). Used in tests. */
  readonly targetPath?: string;
}

export type WriteConfigEnvResult =
  | { ok: true; wrote: 'created' | 'updated'; path: string }
  | { ok: false; reason: 'permission' | 'no-space' | 'unknown'; details: string };

/**
 * Atomically write `~/.argustack/config.env` so a partially-written
 * file never lands on disk: temp file → rename → chmod 600.
 *
 * Two managed sections are kept in sync with init choices:
 *   - HUB PORTS — DB_PORT, NEO4J_URI, QDRANT_URL
 *   - CODE EMBEDDING PROVIDER — provider/url/model/dims
 *
 * Both sections are bracketed with marker comments so we can rewrite
 * them without disturbing user-edited values elsewhere.
 */
export class WriteConfigEnvUseCase {
  execute(input: WriteConfigEnvInput): WriteConfigEnvResult {
    const path = input.targetPath ?? hubConfigPath();
    const tmpPath = `${path}.tmp`;
    const wrote: 'created' | 'updated' = existsSync(path) ? 'updated' : 'created';

    try {
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const content = renderConfigEnv(input, path);
      writeFileSync(tmpPath, content);
      renameSync(tmpPath, path);
      try { chmodSync(path, 0o600); } catch { /* best-effort */ }
      return { ok: true, wrote, path };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      const reason = lower.includes('permission') || lower.includes('eacces')
        ? 'permission' as const
        : lower.includes('no space') || lower.includes('enospc')
          ? 'no-space' as const
          : 'unknown' as const;
      return { ok: false, reason, details: msg };
    }
  }
}

function renderConfigEnv(input: WriteConfigEnvInput, existingPath: string): string {
  const existing = existsSync(existingPath) ? readFileSync(existingPath, 'utf-8') : '';
  let working = existing;
  if (input.ports) {
    working = replaceManagedBlock(working, PORTS_START, PORTS_END, renderPortsBlock(input.ports));
  }
  working = replaceManagedBlock(
    working,
    LLM_START,
    LLM_END,
    input.llm ? renderLlmBlock(input.llm) : renderLlmPlaceholder(),
  );
  return working.trimEnd() + '\n';
}

const PORTS_START = '# === BEGIN: hub ports (managed by argustack init) ===';
const PORTS_END = '# === END: hub ports ===';
const LLM_START = '# === BEGIN: code embedding provider (managed by argustack init) ===';
const LLM_END = '# === END: code embedding provider ===';

function replaceManagedBlock(content: string, startMark: string, endMark: string, replacement: string): string {
  const startIdx = content.indexOf(startMark);
  if (startIdx === -1) {
    const trimmed = content.trimEnd();
    return (trimmed.length > 0 ? trimmed + '\n\n' : '') + replacement + '\n';
  }
  const endIdx = content.indexOf(endMark, startIdx);
  if (endIdx === -1) {
    return content.slice(0, startIdx) + replacement;
  }
  return content.slice(0, startIdx) + replacement + content.slice(endIdx + endMark.length);
}

function renderPortsBlock(ports: HubPorts): string {
  return [
    PORTS_START,
    `DB_PORT=${String(ports.pg)}`,
    `PGWEB_PORT=${String(ports.pgweb)}`,
    `NEO4J_URI=bolt://localhost:${String(ports.neo4jBolt)}`,
    `NEO4J_HTTP_URL=http://localhost:${String(ports.neo4jHttp)}`,
    `QDRANT_URL=http://localhost:${String(ports.qdrantRest)}`,
    `QDRANT_GRPC_PORT=${String(ports.qdrantGrpc)}`,
    PORTS_END,
  ].join('\n');
}

function renderLlmBlock(plan: LlmSetupPlan): string {
  const lines = [LLM_START];
  switch (plan.provider) {
    case 'ollama':
      lines.push('CODE_EMBEDDING_PROVIDER=ollama');
      lines.push(`OLLAMA_URL=${plan.url}`);
      break;
    case 'custom':
      lines.push('CODE_EMBEDDING_PROVIDER=custom');
      lines.push(`CUSTOM_EMBEDDING_URL=${plan.url}`);
      break;
    default:
      break;
  }
  lines.push(`EMBEDDING_MODEL=${plan.model}`);
  lines.push(`EMBEDDING_DIMS=${String(plan.dimensions)}`);
  lines.push(LLM_END);
  return lines.join('\n');
}

function renderLlmPlaceholder(): string {
  return [
    LLM_START,
    '# Configure later with: argustack init',
    '# CODE_EMBEDDING_PROVIDER=ollama',
    '# OLLAMA_URL=http://localhost:11434',
    '# EMBEDDING_MODEL=nomic-embed-text',
    '# EMBEDDING_DIMS=768',
    LLM_END,
  ].join('\n');
}
