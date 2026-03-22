import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { CardContextMenu } from './CardContextMenu.js';
const STATE_ICONS = {
    IDLE: '',
    RUNNING: '\u23F3',
    DONE: '\u2713',
    ERROR: '\u2717',
    INTERRUPTED: '\u26A0',
};
const DOUBLE_CLICK_MS = 300;
export function Card({ card, executionState, jiraConfigured, hasProjectKey, epics, onDoubleClick, onResume, onDelete, onCreateJira, onChangeEpic }) {
    const resolvedState = executionState ?? card.executionState ?? undefined;
    const stateIcon = resolvedState ? STATE_ICONS[resolvedState] : '';
    const stateClass = resolvedState ? `card--${resolvedState.toLowerCase()}` : '';
    const canResume = resolvedState === 'INTERRUPTED' && card.sessionName;
    const lastClickRef = useRef(0);
    const [showMenu, setShowMenu] = useState(false);
    const menuBtnRef = useRef(null);
    function handleClick() {
        const now = Date.now();
        if (now - lastClickRef.current < DOUBLE_CLICK_MS) {
            onDoubleClick?.(card.id);
            lastClickRef.current = 0;
        }
        else {
            lastClickRef.current = now;
        }
    }
    return (_jsxs("div", { className: `card ${stateClass}`, "data-card-id": card.id, onClick: handleClick, children: [_jsxs("div", { className: "card__title-row", children: [_jsxs("div", { className: "card__title", children: [stateIcon && _jsx("span", { className: "card__state", children: stateIcon }), card.jiraKey && _jsx("span", { className: "card__project-key", children: card.jiraKey }), card.title] }), _jsx("button", { ref: menuBtnRef, className: "card__menu-btn", onClick: (e) => { e.stopPropagation(); setShowMenu(!showMenu); }, type: "button", children: "\u2026" })] }), _jsxs("div", { className: "card__meta", children: [card.epic !== 'Uncategorized' && _jsx("span", { className: "card__epic", children: card.epic }), card.assignee && _jsx("span", { className: "card__assignee", children: card.assignee })] }), canResume && (_jsx("button", { className: "card__resume", onClick: (e) => { e.stopPropagation(); onResume?.(card.id); }, children: "Resume" })), showMenu && onDelete && menuBtnRef.current && (_jsx(CardContextMenu, { card: card, anchorRect: menuBtnRef.current.getBoundingClientRect(), epics: epics ?? [], jiraConfigured: jiraConfigured ?? false, hasProjectKey: hasProjectKey ?? false, onDelete: onDelete, onCreateJira: onCreateJira ?? (() => { }), onChangeEpic: onChangeEpic ?? (() => { }), onClose: () => setShowMenu(false) }))] }));
}
