import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
const MAX_EPIC_RESULTS = 5;
export function CardContextMenu({ card, anchorRect, epics, jiraConfigured, hasProjectKey, onDelete, onCreateJira, onChangeEpic, onClose }) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [showEpicSubmenu, setShowEpicSubmenu] = useState(false);
    const [epicSearch, setEpicSearch] = useState('');
    const epicInputRef = useRef(null);
    const menuRef = useRef(null);
    useEffect(() => {
        function handleClickOutside(e) {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                onClose();
            }
        }
        function handleEscape(e) {
            if (e.key === 'Escape')
                onClose();
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);
    const hasFullJiraKey = card.jiraKey && card.jiraKey.includes('-');
    const canCreateJira = jiraConfigured && hasProjectKey && !hasFullJiraKey;
    const showMoveEpic = epics.length > 1;
    const style = {
        top: anchorRect.bottom + 4,
        right: window.innerWidth - anchorRect.right,
    };
    return (_jsxs("div", { className: "card-context-menu", ref: menuRef, style: style, children: [canCreateJira && (_jsx("button", { className: "card-context-menu__item", onClick: (e) => { e.stopPropagation(); onCreateJira(card.id); onClose(); }, type: "button", children: "Create Jira Ticket" })), hasFullJiraKey && (_jsx("span", { className: "card-context-menu__item card-context-menu__item--disabled", children: card.jiraKey })), showMoveEpic && !showEpicSubmenu && (_jsx("button", { className: "card-context-menu__item", onClick: (e) => { e.stopPropagation(); setShowEpicSubmenu(true); setTimeout(() => epicInputRef.current?.focus(), 0); }, type: "button", children: "Move to Epic" })), showEpicSubmenu && (_jsxs("div", { className: "card-context-menu__epic-search", children: [_jsx("input", { ref: epicInputRef, className: "card-context-menu__epic-input", placeholder: "Search epic...", value: epicSearch, onChange: (e) => setEpicSearch(e.target.value), onClick: (e) => e.stopPropagation(), onKeyDown: (e) => { if (e.key === 'Escape') {
                            setShowEpicSubmenu(false);
                            setEpicSearch('');
                        } } }), epics
                        .filter((ep) => ep.name !== card.epic && ep.name.toLowerCase().includes(epicSearch.toLowerCase()))
                        .slice(0, MAX_EPIC_RESULTS)
                        .map((epic) => (_jsx("button", { className: "card-context-menu__item", onClick: (e) => { e.stopPropagation(); onChangeEpic(card.id, epic.name); onClose(); }, type: "button", children: epic.name }, epic.name)))] })), _jsx("div", { className: "card-context-menu__separator" }), confirmDelete ? (_jsx("button", { className: "card-context-menu__item card-context-menu__item--danger", onClick: (e) => { e.stopPropagation(); onDelete(card.id); onClose(); }, type: "button", children: "Confirm Delete" })) : (_jsx("button", { className: "card-context-menu__item card-context-menu__item--danger", onClick: (e) => { e.stopPropagation(); setConfirmDelete(true); }, type: "button", children: "Delete" }))] }));
}
