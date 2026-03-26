import React from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { Column } from './components/Column.js';
import { useTasks } from './hooks/useTasks.js';
import { getDictionary } from './i18n.js';

const dict = getDictionary();

export function App() {
  const { tasks, board, loading, moveTask, runningTasks } = useTasks();

  if (loading || !board) {
    return <div className="loading">{dict.common.status.loading}</div>;
  }

  const columns = board.pipeline.columns;

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) { return; }
    const { draggableId, destination } = result;
    void moveTask(draggableId, destination.droppableId);
  };

  return (
    <div className="board">
      <header className="board__header">
        <h1>{dict.board.title}</h1>
        {!board.claudeAvailable && (
          <span className="board__warning">{dict.board.warning.noClaude}</span>
        )}
      </header>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="board__columns">
          {columns.map((col) => (
            <Column
              key={col.name}
              column={col}
              tasks={tasks.filter((t) => t.column === col.name)}
              runningTasks={runningTasks}
              dict={dict}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}
