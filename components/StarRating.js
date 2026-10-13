'use client';

// 5-star review for a project. Shows the average of everyone's ratings;
// clicking a star sets YOUR rating. Click your same rating again (or
// "clear") to remove it.
import { useState } from 'react';

export default function StarRating({ avg = null, count = 0, mine = null, onRate, disabled }) {
  const [hover, setHover] = useState(0);
  const [frozen, setFrozen] = useState(false); // after a click, ignore hover until the mouse leaves
  const live = frozen ? 0 : hover;
  const shown = live || (avg ? Math.round(avg) : 0);
  const tip = `${avg ? `Average ${avg.toFixed(1)} from ${count} review${count === 1 ? '' : 's'}` : 'No reviews yet'}`
    + `${mine ? ` · your rating: ${mine}★ (click it again to remove)` : ' · click a star to rate'}`;

  function choose(n) {
    setFrozen(true);
    setHover(0);
    onRate?.(mine === n ? null : n);
  }

  return (
    <div className="stars" title={tip} onMouseLeave={() => { setHover(0); setFrozen(false); }} onClick={(e) => e.stopPropagation()}>
      <div className="stars-row" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={mine === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={`star${n <= shown ? ' on' : ''}${live ? ' hovering' : ''}`}
            disabled={disabled}
            onMouseEnter={() => { if (!frozen) setHover(n); }}
            onMouseMove={() => { if (frozen) return; if (hover !== n) setHover(n); }}
            onClick={() => choose(n)}
          >★</button>
        ))}
      </div>
      {(count > 0 || mine) && (
        <div className="stars-meta">
          {count > 0 && <span>{avg.toFixed(1)} · {count}</span>}
          {mine && (
            <button type="button" className="stars-clear" disabled={disabled}
              onClick={() => { setFrozen(true); onRate?.(null); }} title="Remove your rating">clear</button>
          )}
        </div>
      )}
    </div>
  );
}
