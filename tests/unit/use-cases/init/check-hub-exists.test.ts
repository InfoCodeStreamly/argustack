/**
 * Unit tests for CheckHubExistsUseCase.
 *
 * Uses a temp directory + FakeWorkspaceStore to model the three
 * preconditions: compose file, config.env file, reachable hub DB.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CheckHubExistsUseCase } from '../../../../src/use-cases/init/check-hub-exists.js';
import { FakeWorkspaceStore } from '../../../fixtures/fakes/fake-workspace-store.js';

function seedComposeAndConfig(hubDir: string): void {
  mkdirSync(hubDir, { recursive: true });
  writeFileSync(join(hubDir, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(hubDir, 'config.env'), 'DB_PORT=15432\n');
}

describe('CheckHubExistsUseCase', () => {
  let tempDir: string;
  let hubDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'argustack-init-test-'));
    hubDir = join(tempDir, 'hub');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns exists=true when compose, config and DB are all healthy', async () => {
    seedComposeAndConfig(hubDir);
    const store = new FakeWorkspaceStore();
    const useCase = new CheckHubExistsUseCase(hubDir, store);

    const result = await useCase.execute();

    expect(result).toEqual({ exists: true });
  });

  it('returns no-compose when docker-compose.yml is missing', async () => {
    mkdirSync(hubDir, { recursive: true });
    const useCase = new CheckHubExistsUseCase(hubDir, new FakeWorkspaceStore());

    const result = await useCase.execute();

    expect(result).toEqual({ exists: false, reason: 'no-compose' });
  });

  it('returns no-config-env when config.env is missing', async () => {
    mkdirSync(hubDir, { recursive: true });
    writeFileSync(join(hubDir, 'docker-compose.yml'), 'services: {}\n');
    const useCase = new CheckHubExistsUseCase(hubDir, new FakeWorkspaceStore());

    const result = await useCase.execute();

    expect(result).toEqual({ exists: false, reason: 'no-config-env' });
  });

  it('returns db-unreachable when hubStore is null', async () => {
    seedComposeAndConfig(hubDir);
    const useCase = new CheckHubExistsUseCase(hubDir, null);

    const result = await useCase.execute();

    expect(result).toEqual({ exists: false, reason: 'db-unreachable' });
  });

  it('returns db-unreachable when list() throws', async () => {
    seedComposeAndConfig(hubDir);
    const store = new FakeWorkspaceStore();
    store.list = async (): Promise<never> => {
      await Promise.resolve();
      throw new Error('connection refused');
    };
    const useCase = new CheckHubExistsUseCase(hubDir, store);

    const result = await useCase.execute();

    expect(result).toEqual({ exists: false, reason: 'db-unreachable' });
  });
});
