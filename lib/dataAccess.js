// Who may see which data in View Data / Download Excel:
//   owner, admin, manager → every project
//   everyone else signed in (employees) → only the projects they created
export const MANAGEMENT_ROLES = ['owner', 'admin', 'manager'];

// → { user, role, ownerId } or { status, error }
export async function dataAccess(admin, request) {
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { status: 401, error: 'Not authenticated' };
  const { data: { user } = {}, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return { status: 401, error: 'Not authenticated' };
  const { data: profile, error: profileError } = await admin
    .from('profiles').select('role').eq('id', user.id).single();
  if (profileError || !profile) return { status: 403, error: 'Not authorized' };
  const all = MANAGEMENT_ROLES.includes(profile.role);
  return { user, role: profile.role, ownerId: all ? null : user.id };
}
