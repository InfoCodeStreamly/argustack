/**
 * Unit tests for ClearStaleActiveUseCase.
 *
 * The use-case reads/writes `<hubDir>/active-workspace.json` directly,
 * so tests stub `ARGUSTACK_HUB_DIR` to a temp dir to isolate the
 * filesystem side effect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ClearStaleActiveUseCase } from '../../../../src/use-cases/init/clear-stale-active.js';
import { FakeWorkspaceStore } from '../../../fixtures/fakes/fake-workspace-store.js';

const STALE_ID = 'stale-workspace';
const VALID_ID = 'valid-workspace';

function writeActivePointer(hubDir: string, workspaceId: string, name: string): void {
  mkdirSync(hubDir, { recursive: true });
  writeFileSync(
    join(hubDir, 'active-workspace.json'),
    `${JSON.stringify({ activeWorkspaceId: workspaceId, activeName: name, lastSwitched: new Date().toISOString() })}\n`,
  );
}

describe('ClearStaleActiveUseCase', () => {
  let tempDir: string;
  let hubDir: string;
  let store: FakeWorkspaceStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'argustack-clear-stale-'));
    hubDir = join(tempDir, 'hub');
    vi.stubEnv('ARGUSTACK_HUB_DIR', hubDir);
    store = new FakeWorkspaceStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns cleared=false / no-active when there is no active pointer', async () => {
    const useCase = new ClearStaleActiveUseCase(store);

    const result = await useCase.execute();

    expect(result).toEqual({ cleared: false, reason: 'no-active' });
  });

  it('returns cleared=false / still-valid when the workspace still exists', async () => {
    await store.create({ id: VALID_ID, name: VALID_ID });
    writeActivePointer(hubDir, VALID_ID, VALID_ID);
    const useCase = new ClearStaleActiveUseCase(store);

    const result = await useCase.execute();

    expect(result).toEqual({ cleared: false, reason: 'still-valid' });
    expect(existsSync(join(hubDir, 'active-workspace.json'))).toBe(true);
  });

  it('wipes the pointer and returns staleId when the workspace was removed', async () => {
    writeActivePointer(hubDir, STALE_ID, STALE_ID);
    const useCase = new ClearStaleActiveUseCase(store);

    const result = await useCase.execute();

    expect(result).toEqual({ cleared: true, staleId: STALE_ID });
    expect(existsSync(join(hubDir, 'active-workspace.json'))).toBe(false);
  });

  it('treats a malformed pointer file as no-active (edge case)', async () => {
    mkdirSync(hubDir, { recursive: true });
    writeFileSync(join(hubDir, 'active-workspace.json'), '{ not json');
    const useCase = new ClearStaleActiveUseCase(store);

    const result = await useCase.execute();

    expect(result).toEqual({ cleared: false, reason: 'no-active' });
    expect(readFileSync(join(hubDir, 'active-workspace.json'), 'utf-8')).toContain('not json');
  });
});
