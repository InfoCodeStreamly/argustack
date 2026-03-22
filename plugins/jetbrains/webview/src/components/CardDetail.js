import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const STATE_LABELS = {
    IDLE: 'Idle',
    RUNNING: 'Running...',
    DONE: 'Complete',
    ERROR: 'Error',
    INTERRUPTED: 'Interrupted',
};
export function CardDetail({ card, epics, executionState, onClose, onChangeEpic }) {
    return (_jsxs("div", { className: "card-detail", children: [_jsxs("div", { className: "card-detail__header", children: [_jsx("h3", { children: card.title }), _jsx("button", { className: "card-detail__close", onClick: onClose, type: "button", children: "\u00D7" })] }), _jsxs("div", { className: "card-detail__body", children: [_jsxs("div", { className: "card-detail__row", children: [_jsx("span", { className: "card-detail__label", children: "Epic" }), _jsx("select", { className: "card-detail__epic-select", value: card.epic, onChange: (e) => onChangeEpic(card.id, e.target.value), children: epics.map((epic) => (_jsx("option", { value: epic.name, children: epic.name }, epic.name))) })] }), card.jiraKey && (_jsxs("div", { className: "card-detail__row", children: [_jsx("span", { className: "card-detail__label", children: "Jira" }), _jsx("span", { children: card.jiraKey })] })), card.assignee && (_jsxs("div", { className: "card-detail__row", children: [_jsx("span", { className: "card-detail__label", children: "Assignee" }), _jsx("span", { children: card.assignee })] })), executionState && (_jsxs("div", { className: "card-detail__row", children: [_jsx("span", { className: "card-detail__label", children: "Status" }), _jsx("span", { className: `card-detail__state card-detail__state--${executionState.toLowerCase()}`, children: STATE_LABELS[executionState] })] })), _jsxs("div", { className: "card-detail__row", children: [_jsx("span", { className: "card-detail__label", children: "File" }), _jsx("span", { className: "card-detail__path", children: card.mdPath })] })] })] }));
}
