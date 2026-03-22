import type { SkillExecutionData, SkillExecutionStatus } from '../types/board.js';

export class SkillExecutionEntity {
  readonly id: string;
  readonly taskId: string;
  readonly skillName: string;
  readonly status: SkillExecutionStatus;
  readonly output: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;

  private constructor(data: SkillExecutionData) {
    this.id = data.id;
    this.taskId = data.taskId;
    this.skillName = data.skillName;
    this.status = data.status;
    this.output = data.output;
    this.startedAt = data.startedAt;
    this.finishedAt = data.finishedAt ?? null;
  }

  static create(data: SkillExecutionData): SkillExecutionEntity {
    return new SkillExecutionEntity(data);
  }

  appendOutput(chunk: string): SkillExecutionEntity {
    return new SkillExecutionEntity({
      ...this.toData(),
      output: this.output + chunk,
    });
  }

  complete(): SkillExecutionEntity {
    return new SkillExecutionEntity({
      ...this.toData(),
      status: 'done',
      finishedAt: new Date().toISOString(),
    });
  }

  fail(error: string): SkillExecutionEntity {
    return new SkillExecutionEntity({
      ...this.toData(),
      status: 'error',
      output: this.output + '\n' + error,
      finishedAt: new Date().toISOString(),
    });
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  toData(): SkillExecutionData {
    return {
      id: this.id,
      taskId: this.taskId,
      skillName: this.skillName,
      status: this.status,
      output: this.output,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }
}
