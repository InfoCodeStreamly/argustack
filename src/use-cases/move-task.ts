import type { IBoardStore } from '../core/ports/board-store.js';
import type { ISkillRunner } from '../core/ports/skill-runner.js';
import { BoardTaskEntity } from '../core/board/board-task.entity.js';
import { Pipeline } from '../core/board/pipeline.value-object.js';

export interface MoveTaskInput {
  taskId: string;
  targetColumn: string;
}

export interface MoveTaskOutput {
  task: ReturnType<BoardTaskEntity['toData']>;
  skillTriggered: boolean;
}

export class MoveTaskUseCase {
  constructor(
    private readonly store: IBoardStore,
    private readonly skillRunner: ISkillRunner,
  ) {}

  async execute(
    input: MoveTaskInput,
    onSkillOutput?: (chunk: string) => void,
  ): Promise<MoveTaskOutput> {
    const tasks = await this.store.getAllTasks();
    const taskData = tasks.find((t) => t.id === input.taskId);
    if (!taskData) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    const pipelineConfig = await this.store.loadPipeline();
    const pipeline = Pipeline.fromConfig(pipelineConfig, []);

    const targetCol = pipeline.findColumn(input.targetColumn);
    if (!targetCol) {
      throw new Error(`Column not found: ${input.targetColumn}`);
    }

    const entity = BoardTaskEntity.create(taskData);
    const moved = entity.moveTo(targetCol, pipeline);

    await this.store.updateTask(moved.id, {
      column: moved.column,
    });

    let skillTriggered = false;

    if (targetCol.isSkill()) {
      const available = await this.skillRunner.isAvailable();
      if (available) {
        skillTriggered = true;
        const skillName = targetCol.skillName() ?? targetCol.name;
        const generator = this.skillRunner.execute(skillName, [moved.toData().mdPath]);
        for await (const chunk of generator) {
          onSkillOutput?.(chunk);
        }
      }
    }

    return {
      task: moved.toData(),
      skillTriggered,
    };
  }
}
