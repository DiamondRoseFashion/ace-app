'use client';

// One 5-star rating per project: whoever rates last sets it.
// Click a star to rate; click the same star again (or "clear") to remove.
import { useState } from 'react';

export default function StarRating({ value = null, ratedBy = '', ratedAt = '', onRate, disabled }) {
  const [hover, setHover] = useState(0);
  const [frozen, setFrozen] = useState(false); // after a click, ignore hover until the mouse leaves
  const live = frozen ? 0 : hover;
  const shown = live || value || 0;
  const tip = value
    ? `${value} star${value > 1 ? 's' : ''}${ratedBy ? `, rated by ${ratedBy}` : ''}${ratedAt ? ` on ${ratedAt}` : ''} · click a star to change, click ${value}★ again to remove`
    : 'Not reviewed · click a star to rate';

  function choose(n) {
    setFrozen(true);
    setHover(0);
    onRate?.(value === n ? null : n);
  }

  return (
    <div className="stars" title={tip} onMouseLeave={() => { setHover(0); setFrozen(false); }} onClick={(e) => e.stopPropagation()}>
      <div className="stars-row" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={`star${n <= shown ? ' on' : ''}${live ? ' hovering' : ''}`}
            disabled={disabled}
            onMouseEnter={() => { if (!frozen) setHover(n); }}
            onMouseMove={() => { if (!frozen && hover !== n) setHover(n); }}
            onClick={() => choose(n)}
          >★</button>
        ))}
      </div>
      {value ? (
        <div className="stars-meta">
          <span className="stars-by">{ratedBy || ''}</span>
          <button type="button" className="stars-clear" disabled={disabled}
            onClick={() => { setFrozen(true); onRate?.(null); }} title="Remove the rating">clear</button>
        </div>
      ) : null}
    </div>
  );
}
