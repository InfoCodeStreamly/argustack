import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from './Card.js';
import { DoneFilterDropdown } from './DoneFilterDropdown.js';
export function Column({ column, cards, runningCards, jiraConfigured, hasProjectKey, epics, onOpenFile, onResume, onDelete, onCreateJira, onChangeEpic, epic, onCreateCard, doneFilter, onUpdateDoneFilter }) {
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
    return (_jsxs("div", { ref: sortable.setNodeRef, style: style, className: `column column--${column.type} ${isOver ? 'column--over' : ''}`, children: [_jsxs("div", { className: `column__header ${!isSystem ? 'column__header--draggable' : ''}`, style: isDone ? { position: 'relative' } : undefined, ...(isSystem ? {} : sortable.attributes), ...(isSystem ? {} : sortable.listeners), children: [_jsx("h3", { className: "column__title", children: column.displayName }), _jsx("span", { className: "column__count", children: cards.length }), column.type === 'skill' && _jsx("span", { className: "column__badge", children: "Skill" }), isDone && onUpdateDoneFilter && (_jsx("button", { className: "done-filter__btn", onClick: () => setShowDoneFilter(!showDoneFilter), type: "button", title: "Filter completed tasks", children: "\u2699" })), showDoneFilter && doneFilter && onUpdateDoneFilter && (_jsx(DoneFilterDropdown, { value: doneFilter.value, unit: doneFilter.unit, onUpdate: (v, u) => { onUpdateDoneFilter(v, u); }, onClose: () => setShowDoneFilter(false) }))] }), _jsxs("div", { ref: setDropRef, className: "column__body", children: [column.name === 'backlog' && onCreateCard && (_jsx("input", { className: "column__new-card-input", placeholder: "New task...", onKeyDown: (e) => {
                            if (e.key === 'Enter') {
                                const input = e.currentTarget;
                                const title = input.value.trim();
                                if (title) {
                                    onCreateCard(title, epic ?? 'Uncategorized');
                                    input.value = '';
                                }
                            }
                        } })), cards.length === 0 && !onCreateCard && _jsx("div", { className: "column__empty", children: "No Tasks" }), cards.map((card) => (_jsx(DraggableCard, { card: card, executionState: runningCards.get(card.id), jiraConfigured: jiraConfigured, hasProjectKey: hasProjectKey, epics: epics, onDoubleClick: onOpenFile, onResume: onResume, onDelete: onDelete, onCreateJira: onCreateJira, onChangeEpic: onChangeEpic }, card.id)))] })] }));
}
function DraggableCard({ card, executionState, jiraConfigured, hasProjectKey, epics, onDoubleClick, onResume, onDelete, onCreateJira, onChangeEpic }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: card.id,
    });
    return (_jsx("div", { ref: setNodeRef, ...listeners, ...attributes, className: isDragging ? 'card--dragging' : '', children: _jsx(Card, { card: card, executionState: executionState, jiraConfigured: jiraConfigured, hasProjectKey: hasProjectKey, epics: epics, onDoubleClick: onDoubleClick, onResume: onResume, onDelete: onDelete, onCreateJira: onCreateJira, onChangeEpic: onChangeEpic }) }));
}
