# CPS staff tools

Two standalone React tools (same family and aesthetic as **Chunk & Check**). Each is a
single default-exported `App` component — paste into a claude.ai artifact or drop into
any React project. Data persists via `window.storage` on claude.ai and `localStorage`
everywhere else.

---

# VIT Inquiry Hub — graduate-to-full-registration companion

**File:** `VIT_Inquiry_Platform.jsx`

Walks a graduate teacher through the entire VIT inquiry project — tracking, data
collection, evidence recording and the write-up itself — modelled on a real completed
project's structure.

> **Prototype status:** single-browser demo — nothing is shared between devices.
> Refer to students as Student A/B/C only; export regularly into your official VIT Doc.

| Tab | What it does |
| --- | --- |
| **Overview** | Teacher/school/question settings, live progress against every VIT requirement (2+ observations, 3+ conversations, 3 mentor visits, baseline→summative data, all 37 descriptors…), a "suggested next step" nudge and per-section completion bars. |
| **Write-Up** | Every prose part of Sections 1, 2, 3 and 5 as a guided form — what VIT wants, a worked-example excerpt, word count, mark-done. Parts that compile from elsewhere (focus learners, PD sessions, checkpoints) say so. |
| **Evidence Log** | Structured capture with the exact template fields: colleague observations (2bii), professional conversations (2biii), mentor visits (4a) — each with date, VIT reg no. and a signature-obtained flag — plus PD sessions (3c) and lesson reflections (3j) with a proven prompt set. |
| **Learners & Data** | Focus students (below / at / above / EAL) with de-identified profiles, and assessment checkpoints — baseline (pre) → weekly formative → summative (post) — scored per student, with a growth summary table. |
| **Standards** | All 37 APST Proficient descriptors with live coverage. References typed by hand or picked up automatically from appendix annotations; VIT needs all 37 evidenced. |
| **Appendices** | Evidence items annotated per descriptor: *"This evidence demonstrates X because…"* plus a first-person annotation — feeding the Standards coverage and the export. |
| **Export** | The whole project compiled in official write-up order — contents page with descriptor references, Sections 1–6, every logged entry and checkpoint — copy as text or print to PDF. Gaps are flagged (`NOT YET EVIDENCED`, `SIGNATURE NEEDED`). |

Supports multiple projects in one browser (e.g. a mentor supporting several graduates)
via the header project switcher.

---

# Aide Timetable — weekly aide + yard duty planner

**File:** `Aide_Timetable_Creator.jsx`

For planning a week of education-support in a Victorian primary school, then running
each day as it actually happens.

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
