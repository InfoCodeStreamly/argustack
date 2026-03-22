import type { ISkillRunner } from '../../../src/core/ports/skill-runner.js';

export class FakeSkillRunner implements ISkillRunner {
  readonly executedSkills: { name: string; args: string[] }[] = [];
  private _available = true;
  private _output = 'Skill executed successfully';

  setAvailable(available: boolean): void {
    this._available = available;
  }

  setOutput(output: string): void {
    this._output = output;
  }

  async *execute(skillName: string, args: string[]): AsyncGenerator<string> {
    this.executedSkills.push({ name: skillName, args });
    yield await Promise.resolve(this._output);
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this._available);
  }

  cancel(_executionId: string): void {
    /* no-op in fake */
  }
}
