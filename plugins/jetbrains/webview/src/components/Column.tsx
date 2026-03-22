import { useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from './Card.js';
import { DoneFilterDropdown } from './DoneFilterDropdown.js';
import type { Card as CardType, Column as ColumnType, Epic, ExecutionState } from '../types.js';

interface DoneFilterConfig {
  value: number;
  unit: string;
}

interface ColumnProps {
  column: ColumnType;
  cards: CardType[];
  runningCards: Map<string, ExecutionState>;
  jiraConfigured: boolean;
  hasProjectKey: boolean;
  onOpenFile: (cardId: string) => void;
  onResume: (cardId: string) => void;
  epics: Epic[];
  onDelete: (cardId: string) => void;
  onCreateJira: (cardId: string) => void;
  onChangeEpic: (cardId: string, targetEpic: string) => void;
  epic?: string | null;
  onCreateCard?: (title: string, epic: string) => void;
  doneFilter?: DoneFilterConfig;
  onUpdateDoneFilter?: (value: number, unit: string) => void;
}

export function Column({ column, cards, runningCards, jiraConfigured, hasProjectKey, epics, onOpenFile, onResume, onDelete, onCreateJira, onChangeEpic, epic, onCreateCard, doneFilter, onUpdateDoneFilter }: ColumnProps) {
  const [showDoneFilter, setShowDoneFilter] = useState(false);
  const isDone = column.name === 'done';
  const isSystem = column.type === 'system';
  const sortable = useSortable({
    id: `col:${column.name}`,
    disabled: isSystem,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: column.name,
  });

  const style = !isSystem ? {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  } : undefined;

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`column column--${column.type} ${isOver ? 'column--over' : ''}`}
    >
      <div
        className={`column__header ${!isSystem ? 'column__header--draggable' : ''}`}
        style={isDone ? { position: 'relative' } : undefined}
        {...(isSystem ? {} : sortable.attributes)}
        {...(isSystem ? {} : sortable.listeners)}
      >
        <h3 className="column__title">{column.displayName}</h3>
        <span className="column__count">{cards.length}</span>
        {column.type === 'skill' && <span className="column__badge">Skill</span>}
        {isDone && onUpdateDoneFilter && (
          <button
            className="done-filter__btn"
            onClick={() => setShowDoneFilter(!showDoneFilter)}
            type="button"
            title="Filter completed tasks"
          >&#9881;</button>
        )}
        {showDoneFilter && doneFilter && onUpdateDoneFilter && (
          <DoneFilterDropdown
            value={doneFilter.value}
            unit={doneFilter.unit}
            onUpdate={(v, u) => { onUpdateDoneFilter(v, u); }}
            onClose={() => setShowDoneFilter(false)}
          />
        )}
      </div>
      <div ref={setDropRef} className="column__body">
        {column.name === 'backlog' && onCreateCard && (
          <input
            className="column__new-card-input"
            placeholder="New task..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const input = e.currentTarget;
                const title = input.value.trim();
                if (title) {
                  onCreateCard(title, epic ?? 'Uncategorized');
                  input.value = '';
                }
              }
            }}
          />
        )}
        {cards.length === 0 && !onCreateCard && <div className="column__empty">No Tasks</div>}
        {cards.map((card) => (
          <DraggableCard
            key={card.id}
            card={card}
            executionState={runningCards.get(card.id)}
            jiraConfigured={jiraConfigured}
            hasProjectKey={hasProjectKey}
            epics={epics}
            onDoubleClick={onOpenFile}
            onResume={onResume}
            onDelete={onDelete}
            onCreateJira={onCreateJira}
            onChangeEpic={onChangeEpic}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({ card, executionState, jiraConfigured, hasProjectKey, epics, onDoubleClick, onResume, onDelete, onCreateJira, onChangeEpic }: { card: CardType; executionState?: ExecutionState; jiraConfigured?: boolean; hasProjectKey?: boolean; epics?: Epic[]; onDoubleClick?: (cardId: string) => void; onResume?: (cardId: string) => void; onDelete?: (cardId: string) => void; onCreateJira?: (cardId: string) => void; onChangeEpic?: (cardId: string, targetEpic: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'card--dragging' : ''}
    >
      <Card card={card} executionState={executionState} jiraConfigured={jiraConfigured} hasProjectKey={hasProjectKey} epics={epics} onDoubleClick={onDoubleClick} onResume={onResume} onDelete={onDelete} onCreateJira={onCreateJira} onChangeEpic={onChangeEpic} />
    </div>
  );
}
