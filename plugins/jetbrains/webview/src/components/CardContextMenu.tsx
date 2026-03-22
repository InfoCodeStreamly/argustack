import { useEffect, useRef, useState } from 'react';
import type { Card, Epic } from '../types.js';

interface CardContextMenuProps {
  card: Card;
  anchorRect: DOMRect;
  epics: Epic[];
  jiraConfigured: boolean;
  hasProjectKey: boolean;
  onDelete: (cardId: string) => void;
  onCreateJira: (cardId: string) => void;
  onChangeEpic: (cardId: string, targetEpic: string) => void;
  onClose: () => void;
}

const MAX_EPIC_RESULTS = 5;

export function CardContextMenu({ card, anchorRect, epics, jiraConfigured, hasProjectKey, onDelete, onCreateJira, onChangeEpic, onClose }: CardContextMenuProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEpicSubmenu, setShowEpicSubmenu] = useState(false);
  const [epicSearch, setEpicSearch] = useState('');
  const epicInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
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

  const style: React.CSSProperties = {
    top: anchorRect.bottom + 4,
    right: window.innerWidth - anchorRect.right,
  };

  return (
    <div className="card-context-menu" ref={menuRef} style={style}>
      {canCreateJira && (
        <button
          className="card-context-menu__item"
          onClick={(e) => { e.stopPropagation(); onCreateJira(card.id); onClose(); }}
          type="button"
        >
          Create Jira Ticket
        </button>
      )}
      {hasFullJiraKey && (
        <span className="card-context-menu__item card-context-menu__item--disabled">
          {card.jiraKey}
        </span>
      )}
      {showMoveEpic && !showEpicSubmenu && (
        <button
          className="card-context-menu__item"
          onClick={(e) => { e.stopPropagation(); setShowEpicSubmenu(true); setTimeout(() => epicInputRef.current?.focus(), 0); }}
          type="button"
        >
          Move to Epic
        </button>
      )}
      {showEpicSubmenu && (
        <div className="card-context-menu__epic-search">
          <input
            ref={epicInputRef}
            className="card-context-menu__epic-input"
            placeholder="Search epic..."
            value={epicSearch}
            onChange={(e) => setEpicSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') { setShowEpicSubmenu(false); setEpicSearch(''); } }}
          />
          {epics
            .filter((ep) => ep.name !== card.epic && ep.name.toLowerCase().includes(epicSearch.toLowerCase()))
            .slice(0, MAX_EPIC_RESULTS)
            .map((epic) => (
              <button
                key={epic.name}
                className="card-context-menu__item"
                onClick={(e) => { e.stopPropagation(); onChangeEpic(card.id, epic.name); onClose(); }}
                type="button"
              >
                {epic.name}
              </button>
            ))
          }
        </div>
      )}
      <div className="card-context-menu__separator" />
      {confirmDelete ? (
        <button
          className="card-context-menu__item card-context-menu__item--danger"
          onClick={(e) => { e.stopPropagation(); onDelete(card.id); onClose(); }}
          type="button"
        >
          Confirm Delete
        </button>
      ) : (
        <button
          className="card-context-menu__item card-context-menu__item--danger"
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          type="button"
        >
          Delete
        </button>
      )}
    </div>
  );
}
