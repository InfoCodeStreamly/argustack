import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
const UNITS = ['hours', 'days', 'months'];
export function DoneFilterDropdown({ value, unit, onUpdate, onClose }) {
    const [inputValue, setInputValue] = useState(String(value));
    const [selectedUnit, setSelectedUnit] = useState(unit);
    const [unitOpen, setUnitOpen] = useState(false);
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);
    useEffect(() => {
        inputRef.current?.select();
        function handleClickOutside(e) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
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
    function apply(newValue, newUnit) {
        const num = Math.max(0, parseInt(newValue ?? inputValue, 10) || 0);
        onUpdate(num, newUnit ?? selectedUnit);
    }
    return (_jsxs("div", { className: "done-filter__menu", ref: dropdownRef, children: [_jsxs("div", { className: "done-filter__controls", children: [_jsx("input", { ref: inputRef, className: "done-filter__input", type: "number", min: "0", value: inputValue, onChange: (e) => setInputValue(e.target.value), onBlur: () => apply(), onKeyDown: (e) => { if (e.key === 'Enter')
                            apply(); } }), _jsxs("div", { className: "done-filter__unit-wrapper", children: [_jsxs("button", { className: "done-filter__unit-trigger", onClick: () => setUnitOpen(!unitOpen), type: "button", children: [_jsx("span", { children: selectedUnit }), _jsx("span", { className: "done-filter__arrow", children: unitOpen ? '\u25B2' : '\u25BC' })] }), unitOpen && (_jsx("div", { className: "done-filter__unit-menu", children: UNITS.map((u) => (_jsxs("button", { className: `done-filter__unit-option ${u === selectedUnit ? 'done-filter__unit-option--active' : ''}`, onClick: () => {
                                        setSelectedUnit(u);
                                        setUnitOpen(false);
                                        apply(undefined, u);
                                    }, type: "button", children: [u === selectedUnit && _jsx("span", { className: "done-filter__check", children: '\u2713' }), u] }, u))) }))] })] }), _jsx("div", { className: "done-filter__separator" }), _jsxs("button", { className: `done-filter__option ${parseInt(inputValue, 10) === 0 ? 'done-filter__option--active' : ''}`, onClick: () => {
                    setInputValue('0');
                    apply('0');
                }, type: "button", children: [parseInt(inputValue, 10) === 0 && _jsx("span", { className: "done-filter__check", children: '\u2713' }), "Show all"] })] }));
}
