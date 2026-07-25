# CPS standalone tools

Two standalone React tools in the **Chunk & Check** family. Each is a single
default-exported `App` component that can be pasted into a claude.ai artifact or
dropped into any React project, with a pre-built copy under `docs/` for GitHub Pages.

| Tool | Source | Hosted at |
| --- | --- | --- |
| **Aide Timetable** | `Aide_Timetable_Creator.jsx` | `docs/index.html` |
| **Lesson Co-Planner** | `Lesson_CoPlanner.jsx` | `docs/lessons/index.html` |

---

# Lesson Co-Planner — AI-assisted lesson planning

A minimalist co-planning tool (teacher + AI) that produces lesson plans in the CPS
explicit-teaching template: Hook/PK CFU → Learning Intention → SOLO Success
Criteria → Unpack → Chunk Examples (Show One / Try One per chunk) → CFU #1 →
Purposeful Task/s → Reflective Prompt → CFU #2 → Lesson-Specific Adjustments.

**The teacher provides** the lesson brief: lesson type, focus, year level, the
Learning Intention, the Core SC (one SOLO verb per chunk, with optional
microskills i / ii), the Core+ extension SC, the **context/lens** the content is
explored through (e.g. *Visit Melbourne brochures*), and the prior knowledge the
hook should retrieve.

**The AI co-plans the rest**, field by field or all at once (✦ Co-plan lesson):

- **Hook** — retrieval of the stated prior knowledge with a concrete displayable
  example and a named check method
- **Show One (I Do)** per chunk — a worked example grounded in the context, with
  microskills modelled in order and a think-aloud line
- **Try One (We Do)** per chunk — a mirrored student attempt; any Try One / CFU
  can be **reframed for a different check method** (mini whiteboards, Turn & Talk,
  cold call, warm call, gestures, entry/exit ticket, post-it… or a combination)
- **CFU #1** — a hinge question built to catch the likely misconception
- **Purposeful Task/s** — students showcase every Core SC in an engaging,
  context-rooted way, with a Core+ add-on (never modelled in the mini lesson)
- **Reflective Prompt** and **CFU #2**
- **Adjustments** — task-complexity ideas + ‘toolkit’ scaffolds per group

Every field supports **multiple generated options** (pick one, edit inline, ask
for another). Adjustment **groups are saved per subject** (Groups tab) and
pre-fill each lesson; Core− groups work towards the first 1–2 SC with scaffolds,
and an Extension (Core+) row is added automatically.

The **Output** view renders the plan as the familiar doc-style table and
**⧉ Copy for Google Docs** puts the formatted table on the clipboard, ready to
paste straight into the planning doc.

AI drafting works keyless inside claude.ai; on the hosted page add an Anthropic
API key in Settings (kept in the browser only). Plans persist via
`window.storage` on claude.ai and `localStorage` elsewhere. No student names
needed anywhere.

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
