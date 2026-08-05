This repo holds two standalone school tools. Both keep their data in the browser only.

- **[Athletics Manager](#athletics-manager)** — house athletics, records and the district team (P–6).
- **[Aide Timetable](#aide-timetable--weekly-aide--yard-duty-planner)** — weekly aide + yard duty planner.

---

# Athletics Manager

House athletics carnival day through to picking the district team, for a P–6 school.

**Deployable file:** `index.html` — open it from disk, or drag it onto
[Netlify Drop](https://app.netlify.com/drop). React and the whole app are inlined, so it makes
**no external requests** and works on a locked-down school network or with no internet at all.

**Source:** `src/athletics.jsx` + `src/styles.css`. After editing either, run `node build.js`
to regenerate `index.html`.

## Tabs

| Tab | What it does |
| --- | --- |
| **Events** | The standard program is pre-loaded — 100m, 200m, 800m, 1500m, 80m hurdles, long/triple/high jump, shot put, discus, 4x100m relay — each with the year levels it runs at and whether the winner is the fastest or the furthest. Add your own. |
| **Houses** | The overall tally — participation and placing points per house, ranked, with the breakdown and the points scheme. |
| **Students** | The whole list, filterable by year, house and name. Every column is editable straight in the table — name, year, gender, house, homegroup and beep test. A hundred rows show at a time; search or filter to reach the rest. **Change a whole group at once** moves a homegroup, a year level, everyone currently shown by the filters, or everyone missing a year level — for rollover, or when a homegroup code didn't give the right year on import. |
| **Import** | Paste four columns out of Excel — **Name, Gender, Homegroup, House** — or load a `.json`/`.csv`. Year level is read from the homegroup code (`I3P` → 3), houses named in the file are created if they don't exist, and re-importing skips anyone already on the list. Everything previews before it applies. There's a download button here to back the list up. |
| **Results** | Where the hardcopy sheets get entered — house points and results together, see below. |
| **Event sheets** | Printable recording sheets — see below. |
| **District** | The interesting one — see below. |
| **Sync** | Optional Supabase backend, so the data is not trapped in one browser — see below. |

## Event sheets

One sheet per event and division, with every student in that division already listed by house,
numbered, with blank **Result** and **Place** columns and lines for the marshal's name and the date.
Filter to a single event, year or gender, or print the whole carnival at once.

**One sheet is exactly one A4 page.** A division bigger than a page — most of them, at around 60
students — carries on across numbered sheets (*sheet 1 of 2*), each with its own heading and marshal
line, so nothing runs off the bottom. Rows per page is adjustable up to 34, which is the most that
clears an A4 text area at the print sizes in `src/styles.css`.

**Write-in rows** are blank numbered lines at the end of the last sheet for anyone not on the list —
a late entry, or a student who's moved class. Four by default.

**Sheet numbers.** Every sheet carries a number in a box at the top. Type it into the box on the
Results tab and it jumps straight to that event and division, so results come off paper without
hunting through dropdowns — and the Results list is in the same house-then-name order as the sheet,
so you can type straight down the page. The number identifies the event and division, not the piece
of paper, so a division spanning two pages shows the same number on both.

Only divisions that have students in them are numbered, so every number resolves to a real list and
the range stays short — a Prep–6 school running the default program with boys' and girls' divisions
in Years 3–6 gets 1–72. The trade-off is that numbers shift if a division goes from empty to
populated, so **load the class list before printing sheets**.

- **Print / save as PDF** opens the browser print dialog — pick *Save as PDF* there for a file.
- **Fill in the results already recorded** switches the same sheets from blank to completed, in
  placing order — handy for pinning up results or filing them after the carnival.
- **Download these sheets as CSV** / **Download all results as CSV** for anything you'd rather do
  in Excel.

## Entering the sheets — the Results tab

Teachers hand in the paper; this is where it goes. Type the sheet number off the top of the sheet
and you land on that event and division.

**House points for this sheet** takes how many competed from **each house** — a count, not a list of
names, because the sheet has the whole division on it but absences and non-starters mean only the
marshal knows who actually ran. That is **1 point each**. **Fill from class list** sets the counts to
the full division if everyone turned up, ready to adjust down.

**Placings** are marked in the **Place** column of the sheet itself — read down the paper and put a
1, 2, 3 or 4 against the placegetters. They score **4 / 3 / 2 / 1** on top. A student can hold only
one place and a place only one student, so re-using either simply moves it; duplicates cannot be
created.

Leave the column alone and the places are worked out instead by ranking whatever results have been
typed in the Result column, showing greyed in Place as a suggestion. Mark one place by hand and the
marked set takes over. Either way of working scores the same.

The per-sheet table shows exactly what that sheet is worth per house, so it can be checked against
the paper before moving on. The scheme itself is editable on the Houses tab.

**Checking every sheet is in.** The top of the tab tracks *n of 72 sheets entered* with a progress
bar; **which ones?** lists every outstanding sheet by number and event, each with a button that
opens it. When the last one lands it reads *all in ✓*.

## Picking the district team

Every event and division sends its top finisher (configurable), but no student may run more than
**two individual events**. Relays sit outside the cap.

When someone wins more than two, the tab flags them and asks which two they'll run. Every event
they let go is offered to the next finisher — who may now be over the cap themselves, so it
cascades until it settles. Change a pick and the team sheet re-derives instantly; **How the spots
moved** shows who was passed over and why.

So a student who wins six events picks two, and the other four go to the runners-up automatically
rather than being worked out by hand.

## Sync (Supabase)

Optional. Without it the tool is browser-only, which is fine for one person but means the data lives
in exactly one place. Turning it on gives you a shared copy that survives a cleared browser and lets
a second scoring desk work at the same time.

**Setting it up**

1. Create a project at [supabase.com](https://supabase.com), region **Sydney (ap-southeast-2)**.
2. **SQL Editor** → paste in [`supabase.sql`](supabase.sql) → Run. Safe to re-run.
3. **Settings → API** → copy the **Project URL** and the **anon / publishable** key into the Sync tab.
   Never paste the `service_role` key — it ends up in the page.
4. Press **Upload this browser to Supabase** once, from the machine that has the data.
5. On every other device, paste the same two values and press **Connect and pull**.

**How it behaves**

- The browser stays the working copy. Everything renders locally, so the tool keeps going on an oval
  with no signal and catches up when it comes back.
- Edits go up about a second after you stop typing, **row by row**. Two people entering different
  sheets never overwrite each other.
- Other people's changes arrive within about ten seconds, and only when you have nothing unsent, so
  a pull cannot land on top of your work.
- For the same row, last save wins.

It uses the PostgREST API over `fetch` rather than bundling `supabase-js`, so `index.html` stays
self-contained and the only host it ever contacts is your own project.

**Guard rails.** Sync moves data both ways, and both directions can destroy a class list:

- *Connect and pull* replaces this browser with the server. Pointing a browser that holds the only
  copy at a project that has never been seeded would empty it, so any pull that would wipe a
  populated students, results or sheets list now asks first and names what would be lost.
- A push sends deletions too, so a synced browser that ends up empty would take the server down with
  it. Run [`supabase-protect.sql`](supabase-protect.sql) after the main schema: it revokes delete on
  students, houses and events from `anon`, and archives every deleted row into `deleted_rows` with
  the SQL to put them back. Results and sheets keep delete, because clearing a result removes its
  row. The trade is that removing a student is then done in the Supabase table editor rather than in
  the app.

**Who can read it.** The schema ships with row-level security on and policies that grant the `anon`
role full read and write — the no-login model. Anyone with the site URL and the key in it can read
and change every row. Mitigate by putting the site behind Netlify's password protection (Site
settings → Access & security). To tighten properly later, change `to anon` to `to authenticated` in
the policies at the bottom of `supabase.sql` and add Supabase Auth; no schema change is needed.

## Backups — read this one

With sync off, everything is stored in **one browser, on one address**, via `localStorage`, and
nothing is sent anywhere. That has consequences worth knowing before carnival day:

- Clearing browsing data erases it.
- It does not follow you to another computer, or to another browser on the same computer.
- **A different URL is a different store.** Dragging the file onto Netlify Drop again creates a
  *new* site with a *new* address, which starts empty — the old address still holds the data. To
  update an existing site, use its own **Deploys** page rather than Netlify Drop.

**Import → Backup and restore** downloads one file with everything in it — students, houses, events,
results, participation counts and settings — and restores it on any machine. Take one at the end of
every session. **Erase all data** offers a backup before it wipes.

Two safeguards sit behind that: nothing is written to storage on page load, so a failed read can
never overwrite good data with an empty one; and text that won't parse is kept under
`<key>__unreadable` rather than discarded.

Class lists are **not** committed to this repo (see `.gitignore`) and should not be. Use first name
plus surname initial. A deployed Netlify URL is publicly reachable by anyone who has the link, so
don't import a real class list into a public deploy — either keep it to your own machine, or put
the site behind Netlify's password protection first.

---

# Aide Timetable — weekly aide + yard duty planner

A standalone React tool (same family and aesthetic as **Chunk & Check**) for planning a
week of education-support in a Victorian primary school, then running each day as it
actually happens.

**File:** `Aide_Timetable_Creator.jsx` — a single default-exported `App` component.
Paste it into a claude.ai artifact (like the Chunk & Check planner) or drop it into any
React project. No build config needed; data persists via `window.storage` on claude.ai
and `localStorage` everywhere else.

> **Prototype status:** single-browser demo. Logins, notifications and the urgent alert
> are simulated — there is no server, so nothing is shared between devices or actually
> sent to anyone. Use first names + initial only; no real student data. A real
> multi-user rollout needs a school-approved, Australian-hosted service.

## Roles

| Role | Login | What they see |
| --- | --- | --- |
| **Admin** | Passcode (first login sets it; changeable in Settings) | Everything below, plus **Insights** (patterns over time) and **Settings** (passcode, urgent-alert group, privacy, erase-all). |
| **Aide** | Tap their name | **My day** — their sessions/breaks/yard duty for the chosen day with day-of changes highlighted, tap-to-open student profiles, a per-session **Reflect** button (engagement + regulation 1–5 and a note), quick **+ Update / tag a student**, and the recent-notes strip. **My week** — their base week. |
| **Teacher** | Tap their class | **My class** — each supported student's aide sessions today (who, when, which subject), absence state, profile access, and this week's updates on their students. |

All three get the **🔔 bell** (timetable changes, updates, reflections and urgent alerts
relevant to them, with an unread badge) and the **⚠ Urgent** button — a clearly-labelled
simulated alert that names the notify group set in Settings, logs to every feed, and
flags the student. Student **profiles** carry strategies that work, IEP goals
(admin-editable), recent updates, and how sessions have felt.

## Admin tabs

| Tab | What it does |
| --- | --- |
| **Team** | Aides (name, which days they work, notes) and students (class, ideal 50-min sessions/day, funded hours, priority subjects, the aides they work well with). Student cards show suggested support sessions computed from their class timetable. A *load sample data* link shows the tool working instantly. |
| **Classes** | Year-level class timetables laid out like the paper timetable — days down the side, the six sessions (with recess and lunch) across the top. Typed by hand or imported. These label every cell of the week grid and drive suggestions. |
| **Week** | The base weekly grid, per day or whole week. **By student** (default) puts students down the side like the real timetable, each cell coloured by the aide supporting them; **By aide** shows aides × sessions/breaks and is where you assign — tap any cell to add students (best fits ranked with reasons). **✦ Suggest week** auto-fills: priority subjects first, preferred aides first, load balanced. Break columns hold break-time support or show yard duty. Printable. |
| **Today** | Day-to-day changes layered *over* the base week (the Week tab is untouched): toggle student/aide absences, red **needs cover** flags with one-tap hand-off to a free aide, and a note for things that pop up. Reset the day any time. |
| **Yard duty** | Areas × slots (before school, recess, both lunch halves, after school) × days. Pool = aides (on their working days, skipping break-time student support) + any extra staff. **✦ Suggest roster** balances duties fairly; a strip shows duties per person. Printable. |
| **Hours** | Per student: ideal vs planned vs this-week-after-changes vs funded hours, with progress bars. Per aide: sessions, break supports, yard duties. |
| **Import** | Pre-fills cells from pasted text or uploaded files (`.docx` / `.xlsx` / `.pdf` / images) via Claude, in three modes: aide + student pre-information, year-level class timetables, and a **current aide timetable** — an existing roster is read straight into the Week grid, creating any aides/students it mentions (aides get the days they appear on) and filling on top of existing cells. Everything previews before it applies. |
