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
| **Classes** | Year-level class timetables on the six-session day (S1–2 · recess · S3–4 · lunch · S5–6). Typed by hand or imported. These label every cell of the week grid and drive suggestions. |
| **Week** | The base weekly grid — aides × sessions/breaks, per day or whole week. **✦ Suggest week** auto-fills it: priority subjects first, preferred aides first, load balanced. Tap any cell to assign students (best fits ranked with reasons). Break columns hold break-time student support or show yard duty. Printable. |
| **Today** | Day-to-day changes layered *over* the base week (the Week tab is untouched): toggle student/aide absences, red **needs cover** flags with one-tap hand-off to a free aide, and a note for things that pop up. Reset the day any time. |
| **Yard duty** | Areas × slots (before school, recess, both lunch halves, after school) × days. Pool = aides (on their working days, skipping break-time student support) + any extra staff. **✦ Suggest roster** balances duties fairly; a strip shows duties per person. Printable. |
| **Hours** | Per student: ideal vs planned vs this-week-after-changes vs funded hours, with progress bars. Per aide: sessions, break supports, yard duties. |
| **Import** | Pre-fills cells from pasted text or uploaded files (`.docx` / `.xlsx` / `.pdf` / images) via Claude, in three modes: aide + student pre-information, year-level class timetables, and a **current aide timetable** — an existing roster is read straight into the Week grid, creating any aides/students it mentions (aides get the days they appear on) and filling on top of existing cells. Everything previews before it applies. |
