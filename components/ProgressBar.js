import { projectProgress } from '@/lib/projectStatus';

// Progress bar + percentage for a project, worked out from its status
export default function ProgressBar({ status, size = 'sm' }) {
  const pct = projectProgress(status);
  return (
    <div className={`pbar pbar-${size}`} title={`${pct}% complete`}>
      <div className="pbar-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`pbar-fill${pct === 100 ? ' done' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="pbar-pct mono">{pct}%</span>
    </div>
  );
}
