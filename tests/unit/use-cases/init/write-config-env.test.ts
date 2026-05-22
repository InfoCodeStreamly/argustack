/**
 * Unit tests for WriteConfigEnvUseCase.
 *
 * Uses the `targetPath` override so the use case operates on a temp file
 * instead of `~/.argustack/config.env`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { WriteConfigEnvUseCase } from '../../../../src/use-cases/init/write-config-env.js';
import type { HubPorts } from '../../../../src/use-cases/init/resolve-hub-ports.js';
import type { LlmSetupPlan } from '../../../../src/core/types/init.js';

const PORTS: HubPorts = {
  pg: 25432,
  pgweb: 25433,
  neo4jHttp: 25434,
  neo4jBolt: 25435,
  qdrantRest: 25436,
  qdrantGrpc: 25437,
};

const LLM: LlmSetupPlan = {
  provider: 'ollama',
  url: 'http://localhost:11434',
  model: 'nomic-embed-text',
  dimensions: 768,
};

describe('WriteConfigEnvUseCase', () => {
  let tempDir: string;
  let targetPath: string;
  let useCase: WriteConfigEnvUseCase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'argustack-write-config-'));
    targetPath = join(tempDir, 'config.env');
    useCase = new WriteConfigEnvUseCase();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a new config.env with managed port + LLM blocks', () => {
    const result = useCase.execute({ ports: PORTS, llm: LLM, targetPath });

    expect(result).toEqual({ ok: true, wrote: 'created', path: targetPath });
    expect(existsSync(targetPath)).toBe(true);
    const content = readFileSync(targetPath, 'utf-8');
    expect(content).toContain(`DB_PORT=${String(PORTS.pg)}`);
    expect(content).toContain(`QDRANT_URL=http://localhost:${String(PORTS.qdrantRest)}`);
    expect(content).toContain('CODE_EMBEDDING_PROVIDER=ollama');
    expect(content).toContain(`EMBEDDING_MODEL=${LLM.model}`);
  });

  it('reports wrote=updated when the target already exists', () => {
    writeFileSync(targetPath, 'EXISTING=true\n');

    const result = useCase.execute({ ports: PORTS, llm: LLM, targetPath });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.wrote).toBe('updated');
    expect(readFileSync(targetPath, 'utf-8')).toContain('EXISTING=true');
  });

  it('rewrites the managed block in place without disturbing user-edited values', () => {
    writeFileSync(
      targetPath,
      [
        'USER_VAR=keep-me',
        '# === BEGIN: hub ports (managed by argustack init) ===',
        'DB_PORT=99999',
        '# === END: hub ports ===',
        'ANOTHER=also-keep',
        '',
      ].join('\n'),
    );

    useCase.execute({ ports: PORTS, targetPath });

    const content = readFileSync(targetPath, 'utf-8');
    expect(content).toContain('USER_VAR=keep-me');
    expect(content).toContain('ANOTHER=also-keep');
    expect(content).toContain(`DB_PORT=${String(PORTS.pg)}`);
    expect(content).not.toContain('DB_PORT=99999');
  });

  it('returns a permission failure when the target directory is not writable (edge case)', () => {
    const badPath = '/this/path/should/not/exist/config.env';

    const result = useCase.execute({ ports: PORTS, llm: LLM, targetPath: badPath });

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(['permission', 'unknown']).toContain(result.reason);
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('writes a placeholder LLM block when no llm plan is provided', () => {
    const result = useCase.execute({ ports: PORTS, targetPath });

    expect(result.ok).toBe(true);
    const content = readFileSync(targetPath, 'utf-8');
    expect(content).toContain('# === BEGIN: code embedding provider (managed by argustack init) ===');
    expect(content).toContain('# Configure later with: argustack init');
  });
});
