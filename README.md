# ACE — Setup Guide (zero coding experience needed)

This is a real, working application: sign-up/login, a project database, and a
3-step project wizard, with security enforced at the database level so
clients and contractors only ever see their own projects.

Follow these steps in order. Total time: ~20–30 minutes, all free.

---

## Step 1 — Create your database (Supabase)

1. Go to https://supabase.com → sign up (free) → **New project**
2. Pick a name (e.g. "ace-production"), set a database password (save it somewhere safe), pick a region close to your users (e.g. UAE-adjacent), click **Create**
3. Once it's ready, go to the **SQL Editor** (left sidebar) → **New query**
4. Open the file `supabase/schema.sql` from this folder, copy all of it, paste it into the SQL editor, click **Run**
5. Go to **Project Settings → API** (left sidebar, gear icon). You'll need two values from this page in Step 3:
   - **Project URL**
   - **anon public** key

---

## Step 2 — Get the code onto your computer

You'll need two free tools installed once:
- **Node.js** — download from https://nodejs.org (choose the LTS version)
- **Git** — download from https://git-scm.com

Then:
1. Unzip the `ace-app` folder you downloaded from this chat, anywhere on your computer
2. Open a terminal (Mac: Terminal app, Windows: Command Prompt) in that folder
3. Run: `npm install`

---

## Step 3 — Connect the code to your database

1. In the `ace-app` folder, make a copy of `.env.local.example` and rename it to `.env.local`
2. Open `.env.local` in any text editor and paste in the **Project URL** and **anon public** key from Step 1
3. Run `npm run dev` in your terminal, then open `http://localhost:3000` in your browser — you should see the ACE login screen. Sign up with your own email to test it.

---

## Step 4 — Make yourself an Admin

By default every new sign-up becomes an "employee." To make your own account
an admin:
1. In Supabase, go to **Table Editor → profiles**
2. Find your row (matches your email in the Authentication tab), change `role` to `admin`

---

## Step 5 — Put it online (Vercel)

1. Go to https://vercel.com → sign up free (use "Continue with GitHub" if you have a GitHub account — if not, make one free at https://github.com first, and push this folder there)
2. **Add New → Project** → import your ace-app repository
3. In the project settings, add the same two environment variables from Step 3 (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
4. Click **Deploy** — in about a minute you'll get a live URL like `ace-yourcompany.vercel.app`

That's it — a real, live, secured application, for AED 0/month at this scale.

---

## What's already built

- **Sign up / log in** (Supabase Authentication — passwords are hashed and never stored in plain text)
- **Role-based access**: admin / manager / employee / client / contractor
- **Row-Level Security**: enforced *in the database itself* — even if someone
  finds a way around the app's screens, the database will still refuse to
  hand them another client's data
- **Dashboard**: lists projects (auto-filtered per user by RLS)
- **New Project wizard**: the exact 3 windows you designed — Project Details (10%) → Quotation (20%) → Meetings (30%) — saving real data as you go

## What to build next (in order of usefulness)

1. Multiple contacts per role (Contractor/Client/Consultant/Main Contractor) — the database already supports this (`contacts` table), just needs a repeatable "+ Add contact" UI like the prototype had
2. Project detail page — click a project to see its full history
3. File uploads for drawings/quotations (Supabase Storage — same free account)
4. Inviting clients/contractors as users and linking them to their `owner_id` on a project
5. Email notifications when a meeting or quotation deadline approaches

If any step above trips you up, come back to this chat (or open Claude Code with this same folder) and I'll walk through it with you.
