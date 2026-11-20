// Supabase space used by ACE, against the plan's limits, for the Monday
// weekly report. At 80% the report says to plan the upgrade; at 90%, to
// upgrade now. Change the limits here if the Supabase plan changes.
export const PLAN = {
  name: 'Supabase Free',
  filesLimit: 1024 * 1024 * 1024, // 1 GB of file storage
  dbLimit: 500 * 1024 * 1024, // 500 MB database
};
export const WARN_AT = 80;
export const URGENT_AT = 90;

export function sizeText(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

// → { files, db: { used, limit, pct }, level: 'ok' | 'warn' | 'urgent' } or null (not set up yet)
export async function storageUsage(admin) {
  const { data, error } = await admin.rpc('storage_usage');
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return null;
  const part = (used, limit) => ({ used: Number(used) || 0, limit, pct: Math.round(((Number(used) || 0) / limit) * 1000) / 10 });
  const files = part(row.files_bytes, PLAN.filesLimit);
  const db = part(row.db_bytes, PLAN.dbLimit);
  const top = Math.max(files.pct, db.pct);
  return { files, db, filesCount: Number(row.files_count) || 0, level: top >= URGENT_AT ? 'urgent' : top >= WARN_AT ? 'warn' : 'ok' };
}
