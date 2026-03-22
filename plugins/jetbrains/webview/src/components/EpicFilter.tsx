import { useState, useEffect, useRef } from 'react';
import type { Epic } from '../types.js';

const MAX_RESULTS = 5;

interface EpicFilterProps {
  epics: Epic[];
  activeFilter: string | null;
  onFilter: (epicName: string | null) => void;
  onCreateEpic: (name: string) => void;
}

export function EpicFilter({ epics, activeFilter, onFilter, onCreateEpic }: EpicFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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
    if (isOpen && !isCreating) setTimeout(() => searchRef.current?.focus(), 0);
    if (isCreating) setTimeout(() => createRef.current?.focus(), 0);
  }, [isOpen, isCreating]);

  const displayName = activeFilter ?? 'All Epics';

  const filtered = epics.filter((ep) =>
    ep.name.toLowerCase().includes(search.toLowerCase()),
  );
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

  return (
    <div className="epic-dropdown" ref={dropdownRef}>
      <button
        className="epic-dropdown__trigger"
        onClick={() => { setIsOpen(!isOpen); setSearch(''); }}
        type="button"
      >
        <span className="epic-dropdown__name">{displayName}</span>
        <span className="epic-dropdown__arrow">{isOpen ? '\u25B2' : '\u25BC'}</span>
      </button>

      {isOpen && (
        <div className="epic-dropdown__menu">
          <div className="epic-dropdown__search">
            <input
              ref={searchRef}
              className="epic-dropdown__search-input"
              placeholder="Search epic..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setIsOpen(false); setSearch(''); } }}
            />
          </div>

          <button
            className={`epic-dropdown__option ${!activeFilter ? 'epic-dropdown__option--active' : ''}`}
            onClick={() => { onFilter(null); setIsOpen(false); setSearch(''); }}
            type="button"
          >
            {!activeFilter && <span className="epic-dropdown__check">{'\u2713'}</span>}
            All Epics
          </button>

          <div className="epic-dropdown__separator" />

          {shown.map((epic) => (
            <button
              key={epic.name}
              className={`epic-dropdown__option ${epic.name === activeFilter ? 'epic-dropdown__option--active' : ''}`}
              onClick={() => { onFilter(epic.name); setIsOpen(false); setSearch(''); }}
              type="button"
            >
              {epic.name === activeFilter && <span className="epic-dropdown__check">{'\u2713'}</span>}
              {epic.name}
            </button>
          ))}

          {hasMore && (
            <span className="epic-dropdown__more">{filtered.length - MAX_RESULTS} more...</span>
          )}

          <div className="epic-dropdown__separator" />

          {isCreating ? (
            <div className="epic-dropdown__create-input">
              <input
                ref={createRef}
                className="epic-dropdown__input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Epic name..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') { setIsCreating(false); setNewName(''); }
                }}
              />
            </div>
          ) : (
            <button
              className="epic-dropdown__option epic-dropdown__option--create"
              onClick={() => setIsCreating(true)}
              type="button"
            >
              + New Epic
            </button>
          )}
        </div>
      )}
    </div>
  );
}
