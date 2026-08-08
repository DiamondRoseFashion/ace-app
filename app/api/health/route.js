import { createClient } from '@supabase/supabase-js';

// A free external uptime service pings this URL periodically.
// It performs a real (tiny, read-only) database query so Supabase's
// free tier sees genuine activity and never auto-pauses the project.
// This endpoint intentionally returns no sensitive data.

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    // A minimal query — RLS blocks it from returning real rows to an
    // unauthenticated caller, but it still counts as database activity.
    await supabase.from('profiles').select('id').limit(1);

    return Response.json({ status: 'ok', time: new Date().toISOString() });
  } catch (err) {
    return Response.json({ status: 'error', message: err.message }, { status: 500 });
  }
}
