import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
const MAX_RESULTS = 5;
export function EpicFilter({ epics, activeFilter, onFilter, onCreateEpic }) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const dropdownRef = useRef(null);
    const searchRef = useRef(null);
    const createRef = useRef(null);
    useEffect(() => {
        function handleClickOutside(e) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setIsOpen(false);
                setSearch('');
                setIsCreating(false);
            }
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);
    useEffect(() => {
        if (isOpen && !isCreating)
            setTimeout(() => searchRef.current?.focus(), 0);
        if (isCreating)
            setTimeout(() => createRef.current?.focus(), 0);
    }, [isOpen, isCreating]);
    const displayName = activeFilter ?? 'All Epics';
    const filtered = epics.filter((ep) => ep.name.toLowerCase().includes(search.toLowerCase()));
    const shown = filtered.slice(0, MAX_RESULTS);
    const hasMore = filtered.length > MAX_RESULTS;
    function handleCreate() {
        const name = newName.trim();
        if (name) {
            onCreateEpic(name);
            setNewName('');
            setIsCreating(false);
            setIsOpen(false);
            setSearch('');
        }
    }
    return (_jsxs("div", { className: "epic-dropdown", ref: dropdownRef, children: [_jsxs("button", { className: "epic-dropdown__trigger", onClick: () => { setIsOpen(!isOpen); setSearch(''); }, type: "button", children: [_jsx("span", { className: "epic-dropdown__name", children: displayName }), _jsx("span", { className: "epic-dropdown__arrow", children: isOpen ? '\u25B2' : '\u25BC' })] }), isOpen && (_jsxs("div", { className: "epic-dropdown__menu", children: [_jsx("div", { className: "epic-dropdown__search", children: _jsx("input", { ref: searchRef, className: "epic-dropdown__search-input", placeholder: "Search epic...", value: search, onChange: (e) => setSearch(e.target.value), onKeyDown: (e) => { if (e.key === 'Escape') {
                                setIsOpen(false);
                                setSearch('');
                            } } }) }), _jsxs("button", { className: `epic-dropdown__option ${!activeFilter ? 'epic-dropdown__option--active' : ''}`, onClick: () => { onFilter(null); setIsOpen(false); setSearch(''); }, type: "button", children: [!activeFilter && _jsx("span", { className: "epic-dropdown__check", children: '\u2713' }), "All Epics"] }), _jsx("div", { className: "epic-dropdown__separator" }), shown.map((epic) => (_jsxs("button", { className: `epic-dropdown__option ${epic.name === activeFilter ? 'epic-dropdown__option--active' : ''}`, onClick: () => { onFilter(epic.name); setIsOpen(false); setSearch(''); }, type: "button", children: [epic.name === activeFilter && _jsx("span", { className: "epic-dropdown__check", children: '\u2713' }), epic.name] }, epic.name))), hasMore && (_jsxs("span", { className: "epic-dropdown__more", children: [filtered.length - MAX_RESULTS, " more..."] })), _jsx("div", { className: "epic-dropdown__separator" }), isCreating ? (_jsx("div", { className: "epic-dropdown__create-input", children: _jsx("input", { ref: createRef, className: "epic-dropdown__input", value: newName, onChange: (e) => setNewName(e.target.value), placeholder: "Epic name...", onKeyDown: (e) => {
                                if (e.key === 'Enter')
                                    handleCreate();
                                if (e.key === 'Escape') {
                                    setIsCreating(false);
                                    setNewName('');
                                }
                            } }) })) : (_jsx("button", { className: "epic-dropdown__option epic-dropdown__option--create", onClick: () => setIsCreating(true), type: "button", children: "+ New Epic" }))] }))] }));
}
