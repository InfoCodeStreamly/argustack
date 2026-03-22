import { useState, useEffect, useRef } from 'react';
import type { Workflow } from '../types.js';
import { WorkflowDialog } from './WorkflowDialog.js';

interface WorkflowDropdownProps {
  workflows: Workflow[];
  activeWorkflow: string | null;
  allSkills: string[];
  onSelect: (name: string | null) => void;
  onCreate: (name: string, skills: string[]) => void;
  onUpdate: (name: string, newName: string, skills: string[]) => void;
  onDelete: (name: string) => void;
}

export function WorkflowDropdown({ workflows, activeWorkflow, allSkills, onSelect, onCreate, onUpdate, onDelete }: WorkflowDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; workflow?: Workflow } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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

  return (
    <div className="workflow-dropdown" ref={dropdownRef}>
      <button
        className="workflow-dropdown__trigger"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="workflow-dropdown__name">{displayName}</span>
        <span className="workflow-dropdown__arrow">{isOpen ? '\u25B2' : '\u25BC'}</span>
      </button>

      {isOpen && (
        <div className="workflow-dropdown__menu">
          {safeWorkflows.map((wf) => (
            <div key={wf.name} className="workflow-dropdown__item">
              <button
                className={`workflow-dropdown__option ${wf.name === activeWorkflow ? 'workflow-dropdown__option--active' : ''}`}
                onClick={() => { onSelect(wf.name); setIsOpen(false); }}
                type="button"
              >
                {wf.name === activeWorkflow && <span className="workflow-dropdown__check">{'\u2713'}</span>}
                {wf.name}
              </button>
              <button
                className="workflow-dropdown__edit"
                onClick={(e) => { e.stopPropagation(); setDialog({ mode: 'edit', workflow: wf }); setIsOpen(false); }}
                type="button"
                title="Edit"
              >
                {'\u270E'}
              </button>
            </div>
          ))}

          {safeWorkflows.length > 0 && <div className="workflow-dropdown__separator" />}

          <button
            className={`workflow-dropdown__option ${!activeWorkflow ? 'workflow-dropdown__option--active' : ''}`}
            onClick={() => { onSelect(null); setIsOpen(false); }}
            type="button"
          >
            {!activeWorkflow && <span className="workflow-dropdown__check">{'\u2713'}</span>}
            All Skills
          </button>

          <div className="workflow-dropdown__separator" />

          <button
            className="workflow-dropdown__option workflow-dropdown__option--create"
            onClick={() => { setDialog({ mode: 'create' }); setIsOpen(false); }}
            type="button"
          >
            + New Workflow
          </button>
        </div>
      )}

      {dialog && (
        <WorkflowDialog
          mode={dialog.mode}
          workflow={dialog.workflow}
          allSkills={allSkills}
          existingNames={safeWorkflows.map((w) => w.name)}
          onSave={(name, skills) => {
            if (dialog.mode === 'create') onCreate(name, skills);
            else onUpdate(dialog.workflow!.name, name, skills);
          }}
          onDelete={dialog.mode === 'edit' ? onDelete : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
