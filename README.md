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
| **Houses** | House cards with student counts and live points (3/2/1 for the first three places in every event and division), plus a ranked bar chart. |
| **Students** | The whole list, filterable by year, house and name. Year level, gender, house and beep test are all editable straight in the table. **Change a whole group at once** moves a homegroup, a year level, everyone currently shown by the filters, or everyone missing a year level — for rollover, or when a homegroup code didn't give the right year on import. |
| **Import** | Paste four columns out of Excel — **Name, Gender, Homegroup, House** — or load a `.json`/`.csv`. Year level is read from the homegroup code (`I3P` → 3), houses named in the file are created if they don't exist, and re-importing skips anyone already on the list. Everything previews before it applies. There's a download button here to back the list up. |
| **Results** | Pick event + year + gender and type times down the list. Placings rank themselves as you type, first three shaded. Handles `m:ss.s` for the 800m and 1500m. |
| **Event sheets** | Printable recording sheets — see below. |
| **District** | The interesting one — see below. |

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

- **Print / save as PDF** opens the browser print dialog — pick *Save as PDF* there for a file.
- **Fill in the results already recorded** switches the same sheets from blank to completed, in
  placing order — handy for pinning up results or filing them after the carnival.
- **Download these sheets as CSV** / **Download all results as CSV** for anything you'd rather do
  in Excel.

## Picking the district team

Every event and division sends its top finisher (configurable), but no student may run more than
**two individual events**. Relays sit outside the cap.

When someone wins more than two, the tab flags them and asks which two they'll run. Every event
they let go is offered to the next finisher — who may now be over the cap themselves, so it
cascades until it settles. Change a pick and the team sheet re-derives instantly; **How the spots
moved** shows who was passed over and why.

So a student who wins six events picks two, and the other four go to the runners-up automatically
rather than being worked out by hand.

## Privacy

Everything is stored in one browser via `localStorage` — nothing is sent anywhere, and there is no
server or login. That also means it isn't shared between devices, and clearing your browsing data
erases it, so use the download button on the Import tab to keep a backup.

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
