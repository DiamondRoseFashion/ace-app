import { createClient } from '@supabase/supabase-js';

// This route runs on the server, never in the browser, so it's safe to use
// secret keys here (RESEND_API_KEY) that must never be exposed to visitors.

export async function POST(request) {
  try {
    const { email, token } = await request.json();

    if (!email || !token) {
      return Response.json({ error: 'Missing email or session token' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return Response.json({ error: 'Only admins and managers can send invites' }, { status: 403 });
    }

    if (!process.env.RESEND_API_KEY) {
      return Response.json({ error: 'Email sending is not configured yet (missing RESEND_API_KEY)' }, { status: 500 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://ace-app-sepia.vercel.app';

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'ACE <onboarding@resend.dev>',
        to: [email],
        subject: "You're invited to ACE",
        html: `<div style="font-family: sans-serif; max-width: 480px;"><h2 style="color: #3D1250;">You've been invited to ACE</h2><p>Someone on your team invited you to join their project management workspace.</p><p><a href="${siteUrl}/login" style="background:#6B2D82; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; display:inline-block;">Sign up for ACE</a></p><p style="color:#888; font-size:13px;">Or copy this link: ${siteUrl}/login</p></div>`,
      }),
    });

    if (!resendResponse.ok) {
      const errData = await resendResponse.json().catch(() => ({}));
      return Response.json({ error: errData.message || 'Failed to send email' }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Unexpected error' }, { status: 500 });
  }
}