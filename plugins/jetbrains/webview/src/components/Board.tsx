import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { useState, useRef } from 'react';
import { Column } from './Column.js';
import { Card } from './Card.js';
import { EpicFilter } from './EpicFilter.js';
import { WorkflowDropdown } from './WorkflowDropdown.js';
import { SettingsPopup } from './SettingsPopup.js';
import type { BoardState, BoardSettings, ExecutionState, Card as CardType, Column as ColumnType } from '../types.js';

interface BoardProps {
  board: BoardState;
  runningCards: Map<string, ExecutionState>;
  onMoveCard: (cardId: string, targetColumn: string) => void;
  onOpenFile: (cardId: string) => void;
  onCreateCard: (title: string, epic: string) => void;
  onResume: (cardId: string) => void;
  onSetWorkflow: (name: string | null) => void;
  onReorderColumns: (columnNames: string[]) => void;
  onUpdateSettings: (settings: BoardSettings) => void;
  onDeleteCard: (cardId: string) => void;
  onCreateJira: (cardId: string) => void;
  onCreateWorkflow: (name: string, skills: string[]) => void;
  onUpdateWorkflow: (name: string, newName: string, skills: string[]) => void;
  onDeleteWorkflow: (name: string) => void;
  onCreateEpic: (name: string) => void;
  onChangeEpic: (cardId: string, targetEpic: string) => void;
  onFilterEpic: (epicName: string | null) => void;
  onUpdateDoneFilter: (value: number, unit: string) => void;
}

export function Board({ board, runningCards, onMoveCard, onOpenFile, onCreateCard, onResume, onSetWorkflow, onReorderColumns, onUpdateSettings, onDeleteCard, onCreateJira, onCreateWorkflow, onUpdateWorkflow, onDeleteWorkflow, onCreateEpic, onChangeEpic, onFilterEpic, onUpdateDoneFilter }: BoardProps) {
  const [activeCard, setActiveCard] = useState<CardType | null>(null);
  const [activeColumn, setActiveColumn] = useState<ColumnType | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const dragTypeRef = useRef<'card' | 'column' | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const epicCards = board.activeEpicFilter
    ? board.cards.filter((c) => c.epic === board.activeEpicFilter)
    : board.cards;

  const activeWf = board.activeWorkflow
    ? (board.workflows ?? []).find((w) => w.name === board.activeWorkflow)
    : null;

  const visibleColumns = activeWf
    ? board.columns.filter((col) =>
        col.type === 'system' || activeWf.skills.includes(col.name),
      )
    : board.columns;

  const visibleColumnNames = new Set(visibleColumns.map((c) => c.name));
  const columnIds = visibleColumns.map((c) => `col:${c.name}`);

  function filterDoneCards(cards: CardType[]): CardType[] {
    const { doneFilterValue, doneFilterUnit } = board.settings;
    if (doneFilterValue === 0) return cards;

    const multipliers: Record<string, number> = {
      hours: 3600000,
      days: 86400000,
      months: 2592000000,
    };
    const ms = multipliers[doneFilterUnit] ?? 3600000;
    const cutoff = Date.now() - doneFilterValue * ms;

    return cards.filter((c) => {
      if (!c.updatedAt) return false;
      const ts = new Date(c.updatedAt).getTime();
      return !isNaN(ts) && ts >= cutoff;
    });
  }

  function cardsForColumn(colName: string) {
    if (colName === 'backlog') {
      return epicCards.filter((c) => c.column === 'backlog' || !visibleColumnNames.has(c.column));
    }
    const filtered = epicCards.filter((c) => c.column === colName);
    if (colName === 'done') return filterDoneCards(filtered);
    return filtered;
  }

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    if (id.startsWith('col:')) {
      dragTypeRef.current = 'column';
      const colName = id.slice(4);
      const col = visibleColumns.find((c) => c.name === colName);
      if (col) setActiveColumn(col);
    } else {
      dragTypeRef.current = 'card';
      const card = board.cards.find((c) => c.id === id);
      if (card) setActiveCard(card);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const type = dragTypeRef.current;
    dragTypeRef.current = null;
    setActiveCard(null);
    setActiveColumn(null);

    if (!over) return;

    if (type === 'column') {
      const fromId = active.id as string;
      const toId = over.id as string;
      if (fromId === toId) return;

      const oldIndex = columnIds.indexOf(fromId);
      const newIndex = columnIds.indexOf(toId);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = arrayMove(visibleColumns, oldIndex, newIndex);
      const skillNames = reordered
        .filter((c) => c.type === 'skill')
        .map((c) => c.name);
      onReorderColumns(skillNames);
    } else {
      const cardId = active.id as string;
      const targetColumn = over.id as string;
      const realTarget = targetColumn.startsWith('col:') ? targetColumn.slice(4) : targetColumn;
      const card = board.cards.find((c) => c.id === cardId);
      if (card && card.column !== realTarget) {
        onMoveCard(cardId, realTarget);
      }
    }
  }

  return (
    <div className="board">
      <header className="board__header">
        <WorkflowDropdown
          workflows={board.workflows}
          activeWorkflow={board.activeWorkflow}
          allSkills={board.allSkills ?? []}
          onSelect={onSetWorkflow}
          onCreate={onCreateWorkflow}
          onUpdate={onUpdateWorkflow}
          onDelete={onDeleteWorkflow}
        />
        <EpicFilter
          epics={board.epics}
          activeFilter={board.activeEpicFilter}
          onFilter={onFilterEpic}
          onCreateEpic={onCreateEpic}
        />
        <div className="board__spacer" />
        {!board.claudeAvailable && (
          <span className="board__warning">Claude CLI not found</span>
        )}
        <button
          className="settings-btn"
          onClick={() => setShowSettings(!showSettings)}
          type="button"
          title="Settings"
        >
          &#9881;
        </button>
      </header>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
          <div className="board__columns">
            {visibleColumns.map((col) => (
              <Column
                key={col.name}
                column={col}
                cards={cardsForColumn(col.name)}
                runningCards={runningCards}
                jiraConfigured={board.jiraConfigured}
                hasProjectKey={!!board.settings?.jiraProjectKey}
                onOpenFile={onOpenFile}
                onResume={onResume}
                epics={board.epics}
                onDelete={onDeleteCard}
                onCreateJira={onCreateJira}
                onChangeEpic={onChangeEpic}
                epic={board.activeEpicFilter}
                onCreateCard={col.name === 'backlog' ? onCreateCard : undefined}
                doneFilter={col.name === 'done' ? { value: board.settings.doneFilterValue, unit: board.settings.doneFilterUnit } : undefined}
                onUpdateDoneFilter={col.name === 'done' ? onUpdateDoneFilter : undefined}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeCard && (
            <Card card={activeCard} executionState={runningCards.get(activeCard.id)} />
          )}
          {activeColumn && (
            <div className="column column--drag-overlay">
              <div className="column__header">
                <h3 className="column__title">{activeColumn.displayName}</h3>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {showSettings && (
        <SettingsPopup
          settings={board.settings}
          onUpdate={(s) => { onUpdateSettings(s); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
