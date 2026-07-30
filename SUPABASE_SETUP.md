# VIT Inquiry Hub — Netlify + Supabase setup

This turns the prototype into a real multi-user app: staff sign in with a
school email, data is stored in a Postgres database (Supabase) with row-level
security, and it syncs across devices. About 15 minutes, all on free tiers.

You do these steps — they happen inside *your* Supabase and Netlify accounts.

---

## 1. Create the Supabase project (~3 min)

1. Sign up at [supabase.com](https://supabase.com) → **New project**.
2. Give it a name, set a database password (save it), pick a region —
   **Sydney (ap-southeast-2)** keeps data in Australia.
3. Wait for it to finish provisioning.

## 2. Create the database (~1 min)

1. In the project, open **SQL Editor → New query**.
2. Copy the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and paste it in.
3. Click **Run**. It creates the tables, security policies, and the trigger
   that makes the **first person to sign up the admin**.

## 3. Turn off email confirmation for now (~1 min)

So staff can sign in immediately without an email server:

1. **Authentication → Sign In / Providers → Email**.
2. Turn **Confirm email** *off*, and Save.

> Leave it off for the prototype. For a real rollout, turn it back on and
> configure an SMTP sender (Authentication → Emails) so accounts are verified.

## 4. Copy your two keys (~1 min)

**Project Settings → API**, copy:

- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public** key → `VITE_SUPABASE_ANON_KEY`

(The anon key is meant to be public — it's protected by the row-level security
from step 2. Never use the *service_role* key in the app.)

## 5. Deploy on Netlify (~5 min)

1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an
   existing project** → connect GitHub → pick `ashleesmith-blip/other`, branch
   `claude/vit-staff-platform-sci207`.
2. Netlify reads `netlify.toml` automatically — leave the build settings alone.
3. **Site settings → Environment variables → Add**:
   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon key |
   | `ANTHROPIC_API_KEY` | your Anthropic key *(only for the AI Import tab)* |
4. **Deploy** (or **Trigger deploy → Clear cache and deploy** after adding the
   vars, since `VITE_` vars are baked in at build time).

That's it — Netlify gives you a `https://<name>.netlify.app` URL.

## 6. First run

1. Open the site → **Create an account** with your school email + a password.
   This first account becomes **admin**.
2. Everyone else creates their own account the same way (they start as
   *graduate*).
3. As admin, go to **Users** and set each person's **role** (graduate / mentor
   / admin) and, for graduates, their **mentor**.
4. Graduates open the app and start their inquiry; mentors/admins open a
   graduate to leave feedback; admin sets the **Timeline** dates.

---

## How it fits together

- **`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set** → the app runs in
  **cloud mode**: real logins, shared database, cross-device sync.
- **Not set** (e.g. pasted into a claude.ai artifact) → it falls back to the
  original **local mode** (simulated logins, this-browser-only storage). Same UI.
- Who can see/edit what is enforced in the database by the policies in
  `schema.sql`: a graduate can only touch their own project; a mentor can read
  and comment on their assigned graduates; an admin sees everything. The
  read-only "review mode" in the UI is backed by these policies, not just the
  client.

## Data residency note

Choosing the Sydney region keeps the database in Australia, which matters for
DoE student-data expectations. Before storing anything beyond de-identified
Student A/B/C notes, confirm the arrangement against your school's / the
department's data-privacy requirements — Supabase is a third-party US company
even with an AU region, so a formal sign-off is the right step for a real
rollout.

## Troubleshooting

- **"Setting up your profile…" hangs** → the sign-up trigger didn't run;
  re-check that `schema.sql` ran without errors (SQL Editor shows failures).
- **Import tab errors** → `ANTHROPIC_API_KEY` isn't set in Netlify, or you
  changed env vars without a fresh deploy.
- **Changed `VITE_` vars but nothing changed** → they're compiled in at build
  time; trigger a new deploy.
- **A graduate sees no data / can't save** → confirm their profile role in the
  Users tab and that `schema.sql`'s policies were created.
