import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
export function SettingsPopup({ settings, onUpdate, onClose }) {
    const [jiraKey, setJiraKey] = useState(settings.jiraProjectKey ?? '');
    const popupRef = useRef(null);
    const inputRef = useRef(null);
    useEffect(() => {
        inputRef.current?.focus();
        function handleClickOutside(e) {
            if (popupRef.current && !popupRef.current.contains(e.target)) {
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
    function save() {
        const value = jiraKey.trim().toUpperCase() || null;
        onUpdate({ ...settings, jiraProjectKey: value });
    }
    return (_jsxs("div", { className: "settings-popup", ref: popupRef, children: [_jsxs("div", { className: "settings-popup__header", children: [_jsx("span", { className: "settings-popup__title", children: "Settings" }), _jsx("button", { className: "settings-popup__close", onClick: onClose, type: "button", children: "\u00D7" })] }), _jsxs("div", { className: "settings-popup__body", children: [_jsx("label", { className: "settings-popup__label", children: "Jira Project Key" }), _jsx("input", { ref: inputRef, className: "settings-popup__input", placeholder: "PAP", value: jiraKey, onChange: (e) => setJiraKey(e.target.value.toUpperCase()), onBlur: save, onKeyDown: (e) => { if (e.key === 'Enter')
                            save(); } }), _jsx("span", { className: "settings-popup__hint", children: "Cards will show this prefix" })] })] }));
}
