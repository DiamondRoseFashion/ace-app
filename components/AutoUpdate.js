'use client';

// Keeps open ACE tabs on the latest release. When a new version goes
// live, a banner offers a one-click refresh, and the tab refreshes by
// itself the next time you move to another page (never while you're in
// the middle of typing something).
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const MINE = process.env.NEXT_PUBLIC_ACE_VERSION || 'dev';
const CHECK_EVERY_MS = 5 * 60 * 1000;
let outdated = false;

async function latestVersion() {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}

export default function AutoUpdate() {
  const pathname = usePathname();
  const [show, setShow] = useState(outdated);

  // moving to another page is a safe moment to pick up the new version
  useEffect(() => {
    if (outdated) window.location.reload();
  }, [pathname]);

  useEffect(() => {
    if (MINE === 'dev') return undefined;
    let stopped = false;
    async function check() {
      if (outdated) return;
      const live = await latestVersion();
      if (stopped || !live || live === 'dev' || live === MINE) return;
      outdated = true;
      setShow(true);
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!show) return null;
  return (
    <div className="update-banner" role="status">
      <span>✨ A new version of ACE is ready.</span>
      <button type="button" onClick={() => window.location.reload()}>Refresh now</button>
    </div>
  );
}
