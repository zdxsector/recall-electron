import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

type FindBarProps = {
  onSearch: (value: string) => { total: number; index: number };
  onFind: (action: 'previous' | 'next') => { total: number; index: number };
  onClear: () => void;
  onClose: () => void;
};

export default function FindBar({
  onSearch,
  onFind,
  onClear,
  onClose,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      if (value) {
        const result = onSearch(value);
        setTotal(result.total);
        setIndex(result.index);
      } else {
        onClear();
        setTotal(0);
        setIndex(-1);
      }
    },
    [onSearch, onClear]
  );

  const handlePrev = useCallback(() => {
    if (total === 0) return;
    const result = onFind('previous');
    setTotal(result.total);
    setIndex(result.index);
  }, [onFind, total]);

  const handleNext = useCallback(() => {
    if (total === 0) return;
    const result = onFind('next');
    setTotal(result.total);
    setIndex(result.index);
  }, [onFind, total]);

  const handleClose = useCallback(() => {
    onClear();
    onClose();
  }, [onClear, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrev();
        } else {
          handleNext();
        }
      }
    },
    [handleClose, handlePrev, handleNext]
  );

  const displayIndex = total > 0 ? index + 1 : 0;

  return (
    <div className="find-bar" onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        className="find-bar__input"
        type="text"
        value={query}
        onChange={handleChange}
        placeholder="Find in note..."
        spellCheck={false}
        autoComplete="off"
      />
      <span className="find-bar__count">
        {displayIndex}/{total}
      </span>
      <span className="find-bar__separator" />
      <button
        className="find-bar__btn"
        onClick={handlePrev}
        disabled={total === 0}
        title="Previous match (Shift+Enter)"
        type="button"
      >
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M8 4.5L2.5 10l1.06 1.06L8 6.62l4.44 4.44L13.5 10 8 4.5z" />
        </svg>
      </button>
      <button
        className="find-bar__btn"
        onClick={handleNext}
        disabled={total === 0}
        title="Next match (Enter)"
        type="button"
      >
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M8 11.5l5.5-5.5-1.06-1.06L8 9.38 3.56 4.94 2.5 6 8 11.5z" />
        </svg>
      </button>
      <span className="find-bar__separator" />
      <button
        className="find-bar__btn find-bar__btn--close"
        onClick={handleClose}
        title="Close (Escape)"
        type="button"
      >
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M13.66 3.76l-1.42-1.42L8 6.59 3.76 2.34 2.34 3.76 6.59 8l-4.25 4.24 1.42 1.42L8 9.41l4.24 4.25 1.42-1.42L9.41 8 13.66 3.76z" />
        </svg>
      </button>
    </div>
  );
}
