/**
 * Unit tests for cli/init/prompts — interactive @inquirer wrappers.
 * The @inquirer/prompts module is mocked so the prompts return
 * deterministic values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

import { confirm, input, select } from '@inquirer/prompts';

const mockConfirm = vi.mocked(confirm);
const mockInput = vi.mocked(input);
const mockSelect = vi.mocked(select);

import {
  promptWaitForDocker,
  promptWorkspaceName,
  promptConfigureCode,
  promptOwnLlm,
  promptOwnLlmUrlAndModel,
  promptProbeRetry,
  promptDimsRecreate,
  promptReconfigureBrokenLlm,
  promptPortChoice,
} from '../../../../src/cli/init/prompts.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('prompts', () => {
  it('promptWaitForDocker delegates to confirm with default=true', async () => {
    mockConfirm.mockResolvedValueOnce(true);
    const result = await promptWaitForDocker();
    expect(result).toBe(true);
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ default: true }));
  });

  it('promptWorkspaceName lists existing workspaces in the message', async () => {
    mockInput.mockResolvedValueOnce('new-ws');
    const result = await promptWorkspaceName(['alpha', 'beta']);
    expect(result).toBe('new-ws');
    const call = mockInput.mock.calls[0]?.[0] as { message: string };
    expect(call.message).toContain('alpha, beta');
  });

  it('promptWorkspaceName validates slug pattern', async () => {
    mockInput.mockResolvedValueOnce('ok');
    await promptWorkspaceName([]);
    const validate = (mockInput.mock.calls[0]?.[0] as { validate: (s: string) => string | true }).validate;
    expect(validate('')).toBe('Required');
    expect(validate('Bad!Name')).toBe('Only a-z, 0-9, dashes allowed');
    expect(validate('a'.repeat(65))).toBe('Max 64 chars');
    expect(validate('valid-1')).toBe(true);
  });

  it('promptConfigureCode defaults to true', async () => {
    mockConfirm.mockResolvedValueOnce(true);
    await promptConfigureCode();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ default: true }));
  });

  it('promptOwnLlm defaults to false', async () => {
    mockConfirm.mockResolvedValueOnce(false);
    await promptOwnLlm();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
  });

  it('promptOwnLlmUrlAndModel returns trimmed values and validates URL/model', async () => {
    mockInput.mockResolvedValueOnce('  http://localhost:1234  ');
    mockInput.mockResolvedValueOnce('  nomic-embed-text  ');
    const result = await promptOwnLlmUrlAndModel();
    expect(result).toEqual({ url: 'http://localhost:1234', model: 'nomic-embed-text' });

    const urlValidate = (mockInput.mock.calls[0]?.[0] as { validate: (s: string) => string | true }).validate;
    expect(urlValidate('ftp://foo')).toBe('Must start with http(s)://');
    expect(urlValidate('https://ok')).toBe(true);

    const modelValidate = (mockInput.mock.calls[1]?.[0] as { validate: (s: string) => string | true }).validate;
    expect(modelValidate('')).toBe('Required');
    expect(modelValidate('m')).toBe(true);
  });

  it('promptProbeRetry returns selected choice', async () => {
    mockSelect.mockResolvedValueOnce('use-ollama');
    const result = await promptProbeRetry();
    expect(result).toBe('use-ollama');
  });

  it('promptDimsRecreate defaults to false (safer)', async () => {
    mockConfirm.mockResolvedValueOnce(false);
    await promptDimsRecreate(1024, 768);
    const call = mockConfirm.mock.calls[0]?.[0] as { default: boolean; message: string };
    expect(call.default).toBe(false);
    expect(call.message).toContain('1024');
    expect(call.message).toContain('768');
  });

  it('promptReconfigureBrokenLlm defaults to true', async () => {
    mockConfirm.mockResolvedValueOnce(true);
    await promptReconfigureBrokenLlm();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ default: true }));
  });

  describe('promptPortChoice', () => {
    it('returns accept-suggested when user picks the suggested port', async () => {
      mockSelect.mockResolvedValueOnce('accept-suggested');
      const r = await promptPortChoice('pg', 5432, 'postgres pid 1', 5433);
      expect(r).toEqual({ choice: 'accept-suggested' });
    });

    it('returns abort when user aborts', async () => {
      mockSelect.mockResolvedValueOnce('abort');
      const r = await promptPortChoice('pg', 5432, 'postgres pid 1', null);
      expect(r).toEqual({ choice: 'abort' });
    });

    it('prompts for custom port and validates 1024-65535', async () => {
      const customPort = 2345 + 10000;
      const aboveMax = 5000 + 65000;
      mockSelect.mockResolvedValueOnce('custom');
      mockInput.mockResolvedValueOnce(String(customPort));
      const r = await promptPortChoice('pg', 5432, 'conflict', 5433);
      expect(r).toEqual({ choice: 'custom', port: customPort });

      const validate = (mockInput.mock.calls[0]?.[0] as { validate: (s: string) => string | true }).validate;
      expect(validate('abc')).toBe('Must be integer 1024..65535');
      expect(validate('80')).toBe('Must be integer 1024..65535');
      expect(validate(String(aboveMax))).toBe('Must be integer 1024..65535');
      expect(validate('5000')).toBe(true);
    });

    it('omits accept-suggested choice when suggested is null', async () => {
      mockSelect.mockResolvedValueOnce('abort');
      await promptPortChoice('pg', 5432, 'conflict', null);
      const call = mockSelect.mock.calls[0]?.[0] as unknown as { choices: readonly { value: string }[] };
      const values = call.choices.map((c) => c.value);
      expect(values).not.toContain('accept-suggested');
    });
  });
});
