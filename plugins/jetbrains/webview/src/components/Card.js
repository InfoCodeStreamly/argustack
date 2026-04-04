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
function epicColor(name) {
    if (name === 'Uncategorized')
        return null;
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = ((hash % 360) + 360) % 360;
    return `hsla(${String(hue)}, 45%, 55%, 0.2)`;
}
function epicTextColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = ((hash % 360) + 360) % 360;
    return `hsla(${String(hue)}, 60%, 75%, 1)`;
}
export function Card({ card, executionState, jiraConfigured, hasProjectKey, epics, onDoubleClick, onResume, onDelete, onCreateJira, onChangeEpic }) {
    const resolvedState = executionState ?? card.executionState ?? undefined;
    const stateIcon = resolvedState ? STATE_ICONS[resolvedState] : '';
    const stateClass = resolvedState ? `card--${resolvedState.toLowerCase()}` : '';
    const canResume = resolvedState === 'INTERRUPTED' && card.sessionName;
    const lastClickRef = useRef(0);
    const [showMenu, setShowMenu] = useState(false);
    const menuBtnRef = useRef(null);
    const bgColor = epicColor(card.epic);
    const txtColor = epicTextColor(card.epic);
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
    return (_jsxs("div", { className: `card ${stateClass}`, "data-card-id": card.id, onClick: handleClick, children: [_jsxs("div", { className: "card__title-row", children: [_jsxs("div", { className: "card__title", children: [stateIcon && _jsx("span", { className: "card__state", children: stateIcon }), card.title] }), _jsx("button", { ref: menuBtnRef, className: "card__menu-btn", onClick: (e) => { e.stopPropagation(); setShowMenu(!showMenu); }, type: "button", children: "\u2026" })] }), _jsxs("div", { className: "card__meta", children: [bgColor && (_jsx("span", { className: "card__epic-badge", style: { backgroundColor: bgColor, color: txtColor }, children: card.epic })), card.jiraKey && _jsx("span", { className: "card__jira-key", children: card.jiraKey })] }), canResume && (_jsx("button", { className: "card__resume", onClick: (e) => { e.stopPropagation(); onResume?.(card.id); }, children: "Resume" })), showMenu && onDelete && menuBtnRef.current && (_jsx(CardContextMenu, { card: card, anchorRect: menuBtnRef.current.getBoundingClientRect(), epics: epics ?? [], jiraConfigured: jiraConfigured ?? false, hasProjectKey: hasProjectKey ?? false, onDelete: onDelete, onCreateJira: onCreateJira ?? (() => { }), onChangeEpic: onChangeEpic ?? (() => { }), onClose: () => setShowMenu(false) }))] }));
}
