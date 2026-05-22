/**
 * Unit tests for cli/init/presenter — pure console-printing helpers.
 * chalk is stubbed to passthrough, so we can assert on the raw text.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import type { PortInUse } from '../../../../src/core/ports/platform-probe.js';
import type { CheckVersionsFailure } from '../../../../src/use-cases/init/check-versions.js';

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  const tagged = Object.assign(id, {
    red: id, green: Object.assign(id, { bold: id }), yellow: id,
    blue: id, dim: id, cyan: id,
    bold: Object.assign(id, { green: id }),
  });
  return { default: tagged };
});

import {
  printHeader,
  printVersionFailure,
  printDockerNotRunning,
  printDockerTimeout,
  printPortConflict,
  printBootstrapFailure,
  printNoInteractiveMissingName,
  printSlugError,
  printOllamaInstallFailed,
  printOllamaWindowsLink,
  printOllamaTimeout,
  printPullFailed,
  printProbeError,
  printWriteConfigFailed,
  printDone,
  printStaleActiveCleared,
  printWorkspaceList,
  printSwitchedTo,
  printLlmHealthyAtReinit,
  printPortPlan,
  printPortsAborted,
} from '../../../../src/cli/init/presenter.js';

let logSpy: MockInstance<(typeof console)['log']>;

beforeEach(() => {
  vi.restoreAllMocks();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
});

function joined(): string {
  return logSpy.mock.calls.flat().map(String).join(' ');
}

describe('presenter', () => {
  it('printHeader prints the Argustack title', () => {
    printHeader();
    expect(joined()).toContain('Argustack');
  });

  it('printVersionFailure handles node-too-old', () => {
    const f: CheckVersionsFailure = { kind: 'node-too-old', required: '20', current: '18' };
    printVersionFailure(f);
    expect(joined()).toContain('Node 20');
  });

  it('printVersionFailure handles docker-missing', () => {
    const f: CheckVersionsFailure = { kind: 'docker-missing' };
    printVersionFailure(f);
    expect(joined()).toContain('Docker not installed');
  });

  it('printVersionFailure handles docker-too-old', () => {
    const f: CheckVersionsFailure = { kind: 'docker-too-old', required: '24', current: '20' };
    printVersionFailure(f);
    expect(joined()).toContain('Docker 24');
  });

  it('printVersionFailure handles compose-v1', () => {
    const f: CheckVersionsFailure = { kind: 'compose-v1', current: '1.29' };
    printVersionFailure(f);
    expect(joined()).toContain('Docker Compose v2 required');
  });

  it('printDockerNotRunning prints the not-running banner', () => {
    printDockerNotRunning();
    expect(joined()).toContain('Docker is not running');
  });

  it('printDockerTimeout prints the timeout banner', () => {
    printDockerTimeout();
    expect(joined()).toContain('did not start within');
  });

  it('printPortConflict lists each conflicting port with process info', () => {
    const conflicts: PortInUse[] = [
      { free: false, port: 5432, processName: 'postgres', pid: 999 },
    ];
    printPortConflict(conflicts);
    const msg = joined();
    expect(msg).toContain('5432');
    expect(msg).toContain('postgres');
    expect(msg).toContain('999');
  });

  it('printBootstrapFailure includes stage and trimmed details', () => {
    printBootstrapFailure('compose-up', 'line1\nline2\nline3\nline4\nline5\nline6');
    const msg = joined();
    expect(msg).toContain('compose-up');
    expect(msg).toContain('line1');
  });

  it('printSlugError prints the slug guidance', () => {
    printSlugError();
    expect(joined()).toContain('Invalid name');
  });

  it('printNoInteractiveMissingName prints the requirement', () => {
    printNoInteractiveMissingName();
    expect(joined()).toContain('--no-interactive');
  });

  it('printOllamaInstallFailed includes the truncated stderr', () => {
    printOllamaInstallFailed('error 1\nerror 2');
    expect(joined()).toContain('Failed to install Ollama');
  });

  it('printOllamaWindowsLink prints the windows URL', () => {
    printOllamaWindowsLink();
    expect(joined()).toContain('https://ollama.com/download/windows');
  });

  it('printOllamaTimeout prints the timeout message', () => {
    printOllamaTimeout();
    expect(joined()).toContain('did not become healthy');
  });

  it('printPullFailed includes the kind and retry hint', () => {
    printPullFailed('network', 'no route');
    expect(joined()).toContain('network');
    expect(joined()).toContain('ollama pull');
  });

  it('printProbeError handles each ProbeError kind', () => {
    printProbeError('no-response', 'fetch failed');
    expect(joined()).toContain('LLM server did not respond');
    logSpy.mockClear();
    printProbeError('wrong-format', '');
    expect(joined()).toContain('not an embedding vector');
    logSpy.mockClear();
    printProbeError('model-not-found', '');
    expect(joined()).toContain('Model not found');
    logSpy.mockClear();
    printProbeError('timeout', '');
    expect(joined()).toContain('timed out');
  });

  it('printWriteConfigFailed shows the path and details', () => {
    printWriteConfigFailed('EACCES');
    const msg = joined();
    expect(msg).toContain('Cannot write');
    expect(msg).toContain('EACCES');
  });

  it('printDone shows the workspace name and LLM status (with LLM)', () => {
    printDone('my-ws', true);
    const msg = joined();
    expect(msg).toContain('my-ws');
    expect(msg).toContain('configured');
  });

  it('printDone shows the workspace name and LLM status (without LLM)', () => {
    printDone('my-ws', false);
    expect(joined()).toContain('not configured');
  });

  it('printStaleActiveCleared mentions the stale id', () => {
    printStaleActiveCleared('ghost');
    expect(joined()).toContain('ghost');
  });

  it('printWorkspaceList prints names when present', () => {
    printWorkspaceList(['a', 'b']);
    expect(joined()).toContain('a, b');
  });

  it('printWorkspaceList prints nothing when list is empty', () => {
    printWorkspaceList([]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('printSwitchedTo mentions the existing workspace name', () => {
    printSwitchedTo('existing');
    expect(joined()).toContain('existing');
  });

  it('printLlmHealthyAtReinit mentions the model', () => {
    printLlmHealthyAtReinit('qwen-embed');
    expect(joined()).toContain('qwen-embed');
  });

  it('printPortPlan prints each port line', () => {
    const pgPort = 5432 + 10000;
    const qdrantPort = 5999 + 10000;
    printPortPlan([
      { label: 'pg', port: pgPort, fromDefault: true },
      { label: 'qdrant', port: qdrantPort, fromDefault: false },
    ]);
    const msg = joined();
    expect(msg).toContain(String(pgPort));
    expect(msg).toContain(String(qdrantPort));
    expect(msg).toContain('(custom)');
  });

  it('printPortsAborted prints the abort banner', () => {
    printPortsAborted();
    expect(joined()).toContain('Init aborted');
  });
});
