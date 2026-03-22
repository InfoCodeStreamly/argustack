import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { WorkflowDialog } from './WorkflowDialog.js';
export function WorkflowDropdown({ workflows, activeWorkflow, allSkills, onSelect, onCreate, onUpdate, onDelete }) {
    const [isOpen, setIsOpen] = useState(false);
    const [dialog, setDialog] = useState(null);
    const dropdownRef = useRef(null);
    useEffect(() => {
        function handleClickOutside(e) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);
    const displayName = activeWorkflow ?? 'All Skills';
    const safeWorkflows = workflows ?? [];
    return (_jsxs("div", { className: "workflow-dropdown", ref: dropdownRef, children: [_jsxs("button", { className: "workflow-dropdown__trigger", onClick: () => setIsOpen(!isOpen), type: "button", children: [_jsx("span", { className: "workflow-dropdown__name", children: displayName }), _jsx("span", { className: "workflow-dropdown__arrow", children: isOpen ? '\u25B2' : '\u25BC' })] }), isOpen && (_jsxs("div", { className: "workflow-dropdown__menu", children: [safeWorkflows.map((wf) => (_jsxs("div", { className: "workflow-dropdown__item", children: [_jsxs("button", { className: `workflow-dropdown__option ${wf.name === activeWorkflow ? 'workflow-dropdown__option--active' : ''}`, onClick: () => { onSelect(wf.name); setIsOpen(false); }, type: "button", children: [wf.name === activeWorkflow && _jsx("span", { className: "workflow-dropdown__check", children: '\u2713' }), wf.name] }), _jsx("button", { className: "workflow-dropdown__edit", onClick: (e) => { e.stopPropagation(); setDialog({ mode: 'edit', workflow: wf }); setIsOpen(false); }, type: "button", title: "Edit", children: '\u270E' })] }, wf.name))), safeWorkflows.length > 0 && _jsx("div", { className: "workflow-dropdown__separator" }), _jsxs("button", { className: `workflow-dropdown__option ${!activeWorkflow ? 'workflow-dropdown__option--active' : ''}`, onClick: () => { onSelect(null); setIsOpen(false); }, type: "button", children: [!activeWorkflow && _jsx("span", { className: "workflow-dropdown__check", children: '\u2713' }), "All Skills"] }), _jsx("div", { className: "workflow-dropdown__separator" }), _jsx("button", { className: "workflow-dropdown__option workflow-dropdown__option--create", onClick: () => { setDialog({ mode: 'create' }); setIsOpen(false); }, type: "button", children: "+ New Workflow" })] })), dialog && (_jsx(WorkflowDialog, { mode: dialog.mode, workflow: dialog.workflow, allSkills: allSkills, existingNames: safeWorkflows.map((w) => w.name), onSave: (name, skills) => {
                    if (dialog.mode === 'create')
                        onCreate(name, skills);
                    else
                        onUpdate(dialog.workflow.name, name, skills);
                }, onDelete: dialog.mode === 'edit' ? onDelete : undefined, onClose: () => setDialog(null) }))] }));
}
