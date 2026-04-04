import { useRef, useState } from 'react';
import type { Card as CardType, Epic, ExecutionState } from '../types.js';
import { CardContextMenu } from './CardContextMenu.js';

interface CardProps {
  card: CardType;
  executionState?: ExecutionState;
  jiraConfigured?: boolean;
  hasProjectKey?: boolean;
  onDoubleClick?: (cardId: string) => void;
  onResume?: (cardId: string) => void;
  epics?: Epic[];
  onDelete?: (cardId: string) => void;
  onCreateJira?: (cardId: string) => void;
  onChangeEpic?: (cardId: string, targetEpic: string) => void;
}

const STATE_ICONS: Record<ExecutionState, string> = {
  IDLE: '',
  RUNNING: '\u23F3',
  DONE: '\u2713',
  ERROR: '\u2717',
  INTERRUPTED: '\u26A0',
};

const DOUBLE_CLICK_MS = 300;

function epicColor(name: string): string | null {
  if (name === 'Uncategorized') return null;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsla(${String(hue)}, 45%, 55%, 0.2)`;
}

function epicTextColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsla(${String(hue)}, 60%, 75%, 1)`;
}

export function Card({ card, executionState, jiraConfigured, hasProjectKey, epics, onDoubleClick, onResume, onDelete, onCreateJira, onChangeEpic }: CardProps) {
  const resolvedState = executionState ?? (card.executionState as ExecutionState | null) ?? undefined;
  const stateIcon = resolvedState ? STATE_ICONS[resolvedState] : '';
  const stateClass = resolvedState ? `card--${resolvedState.toLowerCase()}` : '';
  const canResume = resolvedState === 'INTERRUPTED' && card.sessionName;
  const lastClickRef = useRef(0);
  const [showMenu, setShowMenu] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const bgColor = epicColor(card.epic);
  const txtColor = epicTextColor(card.epic);

  function handleClick() {
    const now = Date.now();
    if (now - lastClickRef.current < DOUBLE_CLICK_MS) {
      onDoubleClick?.(card.id);
      lastClickRef.current = 0;
    } else {
      lastClickRef.current = now;
    }
  }

  return (
    <div
      className={`card ${stateClass}`}
      data-card-id={card.id}
      onClick={handleClick}
    >
      <div className="card__title-row">
        <div className="card__title">
          {stateIcon && <span className="card__state">{stateIcon}</span>}
          {card.title}
        </div>
        <button
          ref={menuBtnRef}
          className="card__menu-btn"
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          type="button"
        >
          &hellip;
        </button>
      </div>
      <div className="card__meta">
        {bgColor && (
          <span
            className="card__epic-badge"
            style={{ backgroundColor: bgColor, color: txtColor }}
          >
            {card.epic}
          </span>
        )}
        {card.jiraKey && <span className="card__jira-key">{card.jiraKey}</span>}
      </div>
      {canResume && (
        <button
          className="card__resume"
          onClick={(e) => { e.stopPropagation(); onResume?.(card.id); }}
        >
          Resume
        </button>
      )}
      {showMenu && onDelete && menuBtnRef.current && (
        <CardContextMenu
          card={card}
          anchorRect={menuBtnRef.current.getBoundingClientRect()}
          epics={epics ?? []}
          jiraConfigured={jiraConfigured ?? false}
          hasProjectKey={hasProjectKey ?? false}
          onDelete={onDelete}
          onCreateJira={onCreateJira ?? (() => {})}
          onChangeEpic={onChangeEpic ?? (() => {})}
          onClose={() => setShowMenu(false)}
        />
      )}
    </div>
  );
}
