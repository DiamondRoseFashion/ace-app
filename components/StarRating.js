'use client';

// 5-star review for a project. Shows the average of everyone's ratings;
// clicking a star sets YOUR rating (click your same rating again to remove it).
import { useState } from 'react';

export default function StarRating({ avg = null, count = 0, mine = null, onRate, disabled }) {
  const [hover, setHover] = useState(0);
  const shown = hover || (avg ? Math.round(avg) : 0);
  const tip = `${avg ? `Average ${avg.toFixed(1)} from ${count} review${count === 1 ? '' : 's'}` : 'No reviews yet'}`
    + `${mine ? ` · your rating: ${mine}★ (click it again to remove)` : ' · click a star to rate'}`;
  return (
    <div className="stars" title={tip} onMouseLeave={() => setHover(0)} onClick={(e) => e.stopPropagation()}>
      <div className="stars-row" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={mine === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={`star${n <= shown ? ' on' : ''}${hover ? ' hovering' : ''}${mine === n && !hover ? ' mine' : ''}`}
            disabled={disabled}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onRate?.(mine === n ? null : n)}
          >★</button>
        ))}
      </div>
      {count > 0 && <div className="stars-meta">{avg.toFixed(1)} · {count}</div>}
    </div>
  );
}
