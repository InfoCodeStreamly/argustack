import type { Card, Epic, ExecutionState } from '../types.js';

interface CardDetailProps {
  card: Card;
  epics: Epic[];
  executionState?: ExecutionState;
  onClose: () => void;
  onChangeEpic: (cardId: string, targetEpic: string) => void;
}

const STATE_LABELS: Record<ExecutionState, string> = {
  IDLE: 'Idle',
  RUNNING: 'Running...',
  DONE: 'Complete',
  ERROR: 'Error',
  INTERRUPTED: 'Interrupted',
};

export function CardDetail({ card, epics, executionState, onClose, onChangeEpic }: CardDetailProps) {
  return (
    <div className="card-detail">
      <div className="card-detail__header">
        <h3>{card.title}</h3>
        <button className="card-detail__close" onClick={onClose} type="button">
          &times;
        </button>
      </div>
      <div className="card-detail__body">
        <div className="card-detail__row">
          <span className="card-detail__label">Epic</span>
          <select
            className="card-detail__epic-select"
            value={card.epic}
            onChange={(e) => onChangeEpic(card.id, e.target.value)}
          >
            {epics.map((epic) => (
              <option key={epic.name} value={epic.name}>{epic.name}</option>
            ))}
          </select>
        </div>
        {card.jiraKey && (
          <div className="card-detail__row">
            <span className="card-detail__label">Jira</span>
            <span>{card.jiraKey}</span>
          </div>
        )}
        {card.assignee && (
          <div className="card-detail__row">
            <span className="card-detail__label">Assignee</span>
            <span>{card.assignee}</span>
          </div>
        )}
        {executionState && (
          <div className="card-detail__row">
            <span className="card-detail__label">Status</span>
            <span className={`card-detail__state card-detail__state--${executionState.toLowerCase()}`}>
              {STATE_LABELS[executionState]}
            </span>
          </div>
        )}
        <div className="card-detail__row">
          <span className="card-detail__label">File</span>
          <span className="card-detail__path">{card.mdPath}</span>
        </div>
      </div>
    </div>
  );
}
