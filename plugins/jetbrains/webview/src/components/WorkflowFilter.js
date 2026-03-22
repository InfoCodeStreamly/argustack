import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function WorkflowFilter({ workflows, activeWorkflow, onSelect }) {
    if (!workflows || workflows.length === 0)
        return null;
    return (_jsxs("select", { className: "workflow-filter", value: activeWorkflow ?? '', onChange: (e) => onSelect(e.target.value || null), children: [_jsx("option", { value: "", children: "All Skills" }), workflows.map((wf) => (_jsx("option", { value: wf.name, children: wf.name }, wf.name)))] }));
}
