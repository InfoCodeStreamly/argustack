import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
function toDisplayName(kebab) {
    return kebab.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function SortableSkill({ skill, onRemove }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: skill });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };
    return (_jsxs("div", { ref: setNodeRef, style: style, className: "workflow-dialog__skill-selected", ...attributes, ...listeners, children: [_jsx("span", { className: "workflow-dialog__drag-handle", children: "\u2630" }), _jsx("span", { className: "workflow-dialog__skill-name", children: toDisplayName(skill) }), _jsx("button", { className: "workflow-dialog__skill-remove", onClick: (e) => { e.stopPropagation(); onRemove(); }, type: "button", children: "\u00D7" })] }));
}
export function WorkflowDialog({ mode, workflow, allSkills, existingNames, onSave, onDelete, onClose }) {
    const [name, setName] = useState(workflow?.name ?? '');
    const [orderedSkills, setOrderedSkills] = useState(workflow?.skills ?? []);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const nameRef = useRef(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));
    useEffect(() => {
        nameRef.current?.focus();
        function handleEscape(e) {
            if (e.key === 'Escape')
                onClose();
        }
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);
    function toggleSkill(skill) {
        if (orderedSkills.includes(skill)) {
            setOrderedSkills(orderedSkills.filter((s) => s !== skill));
        }
        else {
            setOrderedSkills([...orderedSkills, skill]);
        }
    }
    function handleDragEnd(event) {
        const { active, over } = event;
        if (!over || active.id === over.id)
            return;
        const oldIdx = orderedSkills.indexOf(active.id);
        const newIdx = orderedSkills.indexOf(over.id);
        if (oldIdx >= 0 && newIdx >= 0) {
            setOrderedSkills(arrayMove(orderedSkills, oldIdx, newIdx));
        }
    }
    const trimmedName = name.trim();
    const isDuplicate = mode === 'create'
        ? existingNames.includes(trimmedName)
        : existingNames.filter((n) => n !== workflow?.name).includes(trimmedName);
    const canSave = trimmedName.length > 0 && orderedSkills.length > 0 && !isDuplicate;
    function handleSave() {
        if (!canSave)
            return;
        onSave(trimmedName, orderedSkills);
        onClose();
    }
    const uncheckedSkills = allSkills.filter((s) => !orderedSkills.includes(s));
    return (_jsx("div", { className: "workflow-dialog__overlay", onClick: onClose, children: _jsxs("div", { className: "workflow-dialog", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "workflow-dialog__header", children: [_jsx("span", { className: "workflow-dialog__title", children: mode === 'create' ? 'Create Workflow' : 'Edit Workflow' }), _jsx("button", { className: "workflow-dialog__close", onClick: onClose, type: "button", children: "\u00D7" })] }), _jsxs("div", { className: "workflow-dialog__body", children: [_jsx("label", { className: "workflow-dialog__label", children: "Name" }), _jsx("input", { ref: nameRef, className: "workflow-dialog__input", value: name, onChange: (e) => setName(e.target.value), placeholder: "Development", onKeyDown: (e) => { if (e.key === 'Enter')
                                handleSave(); } }), isDuplicate && _jsx("span", { className: "workflow-dialog__error", children: "Name already exists" }), orderedSkills.length > 0 && (_jsxs(_Fragment, { children: [_jsx("label", { className: "workflow-dialog__label workflow-dialog__label--skills", children: "Pipeline" }), _jsx(DndContext, { sensors: sensors, collisionDetection: closestCenter, onDragEnd: handleDragEnd, children: _jsx(SortableContext, { items: orderedSkills, strategy: verticalListSortingStrategy, children: _jsx("div", { className: "workflow-dialog__skills", children: orderedSkills.map((skill, i) => (_jsx(SortableSkill, { skill: skill, index: i, onRemove: () => toggleSkill(skill) }, skill))) }) }) })] })), _jsx("label", { className: "workflow-dialog__label workflow-dialog__label--skills", children: orderedSkills.length > 0 ? 'Available' : 'Skills' }), _jsxs("div", { className: "workflow-dialog__skills", children: [uncheckedSkills.map((skill) => (_jsxs("div", { className: "workflow-dialog__skill-item", onClick: () => toggleSkill(skill), children: [_jsx("span", { className: "workflow-dialog__skill-add", children: "+" }), _jsx("span", { className: "workflow-dialog__skill-name", children: toDisplayName(skill) })] }, skill))), uncheckedSkills.length === 0 && orderedSkills.length > 0 && (_jsx("span", { className: "workflow-dialog__empty", children: "All skills added" })), allSkills.length === 0 && (_jsx("span", { className: "workflow-dialog__empty", children: "No skills found in .claude/skills/" }))] })] }), _jsxs("div", { className: "workflow-dialog__footer", children: [mode === 'edit' && onDelete && (confirmDelete ? (_jsx("button", { className: "workflow-dialog__btn workflow-dialog__btn--danger", onClick: () => { onDelete(workflow.name); onClose(); }, type: "button", children: "Confirm Delete" })) : (_jsx("button", { className: "workflow-dialog__btn workflow-dialog__btn--danger", onClick: () => setConfirmDelete(true), type: "button", children: "Delete" }))), _jsx("div", { className: "workflow-dialog__spacer" }), _jsx("button", { className: "workflow-dialog__btn", onClick: onClose, type: "button", children: "Cancel" }), _jsx("button", { className: "workflow-dialog__btn workflow-dialog__btn--primary", onClick: handleSave, disabled: !canSave, type: "button", children: mode === 'create' ? 'Create' : 'Save' })] })] }) }));
}
