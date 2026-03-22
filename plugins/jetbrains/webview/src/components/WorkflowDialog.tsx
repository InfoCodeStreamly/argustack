import { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Workflow } from '../types.js';

interface WorkflowDialogProps {
  mode: 'create' | 'edit';
  workflow?: Workflow;
  allSkills: string[];
  existingNames: string[];
  onSave: (name: string, skills: string[]) => void;
  onDelete?: (name: string) => void;
  onClose: () => void;
}

function toDisplayName(kebab: string): string {
  return kebab.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function SortableSkill({ skill, onRemove }: { skill: string; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: skill });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="workflow-dialog__skill-selected" {...attributes} {...listeners}>
      <span className="workflow-dialog__drag-handle">&#x2630;</span>
      <span className="workflow-dialog__skill-name">{toDisplayName(skill)}</span>
      <button
        className="workflow-dialog__skill-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        type="button"
      >&times;</button>
    </div>
  );
}

export function WorkflowDialog({ mode, workflow, allSkills, existingNames, onSave, onDelete, onClose }: WorkflowDialogProps) {
  const [name, setName] = useState(workflow?.name ?? '');
  const [orderedSkills, setOrderedSkills] = useState<string[]>(workflow?.skills ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));

  useEffect(() => {
    nameRef.current?.focus();
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  function toggleSkill(skill: string) {
    if (orderedSkills.includes(skill)) {
      setOrderedSkills(orderedSkills.filter((s) => s !== skill));
    } else {
      setOrderedSkills([...orderedSkills, skill]);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = orderedSkills.indexOf(active.id as string);
    const newIdx = orderedSkills.indexOf(over.id as string);
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
    if (!canSave) return;
    onSave(trimmedName, orderedSkills);
    onClose();
  }

  const uncheckedSkills = allSkills.filter((s) => !orderedSkills.includes(s));

  return (
    <div className="workflow-dialog__overlay" onClick={onClose}>
      <div className="workflow-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="workflow-dialog__header">
          <span className="workflow-dialog__title">
            {mode === 'create' ? 'Create Workflow' : 'Edit Workflow'}
          </span>
          <button className="workflow-dialog__close" onClick={onClose} type="button">&times;</button>
        </div>

        <div className="workflow-dialog__body">
          <label className="workflow-dialog__label">Name</label>
          <input
            ref={nameRef}
            className="workflow-dialog__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Development"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          />
          {isDuplicate && <span className="workflow-dialog__error">Name already exists</span>}

          {orderedSkills.length > 0 && (
            <>
              <label className="workflow-dialog__label workflow-dialog__label--skills">Pipeline</label>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={orderedSkills} strategy={verticalListSortingStrategy}>
                  <div className="workflow-dialog__skills">
                    {orderedSkills.map((skill, i) => (
                      <SortableSkill key={skill} skill={skill} index={i} onRemove={() => toggleSkill(skill)} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}

          <label className="workflow-dialog__label workflow-dialog__label--skills">
            {orderedSkills.length > 0 ? 'Available' : 'Skills'}
          </label>
          <div className="workflow-dialog__skills">
            {uncheckedSkills.map((skill) => (
              <div
                key={skill}
                className="workflow-dialog__skill-item"
                onClick={() => toggleSkill(skill)}
              >
                <span className="workflow-dialog__skill-add">+</span>
                <span className="workflow-dialog__skill-name">{toDisplayName(skill)}</span>
              </div>
            ))}
            {uncheckedSkills.length === 0 && orderedSkills.length > 0 && (
              <span className="workflow-dialog__empty">All skills added</span>
            )}
            {allSkills.length === 0 && (
              <span className="workflow-dialog__empty">No skills found in .claude/skills/</span>
            )}
          </div>
        </div>

        <div className="workflow-dialog__footer">
          {mode === 'edit' && onDelete && (
            confirmDelete ? (
              <button
                className="workflow-dialog__btn workflow-dialog__btn--danger"
                onClick={() => { onDelete(workflow!.name); onClose(); }}
                type="button"
              >
                Confirm Delete
              </button>
            ) : (
              <button
                className="workflow-dialog__btn workflow-dialog__btn--danger"
                onClick={() => setConfirmDelete(true)}
                type="button"
              >
                Delete
              </button>
            )
          )}
          <div className="workflow-dialog__spacer" />
          <button className="workflow-dialog__btn" onClick={onClose} type="button">Cancel</button>
          <button
            className="workflow-dialog__btn workflow-dialog__btn--primary"
            onClick={handleSave}
            disabled={!canSave}
            type="button"
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
