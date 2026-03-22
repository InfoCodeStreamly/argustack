import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { useState, useRef } from 'react';
import { Column } from './Column.js';
import { Card } from './Card.js';
import { EpicFilter } from './EpicFilter.js';
import { WorkflowDropdown } from './WorkflowDropdown.js';
import { SettingsPopup } from './SettingsPopup.js';
export function Board({ board, runningCards, onMoveCard, onOpenFile, onCreateCard, onResume, onSetWorkflow, onReorderColumns, onUpdateSettings, onDeleteCard, onCreateJira, onCreateWorkflow, onUpdateWorkflow, onDeleteWorkflow, onCreateEpic, onChangeEpic, onFilterEpic, onUpdateDoneFilter }) {
    const [activeCard, setActiveCard] = useState(null);
    const [activeColumn, setActiveColumn] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const dragTypeRef = useRef(null);
    const sensors = useSensors(useSensor(PointerSensor, {
        activationConstraint: { distance: 8 },
    }));
    const epicCards = board.activeEpicFilter
        ? board.cards.filter((c) => c.epic === board.activeEpicFilter)
        : board.cards;
    const activeWf = board.activeWorkflow
        ? (board.workflows ?? []).find((w) => w.name === board.activeWorkflow)
        : null;
    const visibleColumns = activeWf
        ? board.columns.filter((col) => col.type === 'system' || activeWf.skills.includes(col.name))
        : board.columns;
    const visibleColumnNames = new Set(visibleColumns.map((c) => c.name));
    const columnIds = visibleColumns.map((c) => `col:${c.name}`);
    function filterDoneCards(cards) {
        const { doneFilterValue, doneFilterUnit } = board.settings;
        if (doneFilterValue === 0)
            return cards;
        const multipliers = {
            hours: 3600000,
            days: 86400000,
            months: 2592000000,
        };
        const ms = multipliers[doneFilterUnit] ?? 3600000;
        const cutoff = Date.now() - doneFilterValue * ms;
        return cards.filter((c) => {
            if (!c.updatedAt)
                return false;
            const ts = new Date(c.updatedAt).getTime();
            return !isNaN(ts) && ts >= cutoff;
        });
    }
    function cardsForColumn(colName) {
        if (colName === 'backlog') {
            return epicCards.filter((c) => c.column === 'backlog' || !visibleColumnNames.has(c.column));
        }
        const filtered = epicCards.filter((c) => c.column === colName);
        if (colName === 'done')
            return filterDoneCards(filtered);
        return filtered;
    }
    function handleDragStart(event) {
        const id = event.active.id;
        if (id.startsWith('col:')) {
            dragTypeRef.current = 'column';
            const colName = id.slice(4);
            const col = visibleColumns.find((c) => c.name === colName);
            if (col)
                setActiveColumn(col);
        }
        else {
            dragTypeRef.current = 'card';
            const card = board.cards.find((c) => c.id === id);
            if (card)
                setActiveCard(card);
        }
    }
    function handleDragEnd(event) {
        const { active, over } = event;
        const type = dragTypeRef.current;
        dragTypeRef.current = null;
        setActiveCard(null);
        setActiveColumn(null);
        if (!over)
            return;
        if (type === 'column') {
            const fromId = active.id;
            const toId = over.id;
            if (fromId === toId)
                return;
            const oldIndex = columnIds.indexOf(fromId);
            const newIndex = columnIds.indexOf(toId);
            if (oldIndex < 0 || newIndex < 0)
                return;
            const reordered = arrayMove(visibleColumns, oldIndex, newIndex);
            const skillNames = reordered
                .filter((c) => c.type === 'skill')
                .map((c) => c.name);
            onReorderColumns(skillNames);
        }
        else {
            const cardId = active.id;
            const targetColumn = over.id;
            const realTarget = targetColumn.startsWith('col:') ? targetColumn.slice(4) : targetColumn;
            const card = board.cards.find((c) => c.id === cardId);
            if (card && card.column !== realTarget) {
                onMoveCard(cardId, realTarget);
            }
        }
    }
    return (_jsxs("div", { className: "board", children: [_jsxs("header", { className: "board__header", children: [_jsx(WorkflowDropdown, { workflows: board.workflows, activeWorkflow: board.activeWorkflow, allSkills: board.allSkills ?? [], onSelect: onSetWorkflow, onCreate: onCreateWorkflow, onUpdate: onUpdateWorkflow, onDelete: onDeleteWorkflow }), _jsx(EpicFilter, { epics: board.epics, activeFilter: board.activeEpicFilter, onFilter: onFilterEpic, onCreateEpic: onCreateEpic }), _jsx("div", { className: "board__spacer" }), !board.claudeAvailable && (_jsx("span", { className: "board__warning", children: "Claude CLI not found" })), _jsx("button", { className: "settings-btn", onClick: () => setShowSettings(!showSettings), type: "button", title: "Settings", children: "\u2699" })] }), _jsxs(DndContext, { sensors: sensors, onDragStart: handleDragStart, onDragEnd: handleDragEnd, children: [_jsx(SortableContext, { items: columnIds, strategy: horizontalListSortingStrategy, children: _jsx("div", { className: "board__columns", children: visibleColumns.map((col) => (_jsx(Column, { column: col, cards: cardsForColumn(col.name), runningCards: runningCards, jiraConfigured: board.jiraConfigured, hasProjectKey: !!board.settings?.jiraProjectKey, onOpenFile: onOpenFile, onResume: onResume, epics: board.epics, onDelete: onDeleteCard, onCreateJira: onCreateJira, onChangeEpic: onChangeEpic, epic: board.activeEpicFilter, onCreateCard: col.name === 'backlog' ? onCreateCard : undefined, doneFilter: col.name === 'done' ? { value: board.settings.doneFilterValue, unit: board.settings.doneFilterUnit } : undefined, onUpdateDoneFilter: col.name === 'done' ? onUpdateDoneFilter : undefined }, col.name))) }) }), _jsxs(DragOverlay, { children: [activeCard && (_jsx(Card, { card: activeCard, executionState: runningCards.get(activeCard.id) })), activeColumn && (_jsx("div", { className: "column column--drag-overlay", children: _jsx("div", { className: "column__header", children: _jsx("h3", { className: "column__title", children: activeColumn.displayName }) }) }))] })] }), showSettings && (_jsx(SettingsPopup, { settings: board.settings, onUpdate: (s) => { onUpdateSettings(s); setShowSettings(false); }, onClose: () => setShowSettings(false) }))] }));
}
