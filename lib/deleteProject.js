// Deletes a project for good: its uploaded files first, then the project
// row. The database removes the project's contacts, quotations and
// meetings automatically (they are linked "on delete cascade").
// Row-Level Security decides who may delete: management any project,
// employees only projects they created.

export async function deleteProject(supabase, projectId) {
  // 1. uploaded files (Storage is separate from the database)
  try {
    const { data: files } = await supabase.storage.from('project-files').list(projectId, { limit: 1000 });
    const paths = (files || []).filter((f) => f.name).map((f) => `${projectId}/${f.name}`);
    if (paths.length) await supabase.storage.from('project-files').remove(paths);
  } catch {
    /* files are best-effort; the project itself still gets deleted */
  }

  // 2. the project (cascades to contacts, quotations, meetings)
  const { data, error } = await supabase.from('projects').delete().eq('id', projectId).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "You don't have permission to delete this project." };
  }
  return { ok: true };
}

export function canDeleteProject(project, me) {
  if (!project || !me) return false;
  if (['owner', 'admin', 'manager'].includes(me.role)) return true;
  return project.created_by === me.id;
}
