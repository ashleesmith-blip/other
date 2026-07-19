# Aide Timetable — weekly aide + yard duty planner

A standalone React tool (same family and aesthetic as **Chunk & Check**) for planning a
week of education-support in a Victorian primary school, then running each day as it
actually happens.

**File:** `Aide_Timetable_Creator.jsx` — a single default-exported `App` component.
Paste it into a claude.ai artifact (like the Chunk & Check planner) or drop it into any
React project. No build config needed; data persists via `window.storage` on claude.ai
and `localStorage` everywhere else.

## Tabs

| Tab | What it does |
| --- | --- |
| **Team** | Aides (name, which days they work, notes) and students (class, ideal 50-min sessions/day, funded hours, priority subjects, the aides they work well with). Student cards show suggested support sessions computed from their class timetable. A *load sample data* link shows the tool working instantly. |
| **Classes** | Year-level class timetables on the six-session day (S1–2 · recess · S3–4 · lunch · S5–6). Typed by hand or imported. These label every cell of the week grid and drive suggestions. |
| **Week** | The base weekly grid — aides × sessions/breaks, per day or whole week. **✦ Suggest week** auto-fills it: priority subjects first, preferred aides first, load balanced. Tap any cell to assign students (best fits ranked with reasons). Break columns hold break-time student support or show yard duty. Printable. |
| **Today** | Day-to-day changes layered *over* the base week (the Week tab is untouched): toggle student/aide absences, red **needs cover** flags with one-tap hand-off to a free aide, and a note for things that pop up. Reset the day any time. |
| **Yard duty** | Areas × slots (before school, recess, both lunch halves, after school) × days. Pool = aides (on their working days, skipping break-time student support) + any extra staff. **✦ Suggest roster** balances duties fairly; a strip shows duties per person. Printable. |
| **Hours** | Per student: ideal vs planned vs this-week-after-changes vs funded hours, with progress bars. Per aide: sessions, break supports, yard duties. |
| **Import** | Pre-fills cells from pasted text or uploaded files (`.docx` / `.xlsx` / `.pdf` / images) via Claude: one mode for aide + student pre-information, one for year-level class timetables. Everything previews before it applies. |
