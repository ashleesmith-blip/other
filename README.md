# CPS staff tools

Two standalone React tools (same family and aesthetic as **Chunk & Check**). Each is a
single default-exported `App` component — paste into a claude.ai artifact or drop into
any React project. Data persists via `window.storage` on claude.ai and `localStorage`
everywhere else.

---

# VIT Inquiry Hub — graduate registration platform

**File:** `VIT_Inquiry_Platform.jsx`

A **role-based platform** for running the whole VIT inquiry program: graduates build
their project, mentors give feedback, and a coordinator (admin) oversees everyone
against a shared timeline. Modelled on a real completed VIT project's structure.

> **Prototype status — read this.** This is a single-browser demo: logins are
> *simulated* and every account shares one browser's storage. It shows the full
> platform experience (roles, oversight, feedback, timeline) but does **not** sync
> across devices or truly separate users. A real staff rollout needs a school-approved,
> **Australian-hosted backend with real authentication** — this UI is built to drop
> onto one with no redesign. Refer to students as Student A/B/C only; export regularly.

## Roles

| Role | Home screen | Can do |
| --- | --- | --- |
| **Admin** (coordinator) | Program dashboard over *every* graduate — completion %, standards coverage, mentor visits, overdue milestones | Open any project (read + feedback), manage staff & mentor assignments (**Users** tab), set the program **Timeline** and due dates |
| **Mentor** | Just the graduates assigned to them, same progress cards | Open their graduates' projects, leave **feedback** on any section or tab, read the evidence log |
| **Graduate** | Their own inquiry workspace (the nine tabs below) | Build everything, upload & auto-file evidence, read and reply to mentor feedback |

Log in from the account picker (or **Load a sample program** — admin + 2 mentors + 3
graduates — to see it populated instantly).

## The graduate workspace

| Tab | What it does |
| --- | --- |
| **Overview** | School/question settings, live progress against every VIT requirement, overdue/due-soon banner, a "suggested next step" nudge and per-section bars. |
| **Write-Up** | Every prose part of Sections 1, 2, 3 and 5 as a guided form — what VIT wants, a worked-example excerpt, word count, mark-done, **plus a mentor-feedback thread on each part**. Parts that compile from elsewhere say so. |
| **Evidence Log** | Structured capture with the exact template fields: colleague observations (2bii), professional conversations (2biii), mentor visits (4a) — each with date, VIT reg no. and a signature flag — plus PD (3c) and lesson reflections (3j). |
| **Learners & Data** | Focus students (below / at / above / EAL) with de-identified profiles, and assessment checkpoints — baseline → formative → summative — scored per student, with a growth summary table. |
| **AITSL Standards** | All 37 APST Proficient descriptors with live coverage; references typed by hand or picked up automatically from appendix annotations. |
| **Appendices** | Evidence items annotated per descriptor (*"This evidence demonstrates X because…"*), feeding Standards coverage and the export. |
| **Import** | **Upload → auto-file.** Drop in a report, work sample, rubric, lesson plan or notes (`.docx` / `.xlsx` / `.pdf` / image / text); Claude reads it, proposes where it belongs (a write-up part, an appendix + descriptor annotations, a checkpoint, or the evidence log) and files it on confirm. |
| **Timeline** | The shared program schedule — every milestone shown as done / due-soon / overdue against the admin's due dates. |
| **Export** | The whole project compiled in official write-up order — contents page with descriptor references, Sections 1–6, every logged entry and checkpoint. Copy as text or print to PDF; gaps flagged (`NOT YET EVIDENCED`, `SIGNATURE NEEDED`). |

Mentors and admin see the same tabs in **review mode** — content is read-only, and a
feedback thread appears on every section and tab.

### Aesthetic

Built in the Chunk & Check / Aide Timetable design language (Plus Jakarta Sans + Inter,
soft-blue palette, rounded cards). Not yet matched to CurricHub — share a screenshot to
retune the colours and type.

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
