import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import type { BoardTask } from '../types.js';
import type { DictionaryResult } from '../types/dictionary.types.js';

interface CardProps {
  task: BoardTask;
  index: number;
  output?: string;
  isRunning: boolean;
  dict: DictionaryResult;
}

export function Card({ task, index, output, isRunning, dict }: CardProps) {
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`card ${snapshot.isDragging ? 'card--dragging' : ''} ${isRunning ? 'card--running' : ''}`}
        >
          <div className="card__title">{task.title}</div>
          {task.jiraKey && (
            <span className="card__jira">{dict.board.card.jiraPrefix}: {task.jiraKey}</span>
          )}
          {task.assignee && (
            <span className="card__assignee">{dict.board.card.assignedTo}: {task.assignee}</span>
          )}
          {!task.assignee && (
            <span className="card__assignee card__assignee--none">{dict.board.card.noAssignee}</span>
          )}
          {isRunning && (
            <div className="card__output">
              <div className="card__output-label">{dict.board.card.runningSkill}</div>
              <pre>{output}</pre>
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}
