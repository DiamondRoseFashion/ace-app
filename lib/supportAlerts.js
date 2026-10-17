'use client';
// "New project to support": count of my assigned projects I haven't
// opened yet + the newest arrivals for the pop-up message.
import { useNewItems } from '@/lib/newItemAlerts';

export function useSupportAlerts(supabase) {
  return useNewItems(supabase, {
    rpc: 'my_new_support', idKey: 'project_id', table: 'project_supporters', column: 'user_id',
    swType: 'ace-support', seenEvent: 'ace-support-seen', path: '/support', sessionKey: 'ace-support-toast',
  });
}

// New meetings a manager / admin / owner gave me
export function useMeetingAlerts(supabase) {
  return useNewItems(supabase, {
    rpc: 'my_new_meetings', idKey: 'meeting_id', table: 'meetings', column: 'assigned_to',
    swType: 'ace-meeting-assigned', seenEvent: 'ace-meetings-seen', path: '/planner', sessionKey: 'ace-meeting-toast',
  });
}

export async function markMeetingsSeen(supabase) {
  const { error } = await supabase.rpc('mark_meetings_seen');
  if (!error) window.dispatchEvent(new Event('ace-meetings-seen'));
}

// After a manager saves a meeting for someone else: notify that person
export async function notifyMeetingAssignee(supabase, meetingId) {
  if (!meetingId) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/notify-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ meetingId }),
    });
  } catch { /* the badge inside ACE still shows it */ }
}

// Tell the database this person has seen their new support projects.
export async function markSupportSeen(supabase) {
  const { error } = await supabase.rpc('mark_support_seen');
  if (!error) window.dispatchEvent(new Event('ace-support-seen'));
}

// After saving "Supported By": ask the server to notify the new people.
export async function notifySupporters(supabase, projectId, userIds) {
  if (!projectId || !userIds?.length) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/notify-support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ projectId, userIds }),
    });
  } catch { /* the badge inside ACE still shows it */ }
}
