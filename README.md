# CPS standalone tools — Chunk & Check family

Standalone React tools in the same family and aesthetic as **Chunk & Check**. Each file is a
single default-exported `App` component — paste it into a claude.ai artifact (like the Chunk &
Check planner) or drop it into any React project. No build config needed; data persists via
`window.storage` on claude.ai and `localStorage` everywhere else, with JSON Backup/Restore in
every header as belt-and-braces.

## The grouping family

Four tools built from the B9 "Groupings and pairings" section of the CPS Practice & Platform
master doc. They share one **grouping-data JSON** shape (`{ students: [...], socio: {...} }`):
capture the roster and friendship nominations once in the Sociogram, **Export grouping data**,
and import the file into any of the other three (students are matched by name, so enriched
rosters aren't duplicated). Every generated grouping supports **manual override with
re-balance** (move or 🔒 lock any student, then re-suggest around the locks) and **constraint
transparency** (a Review surface showing which constraints were satisfied and which were
traded off).

| File | Tool | What it does |
| --- | --- | --- |
| `Sociogram.jsx` | **Sociogram** | The shared data layer. Students nominate up to N classmates they'd choose to work with (plus optional *prefers apart*). The Map draws a force-directed sociogram — mutual choices as solid coloured links, one-way choices as light arrows, mutual-friendship clusters coloured, isolates ringed red, node size by times-chosen, drag to tidy. Insights lists mutual pairs, stars, isolates, students with no mutual friendships, clusters and prefers-apart flags. |
| `Class_Creator.jsx` | **Class Creator** | Next year's classes from cohort data. Cohort tab holds curriculum levels (Reading/Writing/Maths), learning needs, strengths; Constraints tab holds the new classes + teachers, keep-together pairs, must-separate pairs and student→teacher recommendations. **✦ Suggest classes** balances levels, needs, gender and size while honouring constraints and trying to land everyone a chosen friend. Review shows every constraint ✓/✗, friend coverage, a balance table against the cohort mean, and printable class lists. Import tab reads cohort data from pasted text or uploaded `.docx`/`.xlsx`/`.pdf`/images via Claude (previewed before it applies), and imports/exports grouping data. |
| `Camp_Cabin_Creator.jsx` | **Cabin Creator** | Camp cabin lists. Campers carry gender, class, friend nominations and medical/needs notes; cabins carry a capacity and type (Girls/Boys/Mixed), or are auto-generated from the roster. **✦ Suggest cabins** gives everyone at least one chosen friend where possible (with a move-then-swap rescue pass), enforces separations, respects capacity and cabin type. Prefers-apart nominations imported from the Sociogram are offered as separations. Review shows separations, friend coverage, capacity/type checks and printable cabin lists with medical flags for the camp folder. |
| `Activity_Group_Creator.jsx` | **Activity Groups** | Camp and classroom activity groups. Each activity carries its own number of groups and its own grouping. Two build modes: **Keep a friend close** (everyone lands with a chosen friend where possible) and **Mix it up** (spread classes and friendship clusters, prefer fresh partners across the other activities). Separations hold in both modes. Review reports per activity plus a program-wide "fresh faces" percentage. |

## Learning support

| File | Tool | What it does |
| --- | --- | --- |
| `Aide_Timetable_Creator.jsx` | **Aide Timetable** | Weekly aide + yard duty planner. Team (aides + supported students), year-level class timetables, a suggest-and-tune week grid, day-to-day overrides for absences and cover, fair yard-duty rostering, per-student hours tracking, and AI import of pre-information, class timetables or an existing roster. See the tabs table below. |

### Aide Timetable tabs

| Tab | What it does |
| --- | --- |
| **Team** | Aides (name, which days they work, notes) and students (class, ideal 50-min sessions/day, funded hours, priority subjects, the aides they work well with). Student cards show suggested support sessions computed from their class timetable. A *load sample data* link shows the tool working instantly. |
| **Classes** | Year-level class timetables on the six-session day (S1–2 · recess · S3–4 · lunch · S5–6). Typed by hand or imported. These label every cell of the week grid and drive suggestions. |
| **Week** | The base weekly grid — aides × sessions/breaks, per day or whole week. **✦ Suggest week** auto-fills it: priority subjects first, preferred aides first, load balanced. Tap any cell to assign students (best fits ranked with reasons). Break columns hold break-time student support or show yard duty. Printable. |
| **Today** | Day-to-day changes layered *over* the base week (the Week tab is untouched): toggle student/aide absences, red **needs cover** flags with one-tap hand-off to a free aide, and a note for things that pop up. Reset the day any time. |
| **Yard duty** | Areas × slots (before school, recess, both lunch halves, after school) × days. Pool = aides (on their working days, skipping break-time student support) + any extra staff. **✦ Suggest roster** balances duties fairly; a strip shows duties per person. Printable. |
| **Hours** | Per student: ideal vs planned vs this-week-after-changes vs funded hours, with progress bars. Per aide: sessions, break supports, yard duties. |
| **Import** | Pre-fills cells from pasted text or uploaded files (`.docx` / `.xlsx` / `.pdf` / images) via Claude, in three modes: aide + student pre-information, year-level class timetables, and a **current aide timetable** — an existing roster is read straight into the Week grid, creating any aides/students it mentions (aides get the days they appear on) and filling on top of existing cells. Everything previews before it applies. |

## Family conventions

Every tool shares the Chunk & Check design tokens (Plus Jakarta Sans display / Inter body, the
soft blue-on-slate palette, pill buttons, 18px-radius cards, the eight-colour level wheel), the
`load sample data` empty-state link, the `✦ Suggest` primary action, printable outputs with
`.no-print` chrome, autosave with a "Saved" pill, and header Backup/Restore JSON buttons.
