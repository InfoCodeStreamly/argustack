import type { IBoardStore } from '../core/ports/board-store.js';
import type { BoardTaskData } from '../core/types/board.js';
import { Pipeline, type PipelineConfig } from '../core/board/pipeline.value-object.js';

export interface SyncBoardOutput {
  tasks: BoardTaskData[];
  pipeline: PipelineConfig;
}

export class SyncBoardUseCase {
  constructor(private readonly store: IBoardStore) {}

  async execute(
    tasksDir: string,
    availableSkills: string[],
  ): Promise<SyncBoardOutput> {
    await this.store.syncFromFiles(tasksDir);

    const pipelineConfig = await this.store.loadPipeline();
    const pipeline = Pipeline.fromConfig(pipelineConfig, availableSkills);

    const updatedConfig = pipeline.toConfig(pipelineConfig.port);
    await this.store.savePipeline(updatedConfig);

    const tasks = await this.store.getAllTasks();

    return {
      tasks,
      pipeline: updatedConfig,
    };
  }
}
