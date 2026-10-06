'use client';

import { useEffect } from 'react';
import { reportError } from '@/components/ErrorReporter';

// Last-resort screen if the whole app fails to load
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    reportError({ message: error?.message || 'App failed to load', stack: error?.stack, kind: 'crash' });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Segoe UI, Arial, sans-serif', background: '#FAF8FC', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, maxWidth: 420, textAlign: 'center' }}>
            <h2 style={{ marginTop: 0, color: '#0F1F3D' }}>ACE couldn&apos;t load</h2>
            <p style={{ color: '#7A6C86' }}>The problem has been reported automatically. Please try again.</p>
            <button onClick={() => reset()} style={{ background: '#6B2D82', color: '#fff', border: 0, borderRadius: 9, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
          </div>
        </div>
      </body>
    </html>
  );
}
