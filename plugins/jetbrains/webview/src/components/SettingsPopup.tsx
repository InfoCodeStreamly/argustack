import { useState, useEffect, useRef } from 'react';
import type { BoardSettings } from '../types.js';

interface SettingsPopupProps {
  settings: BoardSettings;
  onUpdate: (settings: BoardSettings) => void;
  onClose: () => void;
}

export function SettingsPopup({ settings, onUpdate, onClose }: SettingsPopupProps) {
  const [jiraKey, setJiraKey] = useState(settings.jiraProjectKey ?? '');
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();

    function handleClickOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
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

  function save() {
    const value = jiraKey.trim().toUpperCase() || null;
    onUpdate({ ...settings, jiraProjectKey: value });
  }

  return (
    <div className="settings-popup" ref={popupRef}>
      <div className="settings-popup__header">
        <span className="settings-popup__title">Settings</span>
        <button className="settings-popup__close" onClick={onClose} type="button">&times;</button>
      </div>
      <div className="settings-popup__body">
        <label className="settings-popup__label">Jira Project Key</label>
        <input
          ref={inputRef}
          className="settings-popup__input"
          placeholder="PAP"
          value={jiraKey}
          onChange={(e) => setJiraKey(e.target.value.toUpperCase())}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <span className="settings-popup__hint">Cards will show this prefix</span>
      </div>
    </div>
  );
}
