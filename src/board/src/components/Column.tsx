import React from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { Card } from './Card.js';
import type { BoardTask, PipelineColumn } from '../types.js';
import type { DictionaryResult } from '../types/dictionary.types.js';

interface ColumnProps {
  column: PipelineColumn;
  tasks: BoardTask[];
  runningTasks: Map<string, string>;
  dict: DictionaryResult;
}

export function Column({ column, tasks, runningTasks, dict }: ColumnProps) {
  return (
    <div className={`column ${column.type === 'system' ? 'column--system' : 'column--skill'}`}>
      <div className="column__header">
        <h3 className="column__title">{column.displayName}</h3>
        <span className="column__count">{tasks.length}</span>
        {column.type === 'skill' && (
          <span className="column__badge">{dict.board.column.skill}</span>
        )}
      </div>
      <Droppable droppableId={column.name}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`column__body ${snapshot.isDraggingOver ? 'column__body--over' : ''}`}
          >
            {tasks.length === 0 && !snapshot.isDraggingOver && (
              <div className="column__empty">{dict.board.column.emptyState}</div>
            )}
            {tasks.map((task, index) => (
              <Card
                key={task.id}
                task={task}
                index={index}
                isRunning={runningTasks.has(task.id)}
                output={runningTasks.get(task.id)}
                dict={dict}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
