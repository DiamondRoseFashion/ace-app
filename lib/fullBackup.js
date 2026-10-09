// A complete copy of ACE's data (every business table, every row) as
// JSON, so it can be restored exactly. Server-only.
export const BACKUP_TABLES = ['profiles', 'projects', 'quotations', 'contacts', 'meetings', 'expenses', 'project_activity', 'brands'];
export const BACKUP_BUCKET = 'backups';
export const NIGHTLY_PREFIX = 'nightly';
export const KEEP_NIGHTLY = 14;

async function allRows(admin, table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').range(from, from + 999);
    if (error) {
      // a table that doesn't exist (yet) is skipped, anything else is a failure
      if (/does not exist|schema cache/i.test(error.message)) return { rows: null, skipped: true };
      throw new Error(`${table}: ${error.message}`);
    }
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { rows: out };
}

// List of uploaded project files (names + sizes), so missing files can be noticed
async function fileIndex(admin) {
  const files = [];
  try {
    const { data: folders } = await admin.storage.from('project-files').list('', { limit: 1000 });
    for (const f of (folders || []).slice(0, 1000)) {
      if (f.id) { files.push({ path: f.name, size: f.metadata?.size ?? null }); continue; } // a file at top level
      const { data: inner } = await admin.storage.from('project-files').list(f.name, { limit: 1000 });
      (inner || []).forEach((x) => files.push({ path: `${f.name}/${x.name}`, size: x.metadata?.size ?? null, updated_at: x.updated_at || null }));
    }
  } catch { /* the index is best-effort */ }
  return files;
}

export async function buildFullBackup(admin) {
  const tables = {};
  const counts = {};
  for (const t of BACKUP_TABLES) {
    const { rows, skipped } = await allRows(admin, t);
    if (skipped) continue;
    tables[t] = rows;
    counts[t] = rows.length;
  }
  const files = await fileIndex(admin);
  return {
    app: 'ACE',
    kind: 'full-backup',
    version: 1,
    created_at: new Date().toISOString(),
    counts: { ...counts, files: files.length },
    tables,
    files,
  };
}
