// Private calendar feed for Outlook / Google / Apple Calendar.
// URL: /api/calendar/<secret-token>.ics  — the token identifies the
// person, so anyone with the link can read that person's meetings.
// It can be reset from the planner if it's ever shared by mistake.
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/pushServer';
import { buildCalendar } from '@/lib/ics';
import { localDateKey, shiftDateKey } from '@/lib/reminderSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req, { params }) {
  const { token: raw } = await params;
  const token = String(raw || '').replace(/\.ics$/i, '');
  if (!UUID.test(token)) return new NextResponse('Not found', { status: 404 });

  const admin = adminClient();
  const { data: feed } = await admin
    .from('calendar_feeds').select('user_id').eq('token', token).maybeSingle();
  if (!feed) return new NextResponse('Not found', { status: 404 });

  const today = localDateKey(Date.now());
  const [{ data: prof }, { data: meetings, error }] = await Promise.all([
    admin.from('profiles').select('full_name, reminder_default_minutes').eq('id', feed.user_id).maybeSingle(),
    admin.from('meetings')
      .select('id, title, meeting_date, start_time, end_time, venue, notes, actions, is_done, reminder_minutes, created_at, project:projects(name)')
      .eq('assigned_to', feed.user_id)
      .gte('meeting_date', shiftDateKey(today, -90))
      .lte('meeting_date', shiftDateKey(today, 365))
      .order('meeting_date'),
  ]);
  if (error) return new NextResponse('Calendar temporarily unavailable', { status: 503 });

  const ics = buildCalendar((meetings || []).filter((m) => m.meeting_date), {
    name: 'ACE Meetings',
    reminderDefault: prof?.reminder_default_minutes ?? 60,
  });
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="ace-meetings.ics"',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
