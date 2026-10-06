'use client';

import { useEffect } from 'react';
import { reportError } from '@/components/ErrorReporter';

// Shown if a page crashes; the problem is reported automatically
export default function PageError({ error, reset }) {
  useEffect(() => {
    reportError({ message: error?.message || 'Page crashed', stack: error?.stack, kind: 'crash' });
  }, [error]);
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ maxWidth: 440, textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Something went wrong on this page</h2>
        <p style={{ color: 'var(--muted)' }}>It has been reported automatically. Please try again.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => reset()}>Try again</button>
          <a className="btn btn-ghost" href="/dashboard">Go to My Projects</a>
        </div>
      </div>
    </div>
  );
}
