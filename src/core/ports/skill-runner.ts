export interface ISkillRunner {
  execute(skillName: string, args: string[]): AsyncGenerator<string>;
  isAvailable(): Promise<boolean>;
  cancel(executionId: string): void;
}
