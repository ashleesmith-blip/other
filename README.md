# Classroom tools

Two standalone tools live in this repo:

1. **Work Sample Analyser** (`work-sample-analyser/index.html`) — see below.
2. **Aide Timetable** (`Aide_Timetable_Creator.jsx`) — weekly aide + yard duty planner, documented further down.

---

# Work Sample Analyser — assess any work sample against your criteria

A single-file web app (`work-sample-analyser/index.html`) that analyses a **photo or PDF
of student work against any criteria or rubric** using the Claude API. Open the file in
any modern browser — no install, no build step, no server.

## How it works

1. **Set your criteria** — paste a rubric, list success criteria one per line, or start
   from a built-in preset (narrative writing, persuasive writing, maths problem solving,
   handwriting, science investigation). Choose a 3-point or 4-point rating scale, or let
   the analysis use the levels written in your own rubric. Optionally add year level,
   subject/task, and extra context (e.g. "EAL learner, completed independently").
2. **Add the work sample** — photos (JPG/PNG/WebP/GIF), PDFs, or **short videos**,
   multiple files supported, with drag-and-drop plus take-a-photo / record-a-video
   buttons on phones and tablets. Photos are downscaled in the browser before sending.
   Word docs: export as PDF first.
   - **Video:** still frames are sampled from the clip *in your browser* and analysed in
     time order, and speech is **transcribed on-device** with a local Whisper model
     (English; downloads once, ~40–80 MB; audio never leaves the computer — can be
     switched off or set to higher accuracy). The analysis then identifies **key
     moments** against your criteria, each with a timestamp, what happened/was said,
     and what it shows about the student. Timestamps are also cited in evidence and
     justifications. Keep clips short (~3 min or less); MP4 (H.264) decodes most
     reliably.
   - **Share for colleague feedback:** one click builds a self-contained **review pack**
     (a single HTML file with the work sample, video frames, transcript, criteria, and a
     structured feedback form). Send it to a colleague however you normally share files —
     they open it in any browser (no API key needed), write their feedback, and copy or
     download it to send back. Paste their feedback into "Extra context" to include it
     in the analysis. There is deliberately **no server or account system** — sharing is
     a file you control.
   - **Student self-assessment (optional step 3):** builds a rating + comment row per
     criterion for the student to complete, plus a reflection box. The analysis rates
     independently, then responds to the student's self-assessment — where their
     judgement matched, where it differed and why.
3. **Analyse** — the app calls Claude (vision + PDF understanding, structured JSON
   output) and renders, per criterion: a colour-coded rating, **specific evidence quoted
   from the work**, a **"Why this rating" justification** that links the evidence to the
   wording of the criterion or rubric level descriptor (moderation-style: why this level
   and not the one above/below), and feedback. Plus an overall summary, strengths, areas
   for growth, concrete next-steps for teaching, and a short warm comment written to the
   student. Results can be copied as text or printed / saved as PDF.

## Setup

You need an Anthropic API key (platform.claude.com). Click **API key…** in the app —
the key is stored only in your browser's localStorage and sent only to
`api.anthropic.com`.

> **Notes for school use:** the AI analysis is a starting point for professional
> judgement, not a replacement for it. Avoid uploading samples containing sensitive
> personal information, and check your school/department policy on AI tools before
> using it for formal assessment. Some school networks block `api.anthropic.com`.

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
| **Classes** | Year-level class timetables on the six-session day (S1–2 · recess · S3–4 · lunch · S5–6). Typed by hand or imported. These label every cell of the week grid and drive suggestions. |
| **Week** | The base weekly grid — aides × sessions/breaks, per day or whole week. **✦ Suggest week** auto-fills it: priority subjects first, preferred aides first, load balanced. Tap any cell to assign students (best fits ranked with reasons). Break columns hold break-time student support or show yard duty. Printable. |
| **Today** | Day-to-day changes layered *over* the base week (the Week tab is untouched): toggle student/aide absences, red **needs cover** flags with one-tap hand-off to a free aide, and a note for things that pop up. Reset the day any time. |
| **Yard duty** | Areas × slots (before school, recess, both lunch halves, after school) × days. Pool = aides (on their working days, skipping break-time student support) + any extra staff. **✦ Suggest roster** balances duties fairly; a strip shows duties per person. Printable. |
| **Hours** | Per student: ideal vs planned vs this-week-after-changes vs funded hours, with progress bars. Per aide: sessions, break supports, yard duties. |
| **Import** | Pre-fills cells from pasted text or uploaded files (`.docx` / `.xlsx` / `.pdf` / images) via Claude, in three modes: aide + student pre-information, year-level class timetables, and a **current aide timetable** — an existing roster is read straight into the Week grid, creating any aides/students it mentions (aides get the days they appear on) and filling on top of existing cells. Everything previews before it applies. |
