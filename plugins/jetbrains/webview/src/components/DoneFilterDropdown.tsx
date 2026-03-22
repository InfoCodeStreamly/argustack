import { useState, useEffect, useRef } from 'react';

interface DoneFilterDropdownProps {
  value: number;
  unit: string;
  onUpdate: (value: number, unit: string) => void;
  onClose: () => void;
}

const UNITS = ['hours', 'days', 'months'] as const;

export function DoneFilterDropdown({ value, unit, onUpdate, onClose }: DoneFilterDropdownProps) {
  const [inputValue, setInputValue] = useState(String(value));
  const [selectedUnit, setSelectedUnit] = useState(unit);
  const [unitOpen, setUnitOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();

    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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

  function apply(newValue?: string, newUnit?: string) {
    const num = Math.max(0, parseInt(newValue ?? inputValue, 10) || 0);
    onUpdate(num, newUnit ?? selectedUnit);
  }

  return (
    <div className="done-filter__menu" ref={dropdownRef}>
      <div className="done-filter__controls">
        <input
          ref={inputRef}
          className="done-filter__input"
          type="number"
          min="0"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={() => apply()}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
        />
        <div className="done-filter__unit-wrapper">
          <button
            className="done-filter__unit-trigger"
            onClick={() => setUnitOpen(!unitOpen)}
            type="button"
          >
            <span>{selectedUnit}</span>
            <span className="done-filter__arrow">{unitOpen ? '\u25B2' : '\u25BC'}</span>
          </button>
          {unitOpen && (
            <div className="done-filter__unit-menu">
              {UNITS.map((u) => (
                <button
                  key={u}
                  className={`done-filter__unit-option ${u === selectedUnit ? 'done-filter__unit-option--active' : ''}`}
                  onClick={() => {
                    setSelectedUnit(u);
                    setUnitOpen(false);
                    apply(undefined, u);
                  }}
                  type="button"
                >
                  {u === selectedUnit && <span className="done-filter__check">{'\u2713'}</span>}
                  {u}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="done-filter__separator" />
      <button
        className={`done-filter__option ${parseInt(inputValue, 10) === 0 ? 'done-filter__option--active' : ''}`}
        onClick={() => {
          setInputValue('0');
          apply('0');
        }}
        type="button"
      >
        {parseInt(inputValue, 10) === 0 && <span className="done-filter__check">{'\u2713'}</span>}
        Show all
      </button>
    </div>
  );
}
