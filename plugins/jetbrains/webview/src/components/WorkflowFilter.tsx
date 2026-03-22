import type { Workflow } from '../types.js';

interface WorkflowFilterProps {
  workflows: Workflow[];
  activeWorkflow: string | null;
  onSelect: (name: string | null) => void;
}

export function WorkflowFilter({ workflows, activeWorkflow, onSelect }: WorkflowFilterProps) {
  if (!workflows || workflows.length === 0) return null;

  return (
    <select
      className="workflow-filter"
      value={activeWorkflow ?? ''}
      onChange={(e) => onSelect(e.target.value || null)}
    >
      <option value="">All Skills</option>
      {workflows.map((wf) => (
        <option key={wf.name} value={wf.name}>
          {wf.name}
        </option>
      ))}
    </select>
  );
}
