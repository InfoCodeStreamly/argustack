import { describe, it, expect } from 'vitest';

describe('cli/code registration', () => {
  it('registerCodeCommands is exported and registers a "code" subcommand', async () => {
    const { Command } = await import('commander');
    const { registerCodeCommands } = await import('../../../src/cli/code.js');
    const program = new Command();
    registerCodeCommands(program);
    const codeCmd = program.commands.find((c) => c.name() === 'code');
    expect(codeCmd).toBeDefined();
    const subNames = codeCmd?.commands.map((c) => c.name()) ?? [];
    expect(subNames).toContain('init');
    expect(subNames).toContain('register');
    expect(subNames).toContain('index');
    expect(subNames).toContain('list');
    expect(subNames).toContain('status');
    expect(subNames).toContain('watch');
  });
});
