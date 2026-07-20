import React, { useState, useEffect, useRef } from "react";

/* ============================================================
   AIDE TIMETABLE — weekly aide + yard duty planner
   CPS · Learning Support · standalone tool

   · Aides carry the days they work; the grid greys the rest
   · Students carry an ideal number of 50-minute sessions per
     day, optional funded hours, priority subjects and the
     aides they work well with
   · Year-level class timetables (typed, pasted or uploaded)
     drive per-session subject labels and support suggestions
   · Suggest Week auto-fills the grid: priority subjects first,
     preferred aides first, load balanced across the team
   · Recess + lunch are first-class columns — an aide is on a
     break, on yard duty (linked from the Yard tab) or
     supporting a student through the break
   · Today tab layers day-to-day changes over the base week:
     student absences, aide absences, one-tap cover, and a
     note for things that pop up — the base week is untouched
   · Hours tab tracks planned vs ideal vs funded minutes per
     student, and load per aide
   · Import tab pre-fills aides / students / class timetables
     from pasted text or uploaded files (docx/xlsx/pdf/image)
   · Yard duty: areas × slots × days, auto-filled fairly,
     aware of aide days and break-time student support
   · Aesthetic + patterns lifted from Chunk & Check
   ============================================================ */

/* ---------- misc helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const hrs = (mins) => (mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h ${mins % 60}m`);

/* ---------- persistence — window.storage on claude.ai, localStorage elsewhere ---------- */
const store = {
  async get(k) {
    if (typeof window !== "undefined" && window.storage) {
      try { const r = await window.storage.get(k); return r?.value ?? null; } catch { return null; }
    }
    try { return localStorage.getItem(k); } catch { return null; }
  },
  async set(k, v) {
    if (typeof window !== "undefined" && window.storage) {
      try { await window.storage.set(k, v); return; } catch {}
    }
    try { localStorage.setItem(k, v); } catch {}
  },
};

/* ---------- Anthropic API helper ----------
   Keyless works inside claude.ai (proxied). Everywhere else (Netlify etc.)
   an API key from Settings is sent browser-direct. */
let API_KEY = "";
async function askClaude(messages, maxTokens = 1000) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: maxTokens, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
const parseJSON = (text) => JSON.parse(text.replace(/```json|```/g, "").trim());

/* ---------- context file extraction (txt/docx/xlsx direct · pdf/images via Claude) ---------- */
const fileToBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(new Error("Read failed"));
  r.readAsDataURL(file);
});
const fileToText = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result || ""));
  r.onerror = () => rej(new Error("Read failed"));
  r.readAsText(file);
});
async function extractSourceText(file) {
  const name = (file.name || "").toLowerCase();
  const ext = name.split(".").pop();
  if (["txt", "md", "csv", "tsv"].includes(ext) || file.type.startsWith("text/")) return await fileToText(file);
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const buf = await file.arrayBuffer();
    return (await mammoth.extractRawText({ arrayBuffer: buf })).value || "";
  }
  if (["xlsx", "xls"].includes(ext)) {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    return wb.SheetNames.map((sn) => `--- Sheet: ${sn} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`).join("\n\n");
  }
  if (ext === "pdf" || file.type === "application/pdf") {
    const b64 = await fileToBase64(file);
    return await askClaude([{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
      { type: "text", text: "Extract ALL the text from this document verbatim, preserving structure. Output ONLY the extracted text." },
    ] }], 4000);
  }
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext) || file.type.startsWith("image/")) {
    const media = file.type?.startsWith("image/") ? file.type : ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[ext] || "image/png");
    const b64 = await fileToBase64(file);
    return await askClaude([{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: media, data: b64 } },
      { type: "text", text: "Transcribe ALL text and tables visible in this image verbatim, preserving row/column structure. Output ONLY the transcription." },
    ] }], 4000);
  }
  throw new Error(`Can't read .${ext} — use .docx, .xlsx, .pdf, an image, or paste the text.`);
}

/* ---------- design tokens (Chunk & Check) ---------- */
const T = {
  bg: "#F6F8FB", card: "#FFFFFF", line: "#E6EBF2", lineSoft: "#EEF2F7",
  ink: "#0F172A", sub: "#64748B", faint: "#94A3B8",
  blue: "#2563EB", blueDeep: "#1D4ED8", blueSoft: "#EFF6FF", blueLine: "#BFDBFE",
  amber: "#B45309", amberSoft: "#FFFBEB", amberLine: "#FDE68A",
  green: "#047857", greenSoft: "#ECFDF5", greenLine: "#A7F3D0",
  red: "#B91C1C", redSoft: "#FEF2F2", redLine: "#FECACA",
  shadow: "0 1px 2px rgba(15,23,42,.05), 0 4px 14px rgba(15,23,42,.05)",
  shadowLift: "0 2px 4px rgba(15,23,42,.06), 0 10px 30px rgba(15,23,42,.09)",
};
const F = {
  display: "'Plus Jakarta Sans', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
};
const S = {
  card: { background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, boxShadow: T.shadow, padding: 18 },
  eyebrow: { fontFamily: F.body, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.faint },
  pill: {
    display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "6px 14px",
    background: T.card, border: `1px solid ${T.line}`, boxShadow: "0 1px 2px rgba(15,23,42,.05)",
    fontFamily: F.body, fontSize: 12.5, fontWeight: 600, color: T.ink, whiteSpace: "nowrap",
  },
  btn: {
    cursor: "pointer", border: "none", borderRadius: 999, padding: "9px 18px",
    background: T.blue, color: "#FFFFFF", fontFamily: F.body, fontSize: 13, fontWeight: 700,
    boxShadow: "0 1px 2px rgba(37,99,235,.35), 0 6px 16px rgba(37,99,235,.25)",
  },
  btnGhost: {
    cursor: "pointer", borderRadius: 999, padding: "8px 16px",
    background: T.card, color: T.ink, border: `1px solid ${T.line}`,
    fontFamily: F.body, fontSize: 12.5, fontWeight: 600, boxShadow: "0 1px 2px rgba(15,23,42,.05)",
  },
  input: {
    width: "100%", borderRadius: 12, border: `1px solid ${T.line}`, padding: "10px 12px",
    fontFamily: F.body, fontSize: 13.5, color: T.ink, background: T.card, outline: "none",
  },
  label: { fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6, display: "block" },
};
const Pill = ({ children, tone = "plain", style = {} }) => {
  const tones = {
    plain: {},
    blue: { background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep },
    amber: { background: T.amberSoft, borderColor: T.amberLine, color: T.amber },
    green: { background: T.greenSoft, borderColor: T.greenLine, color: T.green },
    red: { background: T.redSoft, borderColor: T.redLine, color: T.red },
    ink: { background: T.ink, borderColor: T.ink, color: "#FFFFFF" },
  };
  return <span style={{ ...S.pill, ...tones[tone], ...style }}>{children}</span>;
};
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; }
  button:hover { filter: brightness(0.97); }
  button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${T.blue}; outline-offset: 2px; }
  input::placeholder, textarea::placeholder { color: ${T.faint}; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  @media print {
    .no-print { display: none !important; }
    body { background: #FFF; }
  }
`;
const Toggle = ({ on, onClick, children }) => (
  <button onClick={onClick} style={{
    ...S.btnGhost, padding: "5px 12px", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 6,
    ...(on ? { background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep } : { color: T.sub }),
  }}>
    <span style={{
      width: 22, height: 13, borderRadius: 999, position: "relative", flex: "0 0 auto",
      background: on ? T.blue : "#CBD5E1", transition: "background .15s",
    }}>
      <span style={{ position: "absolute", top: 1.5, left: on ? 11 : 1.5, width: 10, height: 10, borderRadius: 999, background: "#FFF", transition: "left .15s" }} />
    </span>
    {children}
  </button>
);

/* ---------- allocated aide colours — same wheel as Chunk & Check levels ---------- */
const AIDE_COLORS = [
  { main: "#3B82F6", text: "#1D4ED8", soft: "#EFF6FF", line: "#BFDBFE", on: "#FFFFFF" }, // blue
  { main: "#22C55E", text: "#15803D", soft: "#F0FDF4", line: "#BBF7D0", on: "#FFFFFF" }, // green
  { main: "#EC4899", text: "#BE185D", soft: "#FDF2F8", line: "#FBCFE8", on: "#FFFFFF" }, // pink
  { main: "#F97316", text: "#C2410C", soft: "#FFF7ED", line: "#FED7AA", on: "#FFFFFF" }, // orange
  { main: "#6366F1", text: "#4338CA", soft: "#EEF2FF", line: "#C7D2FE", on: "#FFFFFF" }, // indigo
  { main: "#14B8A6", text: "#0F766E", soft: "#F0FDFA", line: "#99F6E4", on: "#FFFFFF" }, // teal
  { main: "#EAB308", text: "#A16207", soft: "#FEFCE8", line: "#FDE68A", on: "#422006" }, // yellow
  { main: "#EF4444", text: "#B91C1C", soft: "#FEF2F2", line: "#FECACA", on: "#FFFFFF" }, // red
];
const aideColor = (i) => AIDE_COLORS[((i % AIDE_COLORS.length) + AIDE_COLORS.length) % AIDE_COLORS.length];

/* ---------- the school day ---------- */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_LABEL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
const BLOCKS = [
  { id: "s1", kind: "session", label: "Session 1", time: "9:00–9:50" },
  { id: "s2", kind: "session", label: "Session 2", time: "9:50–10:40" },
  { id: "recess", kind: "break", label: "Recess", time: "10:40–11:10" },
  { id: "s3", kind: "session", label: "Session 3", time: "11:10–12:00" },
  { id: "s4", kind: "session", label: "Session 4", time: "12:00–12:50" },
  { id: "lunch", kind: "break", label: "Lunch", time: "12:50–1:50" },
  { id: "s5", kind: "session", label: "Session 5", time: "1:50–2:40" },
  { id: "s6", kind: "session", label: "Session 6", time: "2:40–3:30" },
];
const SESSIONS = BLOCKS.filter((b) => b.kind === "session");
const SESSION_MIN = 50;

/* ---------- yard duty ---------- */
const YARD_SLOTS = [
  { id: "before", label: "Before school", time: "8:45–9:00" },
  { id: "recess", label: "Recess", time: "10:40–11:10" },
  { id: "lunch1", label: "Lunch · 1st half", time: "12:50–1:20" },
  { id: "lunch2", label: "Lunch · 2nd half", time: "1:20–1:50" },
  { id: "after", label: "After school", time: "3:30–3:45" },
];
const DEFAULT_AREAS = ["Oval", "Playground", "Courts", "Front gate"];
/* which yard slots overlap which break column in the week grid */
const BREAK_SLOTS = { recess: ["recess"], lunch: ["lunch1", "lunch2"] };

/* ---------- import prompts ---------- */
const PREINFO_PROMPT = `You are helping set up a primary-school aide timetable. From the source text below, extract every aide (education support staff member) and every supported student you can find. Respond with ONLY valid JSON, no prose, in exactly this shape:
{"aides":[{"name":"","days":["Mon","Tue","Wed","Thu","Fri"],"notes":""}],
 "students":[{"name":"","cls":"","year":"","idealPerDay":2,"fundedHrs":null,"prioritySubjects":[],"preferredAides":[],"notes":""}]}
Rules: days = only the weekdays the aide works (all five if unstated). cls = the student's class code, e.g. "3B". idealPerDay = ideal number of 50-minute support sessions per day (default 2 if unstated). fundedHrs = funded support hours per week as a number, or null. prioritySubjects = subjects/events where support matters most. preferredAides = names of aides the student works well with. Omit nothing you can infer; leave fields empty rather than guessing wildly.`;
const CLASSTT_PROMPT = `You are reading one or more primary-school class timetables. From the source text below, extract each class's weekly timetable mapped onto six 50-minute sessions per day (Session 1–2, recess, Session 3–4, lunch, Session 5–6). Respond with ONLY valid JSON, no prose, in exactly this shape:
{"classes":[{"name":"3B","year":"3","tt":{"Mon":["","","","","",""],"Tue":["","","","","",""],"Wed":["","","","","",""],"Thu":["","","","","",""],"Fri":["","","","","",""]}}]}
Rules: each day is an array of exactly 6 subject strings in session order (use "" for unknown). Fold double sessions into two identical entries. Use short subject names ("Reading", "Maths", "PE", "Art"). name = class code, year = year level.`;
const WEEKTT_PROMPT = `You are reading an existing primary-school aide / education-support timetable (any layout — grid, list, roster). Extract every support assignment you can find. Respond with ONLY valid JSON, no prose, in exactly this shape:
{"assignments":[{"day":"Mon","block":"s1","aide":"Karen M","students":["Archie B"]}]}
Rules: day = Mon/Tue/Wed/Thu/Fri. block = which part of the six-session day the assignment falls in: s1 (9:00–9:50), s2 (9:50–10:40), s3 (11:10–12:00), s4 (12:00–12:50), s5 (1:50–2:40), s6 (2:40–3:30), or "recess"/"lunch" for break-time support. Map times or period names onto the closest block; split double sessions or full mornings into one entry per block. aide = the staff member's name exactly as written. students = the supported student name(s) in that block (a class code like "3B" is NOT a student — skip entries with no identifiable student). One entry per aide per block per day; include every day you can find.`;

/* ---------- flags, reflections, urgent — quick tags for what's happening ---------- */
const FLAG_CATS = [
  { id: "heads-up", label: "Heads up", tone: "blue" },
  { id: "soft-signs", label: "Soft signs", tone: "amber" },
  { id: "behaviour", label: "Behavioural", tone: "red" },
  { id: "medical", label: "Medical", tone: "red" },
  { id: "positive", label: "Positive", tone: "green" },
];
const flagCat = (id) => FLAG_CATS.find((c) => c.id === id) || FLAG_CATS[0];
const URGENT_REASONS = ["Behavioural escalation", "Medical", "Safety concern", "Soft signs building up", "Other"];
const ASSIST_PROMPT = `You are helping run learning support (education support aides) at a Victorian government primary school. Using ONLY the people and constraints in the setup below, give practical suggestions for the problem. Rules: respect each aide's working days; prefer aides a student works well with; keep high-needs students covered first; name exactly who does what and when (which session/break). Offer 2-4 concrete options, best first, as short dot points with a one-line reason each. If information is missing, say what you'd need to know. You are advising, not deciding — the staff know the children.`;
const RATING = [1, 2, 3, 4, 5];
const RATING_LABEL = {
  engagement: ["Withdrawn", "Low", "Some", "Good", "Fully engaged"],
  regulation: ["Very dysregulated", "Struggling", "Some wobbles", "Mostly settled", "Calm & settled"],
};
const fmtWhen = (ts) => {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const days = Math.round((today - dd) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Yesterday · ${time}`;
  if (days > 1 && days < 7) return `${days}d ago · ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + ` · ${time}`;
};
const daysAgo = (n, h = 9) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.getTime(); };

/* ---------- sample data — a quick way to see the tool working ---------- */
const SAMPLE = () => {
  const a1 = uid(), a2 = uid(), a3 = uid();
  const s1 = uid(), s2 = uid(), s3 = uid(), s4 = uid();
  const mk = (days) => Object.fromEntries(DAYS.map((d) => [d, days.includes(d)]));
  const tt = (m, t, w, th, f) => ({ Mon: m, Tue: t, Wed: w, Thu: th, Fri: f });
  return {
    aides: [
      { id: a1, name: "Karen M", days: mk(DAYS), notes: "" },
      { id: a2, name: "Priya S", days: mk(["Mon", "Tue", "Wed"]), notes: "Mornings strongest" },
      { id: a3, name: "Jess T", days: mk(["Wed", "Thu", "Fri"]), notes: "" },
    ],
    students: [
      { id: s1, name: "Archie B", cls: "1A", year: "1", idealPerDay: 3, fundedHrs: 12, prioritySubjects: ["Reading", "Writing"], preferredAides: [a1], notes: "Visual timetable on desk",
        strategies: "First/then language. Offer 2 choices max. Visual timetable on desk, cross off as we go.",
        iepGoals: [{ id: uid(), goal: "Use a 3-word phrase to request a break", note: "Reviewed each term" }, { id: uid(), goal: "Independently follow a 3-step visual sequence", note: "" }] },
      { id: s2, name: "Billie K", cls: "3B", year: "3", idealPerDay: 2, fundedHrs: 8, prioritySubjects: ["Maths"], preferredAides: [a2, a1], notes: "",
        strategies: "Chunk instructions into single steps. Check in after 5 minutes of independent work.", iepGoals: [] },
      { id: s3, name: "Cooper D", cls: "5C", year: "5", idealPerDay: 4, fundedHrs: 16, prioritySubjects: ["Writing", "Maths"], preferredAides: [a2], notes: "Needs movement breaks",
        strategies: "Movement break every 20 mins. Fidget tool available. Give a 5-minute warning before transitions.",
        iepGoals: [{ id: uid(), goal: "Remain in learning space for 20-minute stretches", note: "Track with a visual timer" }] },
      { id: s4, name: "Daisy W", cls: "1A", year: "1", idealPerDay: 2, fundedHrs: null, prioritySubjects: ["Reading"], preferredAides: [a3], notes: "", strategies: "", iepGoals: [] },
    ],
    classes: {
      "1A": { year: "1", tt: tt(
        ["Reading", "Writing", "Maths", "PE", "Inquiry", "Library"],
        ["Reading", "Writing", "Maths", "Art", "Inquiry", "Health"],
        ["Reading", "Writing", "Maths", "Music", "Inquiry", "Play"],
        ["Reading", "Writing", "Maths", "PE", "Science", "Inquiry"],
        ["Reading", "Writing", "Maths", "Assembly", "Inquiry", "Sport"]) },
      "3B": { year: "3", tt: tt(
        ["Reading", "Writing", "Maths", "Applied Maths", "PE", "Inquiry"],
        ["Reading", "Writing", "Maths", "Applied Maths", "Art", "Health"],
        ["Reading", "Writing", "Maths", "Applied Maths", "Music", "Library"],
        ["Reading", "Writing", "Maths", "Applied Maths", "Science", "Inquiry"],
        ["Reading", "Writing", "Maths", "Assembly", "Inquiry", "Sport"]) },
      "5C": { year: "5", tt: tt(
        ["Writing", "Reading", "Maths", "Applied Maths", "Inquiry", "PE"],
        ["Writing", "Reading", "Maths", "Applied Maths", "Health", "Art"],
        ["Writing", "Reading", "Maths", "Applied Maths", "Library", "Music"],
        ["Writing", "Reading", "Maths", "Applied Maths", "Science", "Inquiry"],
        ["Writing", "Reading", "Maths", "Assembly", "Sport", "Inquiry"]) },
    },
    notifyGroup: ["Wellbeing Team", "Priya S"],
    flags: {
      [s3]: [
        { id: uid(), ts: daysAgo(6), day: "Wed", by: "Priya S", byRole: "aide", category: "soft-signs", text: "Fidgety and quiet before lunch, settled after a break." },
        { id: uid(), ts: daysAgo(3), day: "Mon", by: "Karen M", byRole: "aide", category: "positive", text: "Great focus through both writing sessions today." },
        { id: uid(), ts: daysAgo(1), day: "Thu", by: "Ms Nguyen", byRole: "teacher", category: "heads-up", text: "Assembly change today — may need extra warning before the transition." },
      ],
      [s1]: [
        { id: uid(), ts: daysAgo(4), day: "Fri", by: "Karen M", byRole: "aide", category: "positive", text: "Used his visual timetable independently all morning." },
      ],
    },
    reflections: [
      { id: uid(), ts: daysAgo(6, 10), day: "Wed", block: "s3", aideId: a2, studentId: s3, engagement: 2, regulation: 2, note: "Struggled to settle after recess, needed a movement break." },
      { id: uid(), ts: daysAgo(4, 9), day: "Mon", block: "s1", aideId: a2, studentId: s3, engagement: 4, regulation: 4, note: "Strong start, engaged with writing task." },
      { id: uid(), ts: daysAgo(2, 11), day: "Wed", block: "s3", aideId: a2, studentId: s3, engagement: 4, regulation: 3, note: "" },
      { id: uid(), ts: daysAgo(3, 9), day: "Mon", block: "s1", aideId: a1, studentId: s1, engagement: 5, regulation: 5, note: "Confident using his visual timetable unprompted." },
    ],
  };
};

/* ============================================================ */
export default function App() {
  /* core data */
  const [aides, setAides] = useState([]);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState({});      // { name: { year, tt: { Mon:[6], ... } } }
  const [plan, setPlan] = useState({});            // { `${day}|${blockId}|${aideId}`: [studentId,...] }
  const [yard, setYard] = useState({});            // { `${day}|${slotId}|${area}`: staffName }
  const [yardAreas, setYardAreas] = useState(DEFAULT_AREAS);
  const [extraStaff, setExtraStaff] = useState([]); // teachers etc. in the yard-duty pool
  const [dayOv, setDayOv] = useState({});          // { day: { absentS:[], absentA:[], cells:{`${blockId}|${aideId}`:[ids]}, note } }
  const [adminPass, setAdminPass] = useState("");  // "" = not set yet — first Admin login sets it
  const [notifyGroup, setNotifyGroup] = useState(["Wellbeing Team"]); // who the (simulated) urgent alert names
  const [flags, setFlags] = useState({});          // { studentId: [{id, ts, day, by, byRole, category, text}] }
  const [reflections, setReflections] = useState([]); // [{id, ts, day, block, aideId, studentId, engagement, regulation, note}]
  const [activity, setActivity] = useState([]);    // [{id, ts, by, byRole, kind, studentId, text}] — for unread badges
  const [lastSeen, setLastSeen] = useState({});    // { "aide:<id>"|"teacher:<cls>": ts }

  /* ---------- session — who's logged in; separate from the shared doc ---------- */
  const [role, setRole] = useState(null);          // null | "admin" | "aide" | "teacher"
  const [roleId, setRoleId] = useState(null);      // aide id, or class name, for aide/teacher
  const [roleName, setRoleName] = useState("");    // display name for activity/flag authorship
  const [loginErr, setLoginErr] = useState("");
  const [passInput, setPassInput] = useState("");
  const [passConfirm, setPassConfirm] = useState("");
  const sessionLoaded = useRef(false);

  /* ui */
  const [view, setView] = useState("team");        // team | classes | week | today | yard | hours | insights | import | settings
  const [day, setDay] = useState("Mon");           // week + today + yard selected day — also stands in for "today"
  const [wholeWeek, setWholeWeek] = useState(false);
  const [weekBy, setWeekBy] = useState("student");  // "student" (rows = students, coloured by aide) | "aide" (rows = aides)
  const [editCell, setEditCell] = useState(null);  // { day, blockId, aideId, mode:"base"|"today" }
  const [editAide, setEditAide] = useState(null);  // aide id being edited
  const [editStudent, setEditStudent] = useState(null);
  const [clsOpen, setClsOpen] = useState(null);    // class name expanded in Classes view
  const [savedMsg, setSavedMsg] = useState("");
  const [profileId, setProfileId] = useState(null);   // student id — profile/quick-panel modal
  const [flagFor, setFlagFor] = useState(null);        // student id, or "pick" — add-flag modal
  const [flagCatSel, setFlagCatSel] = useState("heads-up");
  const [flagText, setFlagText] = useState("");
  const [reflectFor, setReflectFor] = useState(null);  // { day, block, aideId, studentId } — reflection modal
  const [reflectEng, setReflectEng] = useState(0);
  const [reflectReg, setReflectReg] = useState(0);
  const [reflectNote, setReflectNote] = useState("");
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [urgentStudent, setUrgentStudent] = useState(null);
  const [urgentReason, setUrgentReason] = useState(URGENT_REASONS[0]);
  const [urgentNote, setUrgentNote] = useState("");
  const [urgentSent, setUrgentSent] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistQ, setAssistQ] = useState("");
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistAnswer, setAssistAnswer] = useState("");
  const [assistErr, setAssistErr] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newStaffName, setNewStaffName] = useState("");
  const [passNew, setPassNew] = useState("");
  const [passNew2, setPassNew2] = useState("");

  /* import */
  const [impMode, setImpMode] = useState("preinfo"); // preinfo | classtt
  const [impText, setImpText] = useState("");
  const [impBusy, setImpBusy] = useState(false);
  const [impPreview, setImpPreview] = useState(null); // parsed JSON awaiting Apply
  const [impErr, setImpErr] = useState("");
  const fileRef = useRef(null);
  const loadRef = useRef(null);

  /* ---------- persistence — everything in one doc ---------- */
  const storeLoaded = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await store.get("aide-tt-doc");
        if (raw) {
          const d = JSON.parse(raw);
          if (d.aides) setAides(d.aides);
          if (d.students) setStudents(d.students);
          if (d.classes) setClasses(d.classes);
          if (d.plan) setPlan(d.plan);
          if (d.yard) setYard(d.yard);
          if (d.yardAreas) setYardAreas(d.yardAreas);
          if (d.extraStaff) setExtraStaff(d.extraStaff);
          if (d.dayOv) setDayOv(d.dayOv);
          if (d.adminPass != null) setAdminPass(d.adminPass);
          if (d.notifyGroup) setNotifyGroup(d.notifyGroup);
          if (d.flags) setFlags(d.flags);
          if (d.reflections) setReflections(d.reflections);
          if (d.activity) setActivity(d.activity);
          if (d.lastSeen) setLastSeen(d.lastSeen);
          if (d.apiKey) setApiKey(d.apiKey);
        }
      } catch {}
      storeLoaded.current = true;
    })();
    (async () => {
      try {
        const raw = await store.get("aide-tt-session");
        if (raw) {
          const s = JSON.parse(raw);
          if (s.role) setRole(s.role);
          if (s.roleId !== undefined) setRoleId(s.roleId);
          if (s.roleName) setRoleName(s.roleName);
          if (s.role === "admin") setView("team");
          else if (s.role === "aide") setView("aide-home");
          else if (s.role === "teacher") setView("teacher-home");
        }
      } catch {}
      sessionLoaded.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!storeLoaded.current) return;
    const doc = JSON.stringify({ aides, students, classes, plan, yard, yardAreas, extraStaff, dayOv, adminPass, notifyGroup, flags, reflections, activity, lastSeen, apiKey });
    store.set("aide-tt-doc", doc);
    setSavedMsg("Saved");
    const t = setTimeout(() => setSavedMsg(""), 1200);
    return () => clearTimeout(t);
  }, [aides, students, classes, plan, yard, yardAreas, extraStaff, dayOv, adminPass, notifyGroup, flags, reflections, activity, lastSeen, apiKey]);
  useEffect(() => {
    if (!sessionLoaded.current) return;
    store.set("aide-tt-session", JSON.stringify({ role, roleId, roleName }));
  }, [role, roleId, roleName]);
  const logOut = () => { setRole(null); setRoleId(null); setRoleName(""); setView("team"); setPassInput(""); setLoginErr(""); };

  /* ---------- lookups ---------- */
  const aideById = (id) => aides.find((a) => a.id === id);
  const studentById = (id) => students.find((s) => s.id === id);
  const aideIdx = (id) => aides.findIndex((a) => a.id === id);
  const knownSubjects = [...new Set(Object.values(classes).flatMap((c) => DAYS.flatMap((d) => c.tt?.[d] || [])))].filter(Boolean).sort();
  /* subjects from one class's own timetable — used to suggest a student's priority subjects */
  const subjectsForClass = (cls) => [...new Set(DAYS.flatMap((d) => classes[cls]?.tt?.[d] || []))].filter(Boolean).sort();

  const subjectFor = (st, dy, sessionIdx) => (classes[st?.cls]?.tt?.[dy]?.[sessionIdx] || "").trim();
  const isPriority = (st, subj) => !!subj && (st.prioritySubjects || []).some((p) => subj.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(subj.toLowerCase()));

  const cellKey = (dy, blockId, aideId) => `${dy}|${blockId}|${aideId}`;
  const basePairs = (dy, blockId, aideId) => plan[cellKey(dy, blockId, aideId)] || [];
  const ovFor = (dy) => dayOv[dy] || { absentS: [], absentA: [], cells: {}, note: "" };
  const effPairs = (dy, blockId, aideId) => {
    const ov = ovFor(dy);
    const k = `${blockId}|${aideId}`;
    return ov.cells && ov.cells[k] !== undefined ? ov.cells[k] : basePairs(dy, blockId, aideId);
  };
  const dayHasChanges = (dy) => {
    const ov = ovFor(dy);
    return ov.absentS.length > 0 || ov.absentA.length > 0 || Object.keys(ov.cells || {}).length > 0 || !!ov.note;
  };

  /* yard duty label for an aide during a break column */
  const dutyFor = (dy, breakId, aide) => {
    const hits = [];
    (BREAK_SLOTS[breakId] || []).forEach((slotId) => {
      yardAreas.forEach((area) => {
        if (yard[`${dy}|${slotId}|${area}`] === aide.name) {
          hits.push(`${area}${breakId === "lunch" ? (slotId === "lunch1" ? " · 1st" : " · 2nd") : ""}`);
        }
      });
    });
    return hits;
  };

  /* how many support sessions a student already has on a day (base plan) */
  const dayCount = (studentId, dy, useEff = false) =>
    SESSIONS.reduce((n, s) => n + aides.reduce((m, a) =>
      m + ((useEff ? effPairs(dy, s.id, a.id) : basePairs(dy, s.id, a.id)).includes(studentId) ? 1 : 0), 0), 0);

  const assignedElsewhere = (studentId, dy, blockId, exceptAide) =>
    aides.some((a) => a.id !== exceptAide && basePairs(dy, blockId, a.id).includes(studentId));

  /* ---------- suggestions ---------- */
  const sessionScore = (st, dy, i) => {
    const subj = subjectFor(st, dy, i);
    let sc = 0;
    if (isPriority(st, subj)) sc += 3;
    sc += (SESSIONS.length - i) * 0.1; // slight morning bias — core learning happens early
    return sc;
  };
  const suggestedSessions = (st, dy) => {
    const need = clamp(st.idealPerDay, 0, SESSIONS.length);
    return SESSIONS.map((s, i) => ({ s, i, sc: sessionScore(st, dy, i) }))
      .sort((a, b) => b.sc - a.sc || a.i - b.i)
      .slice(0, need);
  };

  const suggestWeek = () => {
    if (Object.values(plan).some((v) => v?.length) &&
        !window.confirm("Replace the current week plan with a fresh suggestion? Today-tab changes are kept.")) return;
    const next = {};
    DAYS.forEach((dy) => {
      const avail = aides.filter((a) => a.days?.[dy]);
      if (!avail.length) return;
      const load = Object.fromEntries(avail.map((a) => [a.id, 0]));
      const busy = {};    // `${blockId}|${aideId}` — one student per aide per session when auto-filling
      const taken = {};   // `${blockId}|${studentId}` — student already supported that session
      students.forEach((st) => {
        const need = clamp(st.idealPerDay, 0, SESSIONS.length);
        const ranked = SESSIONS.map((s, i) => ({ s, i, sc: sessionScore(st, dy, i) }))
          .sort((a, b) => b.sc - a.sc || a.i - b.i);
        let placed = 0;
        for (const { s } of ranked) {
          if (placed >= need) break;
          if (taken[`${s.id}|${st.id}`]) continue;
          const pick = avail
            .filter((a) => !busy[`${s.id}|${a.id}`])
            .map((a) => ({
              a,
              sc: ((st.preferredAides || []).includes(a.id) ? 4 : 0)
                  - load[a.id]
                  + ((st.preferredAides || [])[0] === a.id ? 1 : 0),
            }))
            .sort((x, y) => y.sc - x.sc)[0];
          if (!pick) continue;
          busy[`${s.id}|${pick.a.id}`] = true;
          taken[`${s.id}|${st.id}`] = true;
          load[pick.a.id]++;
          const k = cellKey(dy, s.id, pick.a.id);
          next[k] = [...(next[k] || []), st.id];
          placed++;
        }
      });
    });
    setPlan(next);
  };

  /* aide busy supporting a student through a break — keep them off yard duty then */
  const breakBusy = (dy, slotId, aide) => {
    const breakId = slotId === "recess" ? "recess" : (slotId === "lunch1" || slotId === "lunch2") ? "lunch" : null;
    return breakId ? basePairs(dy, breakId, aide.id).length > 0 : false;
  };
  const suggestYard = () => {
    if (Object.values(yard).some(Boolean) &&
        !window.confirm("Replace the current yard duty roster with a fresh suggestion?")) return;
    const next = {};
    const count = {};
    DAYS.forEach((dy) => {
      YARD_SLOTS.forEach((slot) => {
        const pool = [
          ...aides.filter((a) => a.days?.[dy] && !breakBusy(dy, slot.id, a)).map((a) => a.name),
          ...extraStaff,
        ];
        yardAreas.forEach((area) => {
          const takenSlot = new Set(yardAreas.map((ar) => next[`${dy}|${slot.id}|${ar}`]).filter(Boolean));
          const lunchPair = slot.id === "lunch2" ? yardAreas.map((ar) => next[`${dy}|lunch1|${ar}`]).filter(Boolean) : [];
          const pick = pool
            .filter((n) => !takenSlot.has(n) && !lunchPair.includes(n))
            .sort((a, b) => (count[a] || 0) - (count[b] || 0))[0];
          if (pick) { next[`${dy}|${slot.id}|${area}`] = pick; count[pick] = (count[pick] || 0) + 1; }
        });
      });
    });
    setYard(next);
  };

  /* ---------- mutations ---------- */
  const patchAide = (id, patch) => setAides((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const patchStudent = (id, patch) => setStudents((xs) => xs.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addAide = () => { const a = { id: uid(), name: "", days: Object.fromEntries(DAYS.map((d) => [d, true])), notes: "" }; setAides((xs) => [...xs, a]); setEditAide(a.id); };
  const addStudent = () => { const s = { id: uid(), name: "", cls: "", year: "", idealPerDay: 2, fundedHrs: null, prioritySubjects: [], preferredAides: [], notes: "", strategies: "", iepGoals: [] }; setStudents((xs) => [...xs, s]); setEditStudent(s.id); };
  const removeAide = (id) => {
    if (!window.confirm("Remove this aide and all their assignments?")) return;
    setAides((xs) => xs.filter((a) => a.id !== id));
    setPlan((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.endsWith(`|${id}`))));
    setStudents((xs) => xs.map((s) => ({ ...s, preferredAides: (s.preferredAides || []).filter((x) => x !== id) })));
  };
  const removeStudent = (id) => {
    if (!window.confirm("Remove this student and all their assignments?")) return;
    setStudents((xs) => xs.filter((s) => s.id !== id));
    setPlan((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.filter((x) => x !== id)]).filter(([, v]) => v.length)));
  };
  const setCellPairs = (dy, blockId, aideId, ids, mode) => {
    if (mode === "today") {
      setDayOv((m) => {
        const ov = { absentS: [], absentA: [], cells: {}, note: "", ...(m[dy] || {}) };
        const k = `${blockId}|${aideId}`;
        const base = basePairs(dy, blockId, aideId);
        const cells = { ...ov.cells };
        if (JSON.stringify(ids) === JSON.stringify(base)) delete cells[k]; else cells[k] = ids;
        return { ...m, [dy]: { ...ov, cells } };
      });
      const b = BLOCKS.find((x) => x.id === blockId);
      const a = aideById(aideId);
      const names = ids.map((sid) => studentById(sid)?.name).filter(Boolean).join(", ") || "no one";
      pushActivity(`Timetable change · ${DAY_LABEL[dy]} ${b?.label || blockId}: ${a?.name || "aide"} → ${names}`, "change", ids[0] || null, aideId);
    } else {
      setPlan((p) => {
        const k = cellKey(dy, blockId, aideId);
        const next = { ...p };
        if (ids.length) next[k] = ids; else delete next[k];
        return next;
      });
    }
  };
  const toggleAbsent = (dy, kind, id) => {
    const key = kind === "s" ? "absentS" : "absentA";
    const nowAbsent = !ovFor(dy)[key].includes(id);
    setDayOv((m) => {
      const ov = { absentS: [], absentA: [], cells: {}, note: "", ...(m[dy] || {}) };
      const list = nowAbsent ? [...new Set([...ov[key], id])] : ov[key].filter((x) => x !== id);
      return { ...m, [dy]: { ...ov, [key]: list } };
    });
    const name = kind === "s" ? studentById(id)?.name : aideById(id)?.name;
    if (name) pushActivity(`${name} marked ${nowAbsent ? "absent" : "back in"} · ${DAY_LABEL[dy]}`, "change", kind === "s" ? id : null, kind === "a" ? id : null);
  };
  const resetDay = (dy) => {
    if (!window.confirm(`Clear all of ${DAY_LABEL[dy]}'s changes and go back to the base week?`)) return;
    setDayOv((m) => { const n = { ...m }; delete n[dy]; return n; });
  };

  /* ---------- hours ---------- */
  const weekMinutes = (studentId, useEff = false) => {
    let mins = 0;
    DAYS.forEach((dy) => {
      const ov = ovFor(dy);
      SESSIONS.forEach((s) => aides.forEach((a) => {
        const pairs = useEff ? effPairs(dy, s.id, a.id) : basePairs(dy, s.id, a.id);
        if (!pairs.includes(studentId)) return;
        if (useEff && (ov.absentS.includes(studentId) || ov.absentA.includes(a.id))) return;
        mins += SESSION_MIN;
      }));
    });
    return mins;
  };
  const aideWeekSessions = (aideId) => {
    let n = 0, breaks = 0;
    DAYS.forEach((dy) => BLOCKS.forEach((b) => {
      const c = basePairs(dy, b.id, aideId).length;
      if (!c) return;
      if (b.kind === "session") n += 1; else breaks += 1;
    }));
    return { n, breaks };
  };
  const aideYardCount = (name) => Object.values(yard).filter((v) => v === name).length;

  /* ---------- who's logged in, what they can see ---------- */
  const whoAmI = () => (role === "admin" ? "Admin" : role === "aide" ? (aideById(roleId)?.name || "Aide") : role === "teacher" ? `${roleId} teacher` : "");
  const aideStudentIds = (aideId) => [...new Set(Object.entries(plan).filter(([k, v]) => k.endsWith(`|${aideId}`) && v.length).flatMap(([, v]) => v))];
  const teacherStudentIds = (cls) => students.filter((s) => s.cls === cls).map((s) => s.id);
  const myStudentIds = () => (role === "aide" ? aideStudentIds(roleId) : role === "teacher" ? teacherStudentIds(roleId) : students.map((s) => s.id));
  const sessionKey = () => (role === "aide" ? `aide:${roleId}` : role === "teacher" ? `teacher:${roleId}` : null);
  const relevantActivity = () => {
    if (role === "admin") return activity;
    const ids = myStudentIds();
    return activity.filter((a) => a.kind === "urgent" || (a.studentId != null && ids.includes(a.studentId)) || (role === "aide" && a.aideId === roleId));
  };
  const unreadActivity = () => {
    const key = sessionKey();
    const since = key ? lastSeen[key] || 0 : 0;
    return relevantActivity().filter((a) => a.ts > since && a.byRole !== role); // your own posts aren't news to you
  };
  const markSeen = () => {
    const key = sessionKey();
    if (key) setLastSeen((m) => ({ ...m, [key]: Date.now() }));
  };

  /* ---------- flags, reflections, activity — the day-to-day layer everyone shares ---------- */
  const pushActivity = (text, kind, studentId = null, aideId = null) =>
    setActivity((xs) => [{ id: uid(), ts: Date.now(), by: whoAmI(), byRole: role, kind, studentId, aideId, text }, ...xs].slice(0, 300));
  const flagsFor = (studentId) => flags[studentId] || [];
  const addFlag = (studentId, category, text) => {
    const entry = { id: uid(), ts: Date.now(), day, by: whoAmI(), byRole: role, category, text: text.trim() };
    setFlags((m) => ({ ...m, [studentId]: [entry, ...(m[studentId] || [])] }));
    const st = studentById(studentId);
    pushActivity(`${flagCat(category).label} — ${st?.name || "a student"}: ${text.trim()}`, "flag", studentId);
  };
  const addReflection = (r) => {
    setReflections((xs) => [{ id: uid(), ts: Date.now(), ...r }, ...xs]);
    const st = studentById(r.studentId);
    pushActivity(`Reflection · ${st?.name || "student"} — engagement ${r.engagement}/5, regulation ${r.regulation}/5${r.note ? `: ${r.note}` : ""}`, "reflection", r.studentId, r.aideId);
  };
  const weekStartTs = () => { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const reflectionDone = (dy, blockId, aideId, studentId) =>
    reflections.some((r) => r.day === dy && r.block === blockId && r.aideId === aideId && r.studentId === studentId && r.ts >= weekStartTs());

  /* ---------- login ---------- */
  const loginAdmin = () => {
    if (!adminPass) {
      if (passInput.length < 4) { setLoginErr("Passcode needs at least 4 characters."); return; }
      if (passInput !== passConfirm) { setLoginErr("Passcodes don't match."); return; }
      setAdminPass(passInput);
    } else if (passInput !== adminPass) { setLoginErr("Wrong passcode."); return; }
    setRole("admin"); setRoleId(null); setRoleName("Admin"); setView("team");
    setPassInput(""); setPassConfirm(""); setLoginErr("");
  };
  const loginAide = (a) => { setRole("aide"); setRoleId(a.id); setRoleName(a.name); setView("aide-home"); setLoginErr(""); };
  const loginTeacher = (cls) => { setRole("teacher"); setRoleId(cls); setRoleName(`${cls} teacher`); setView("teacher-home"); setLoginErr(""); };
  const sendUrgent = (studentId, reason, note) => {
    const st = studentId ? studentById(studentId) : null;
    const text = `URGENT — ${reason}${st ? ` · ${st.name}` : ""}${note ? `: ${note}` : ""}`;
    pushActivity(text, "urgent", studentId);
    if (studentId) addFlag(studentId, reason === "Soft signs building up" ? "soft-signs" : "behaviour", `[Urgent request] ${note || reason}`);
  };

  /* ---------- backup — belt-and-braces when browser storage isn't available ---------- */
  const exportData = () => {
    const doc = JSON.stringify({ aides, students, classes, plan, yard, yardAreas, extraStaff, dayOv, adminPass, notifyGroup, flags, reflections, activity, lastSeen, apiKey }, null, 2);
    const blob = new Blob([doc], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aide-timetable-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const loadData = async (file) => {
    if (!file) return;
    try {
      const d = JSON.parse(await fileToText(file));
      if (!window.confirm("Replace everything with this backup?")) return;
      setAides(d.aides || []); setStudents(d.students || []); setClasses(d.classes || {});
      setPlan(d.plan || {}); setYard(d.yard || {}); setYardAreas(d.yardAreas || DEFAULT_AREAS);
      setExtraStaff(d.extraStaff || []); setDayOv(d.dayOv || {});
      setAdminPass(d.adminPass || ""); setNotifyGroup(d.notifyGroup || ["Wellbeing Team"]);
      setFlags(d.flags || {}); setReflections(d.reflections || []);
      setActivity(d.activity || []); setLastSeen(d.lastSeen || {});
      if (d.apiKey !== undefined) setApiKey(d.apiKey || "");
    } catch { window.alert("That file isn't a valid backup."); }
  };
  const loadSample = () => {
    const s = SAMPLE();
    setAides(s.aides); setStudents(s.students); setClasses(s.classes);
    setNotifyGroup(s.notifyGroup); setFlags(s.flags); setReflections(s.reflections);
  };

  /* ---------- AI assist — describe a problem, get options ---------- */
  useEffect(() => { API_KEY = apiKey || ""; }, [apiKey]);
  const assistContext = () => {
    const lines = [];
    lines.push(`Day blocks: ${BLOCKS.map((b) => `${b.label} ${b.time}`).join("; ")}`);
    lines.push(`AIDES (working days): ${aides.map((a) => `${a.name} (${DAYS.filter((d) => a.days?.[d]).join("/") || "none"})${a.notes ? ` — ${a.notes}` : ""}`).join("; ")}`);
    lines.push(`STUDENTS: ${students.map((s) =>
      `${s.name} (${s.cls || "?"}, ideal ${s.idealPerDay}/day${(s.preferredAides || []).length ? `, works well with ${s.preferredAides.map((id) => aideById(id)?.name).filter(Boolean).join("+")}` : ""}${s.strategies ? `, strategies: ${s.strategies}` : ""}${s.notes ? `, ${s.notes}` : ""})`).join("; ")}`);
    const ov = ovFor(day);
    const sched = [];
    aides.forEach((a) => {
      if (!a.days?.[day]) return;
      BLOCKS.forEach((b) => {
        const ids = effPairs(day, b.id, a.id);
        if (ids.length) sched.push(`${a.name} ${b.label}: ${ids.map((id) => studentById(id)?.name).filter(Boolean).join("+")}`);
      });
    });
    lines.push(`${DAY_LABEL[day]} schedule as it stands: ${sched.join("; ") || "empty"}`);
    const absent = [...ov.absentS.map((id) => studentById(id)?.name), ...ov.absentA.map((id) => aideById(id)?.name)].filter(Boolean);
    if (absent.length) lines.push(`Absent ${DAY_LABEL[day]}: ${absent.join(", ")}`);
    if (ov.note) lines.push(`Day note: ${ov.note}`);
    const recent = Object.entries(flags).flatMap(([sid, fs]) =>
      (fs || []).filter((f) => f.ts > Date.now() - 7 * 86400000).map((f) => `${studentById(sid)?.name}: [${flagCat(f.category).label}] ${f.text}`)).slice(0, 15);
    if (recent.length) lines.push(`Recent updates: ${recent.join(" | ")}`);
    return lines.join("\n");
  };
  const runAssist = async () => {
    setAssistBusy(true); setAssistErr(""); setAssistAnswer("");
    try {
      const out = await askClaude([{ role: "user", content: `${ASSIST_PROMPT}\n\n--- CURRENT SETUP ---\n${assistContext()}\n\n--- PROBLEM (from ${whoAmI()}) ---\n${assistQ.trim()}` }], 1500);
      setAssistAnswer(out.trim());
    } catch (e) { setAssistErr(friendlyErr(e, "Couldn't get suggestions — try again.")); }
    setAssistBusy(false);
  };

  /* ---------- import ---------- */
  const friendlyErr = (e, fallback) => {
    const msg = e?.message || "";
    return /fetch|api key|authentication/i.test(msg)
      ? "AI can't run here yet — an admin can add an Anthropic API key in Settings, or use the .jsx version pasted into claude.ai."
      : msg || fallback;
  };
  const runImport = async (text) => {
    setImpBusy(true); setImpErr(""); setImpPreview(null);
    try {
      const prompt = impMode === "preinfo" ? PREINFO_PROMPT : impMode === "classtt" ? CLASSTT_PROMPT : WEEKTT_PROMPT;
      const maxTokens = impMode === "weektt" ? 8000 : 4000;
      const out = await askClaude([{ role: "user", content: `${prompt}\n\n--- SOURCE ---\n${text.slice(0, 40000)}` }], maxTokens);
      setImpPreview(parseJSON(out));
    } catch (e) {
      const msg = e?.message || "";
      const err = /JSON/.test(msg)
        ? "Response was incomplete — try a smaller or cleaner data file, or break it into parts."
        : friendlyErr(e, "Couldn't parse that — try cleaner text or a different file.");
      setImpErr(err);
    }
    setImpBusy(false);
  };
  const onImportFile = async (file) => {
    if (!file) return;
    setImpBusy(true); setImpErr("");
    try { const text = await extractSourceText(file); setImpText(text); await runImport(text); }
    catch (e) { setImpErr(friendlyErr(e, "Couldn't read that file.")); setImpBusy(false); }
  };
  /* match "Karen" / "Karen M" style variants — exact first, then unique first-name */
  const matchByName = (list, name) => {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return null;
    let hit = list.find((x) => x.name.trim().toLowerCase() === n);
    if (!hit) {
      const first = n.split(/\s+/)[0];
      const c = list.filter((x) => x.name.trim().toLowerCase().split(/\s+/)[0] === first);
      if (c.length === 1) hit = c[0];
    }
    return hit || null;
  };
  const applyPreview = () => {
    if (!impPreview) return;
    if (impMode === "preinfo") {
      const byName = matchByName;
      let nextAides = [...aides];
      (impPreview.aides || []).forEach((ia) => {
        const days = Object.fromEntries(DAYS.map((d) => [d, !ia.days?.length || ia.days.includes(d)]));
        const hit = byName(nextAides, ia.name);
        if (hit) nextAides = nextAides.map((a) => (a.id === hit.id ? { ...a, days, notes: ia.notes || a.notes } : a));
        else if (ia.name?.trim()) nextAides.push({ id: uid(), name: ia.name.trim(), days, notes: ia.notes || "" });
      });
      let nextStudents = [...students];
      (impPreview.students || []).forEach((is) => {
        const pref = (is.preferredAides || []).map((n) => byName(nextAides, n)?.id).filter(Boolean);
        const base = {
          cls: is.cls || "", year: String(is.year || ""), idealPerDay: clamp(is.idealPerDay ?? 2, 0, 6),
          fundedHrs: is.fundedHrs == null ? null : Number(is.fundedHrs),
          prioritySubjects: is.prioritySubjects || [], preferredAides: pref, notes: is.notes || "",
        };
        const hit = byName(nextStudents, is.name);
        if (hit) nextStudents = nextStudents.map((s) => (s.id === hit.id ? { ...s, ...base } : s));
        else if (is.name?.trim()) nextStudents.push({ id: uid(), name: is.name.trim(), ...base });
      });
      setAides(nextAides); setStudents(nextStudents);
    } else if (impMode === "weektt") {
      const asg = (impPreview.assignments || []).filter((x) => DAYS.includes(x.day) && BLOCKS.some((b) => b.id === x.block));
      const nextAides = aides.map((a) => ({ ...a, days: { ...a.days } }));
      const nextStudents = [...students];
      const resolveAide = (name) => {
        let hit = matchByName(nextAides, name);
        if (!hit && String(name || "").trim()) {
          hit = { id: uid(), name: String(name).trim(), days: Object.fromEntries(DAYS.map((d) => [d, false])), notes: "" };
          nextAides.push(hit);
        }
        return hit;
      };
      const resolveStudent = (name) => {
        let hit = matchByName(nextStudents, name);
        if (!hit && String(name || "").trim()) {
          hit = { id: uid(), name: String(name).trim(), cls: "", year: "", idealPerDay: 2, fundedHrs: null, prioritySubjects: [], preferredAides: [], notes: "" };
          nextStudents.push(hit);
        }
        return hit;
      };
      const nextPlan = { ...plan };
      asg.forEach((x) => {
        const a = resolveAide(x.aide);
        if (!a) return;
        a.days[x.day] = true; // seen on the timetable = works that day
        const ids = (x.students || []).map((s2) => resolveStudent(s2)?.id).filter(Boolean);
        if (!ids.length) return;
        const k = `${x.day}|${x.block}|${a.id}`;
        nextPlan[k] = [...new Set([...(nextPlan[k] || []), ...ids])];
      });
      setAides(nextAides); setStudents(nextStudents); setPlan(nextPlan);
    } else {
      setClasses((c) => {
        const next = { ...c };
        (impPreview.classes || []).forEach((ic) => {
          if (!ic.name) return;
          const tt = Object.fromEntries(DAYS.map((d) => [d, [...(ic.tt?.[d] || []), "", "", "", "", "", ""].slice(0, 6)]));
          next[ic.name] = { year: String(ic.year || ""), tt };
        });
        return next;
      });
    }
    setImpPreview(null); setImpText("");
    setView(impMode === "preinfo" ? "team" : impMode === "weektt" ? "week" : "classes");
  };

  /* ---------- cell-editor ranking ---------- */
  const rankStudentsFor = (dy, blockId, aideId) => {
    const si = SESSIONS.findIndex((s) => s.id === blockId);
    const isBreak = si < 0;
    return students.map((st) => {
      const reasons = [];
      let sc = 0;
      if (!isBreak) {
        const subj = subjectFor(st, dy, si);
        if (subj && isPriority(st, subj)) { sc += 3; reasons.push(`${subj} — priority`); }
        else if (subj) reasons.push(subj);
      } else reasons.push("support through the break");
      if ((st.preferredAides || []).includes(aideId)) { sc += 3; reasons.push("works well together"); }
      const got = dayCount(st.id, dy);
      if (!isBreak) {
        if (got < clamp(st.idealPerDay, 0, 6)) { sc += 2; reasons.push(`${got}/${st.idealPerDay} sessions today`); }
        else reasons.push(`already at ${got}/${st.idealPerDay} today`);
        if (assignedElsewhere(st.id, dy, blockId, aideId)) { sc -= 5; reasons.push("already covered this session"); }
      }
      return { st, sc, reasons };
    }).sort((a, b) => b.sc - a.sc || a.st.name.localeCompare(b.st.name));
  };

  /* ============================ shared render bits ============================ */
  const DayPills = ({ value, onChange }) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} className="no-print">
      {DAYS.map((d) => (
        <button key={d} onClick={() => onChange(d)}
          style={{ ...S.btnGhost, padding: "6px 14px",
            ...(value === d ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
          {DAY_LABEL[d]}{dayHasChanges(d) && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 999, background: value === d ? "#FFF" : "#F59E0B", marginLeft: 6 }} />}
        </button>
      ))}
    </div>
  );

  const StudentChip = ({ st, struck = false, small = false }) => (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 8,
      padding: small ? "2px 7px" : "3px 9px", background: "#FAFBFD", border: `1px solid ${T.lineSoft}`,
      fontSize: small ? 10.5 : 11.5, fontWeight: 600, color: T.ink, whiteSpace: "nowrap",
      ...(struck ? { textDecoration: "line-through", color: T.faint, background: T.redSoft, borderColor: T.redLine } : {}),
    }}>
      {st?.name || "?"}
      {st?.cls && <span style={{ color: T.faint, fontWeight: 500 }}>{st.cls}</span>}
    </span>
  );

  /* one day's aide grid — used by Week (base) and Today (effective + flags) */
  const DayGrid = ({ dy, mode }) => {
    const ov = ovFor(dy);
    const today = mode === "today";
    return (
      <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: 14, background: T.card }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ padding: "10px 12px", textAlign: "left", fontFamily: F.body, fontSize: 11, fontWeight: 700, color: T.faint, borderBottom: `1px solid ${T.line}`, minWidth: 130 }}>
                {DAY_LABEL[dy]}
              </th>
              {BLOCKS.map((b) => (
                <th key={b.id} style={{
                  padding: "8px 8px", textAlign: "center", fontFamily: F.body, fontSize: 11, fontWeight: 700,
                  color: b.kind === "break" ? T.amber : T.ink, borderBottom: `1px solid ${T.line}`,
                  background: b.kind === "break" ? T.amberSoft : undefined, minWidth: b.kind === "break" ? 86 : 104,
                }}>
                  {b.label}
                  <div style={{ fontSize: 9.5, fontWeight: 600, color: T.faint }}>{b.time}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {aides.map((a, ai) => {
              const working = !!a.days?.[dy];
              const absent = today && ov.absentA.includes(a.id);
              const col = aideColor(ai);
              return (
                <tr key={a.id}>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${T.lineSoft}`, background: absent ? T.redSoft : undefined }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 999, background: col.main, color: col.on, fontSize: 9.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
                        {initials(a.name)}
                      </span>
                      <div>
                        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 12.5, ...(absent ? { textDecoration: "line-through", color: T.red } : {}) }}>{a.name || "Unnamed"}</div>
                        {absent && <div style={{ fontSize: 10, fontWeight: 700, color: T.red }}>Absent today</div>}
                        {!working && <div style={{ fontSize: 10, fontWeight: 600, color: T.faint }}>Not in {DAY_LABEL[dy]}s</div>}
                      </div>
                    </div>
                  </td>
                  {BLOCKS.map((b) => {
                    if (!working) return <td key={b.id} style={{ borderBottom: `1px solid ${T.lineSoft}`, background: "#F8FAFC", textAlign: "center", color: T.faint, fontSize: 11 }}>—</td>;
                    const base = basePairs(dy, b.id, a.id);
                    const pairs = today ? effPairs(dy, b.id, a.id) : base;
                    const overridden = today && ov.cells && ov.cells[`${b.id}|${a.id}`] !== undefined;
                    const duty = b.kind === "break" ? dutyFor(dy, b.id, a) : [];
                    const needsCover = today && absent && pairs.length > 0 && pairs.some((sid) => !ov.absentS.includes(sid));
                    const si = SESSIONS.findIndex((s) => s.id === b.id);
                    return (
                      <td key={b.id}
                        onClick={() => setEditCell({ day: dy, blockId: b.id, aideId: a.id, mode: today ? "today" : "base" })}
                        style={{
                          borderBottom: `1px solid ${T.lineSoft}`, borderLeft: `1px solid ${T.lineSoft}`,
                          padding: "6px 6px", verticalAlign: "top", cursor: "pointer",
                          background: needsCover ? T.redSoft : b.kind === "break" ? "#FFFDF4" : undefined,
                          minHeight: 44,
                        }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start", minHeight: 34 }}>
                          {pairs.map((sid) => {
                            const st = studentById(sid);
                            const struck = today && ov.absentS.includes(sid);
                            return (
                              <div key={sid} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                <StudentChip st={st} struck={struck} small />
                                {b.kind === "session" && st && subjectFor(st, dy, si) && (
                                  <span style={{ fontSize: 9, fontWeight: 600, color: isPriority(st, subjectFor(st, dy, si)) ? T.blueDeep : T.faint, paddingLeft: 2 }}>
                                    {subjectFor(st, dy, si)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {b.kind === "break" && duty.map((d2) => (
                            <span key={d2} style={{ fontSize: 9.5, fontWeight: 700, color: T.amber, background: T.amberSoft, border: `1px solid ${T.amberLine}`, borderRadius: 6, padding: "1px 6px" }}>
                              Yard · {d2}
                            </span>
                          ))}
                          {b.kind === "break" && !pairs.length && !duty.length && (
                            <span style={{ fontSize: 9.5, fontWeight: 600, color: T.faint }}>Break</span>
                          )}
                          {needsCover && <span style={{ fontSize: 9.5, fontWeight: 800, color: T.red }}>Needs cover</span>}
                          {overridden && !needsCover && <span style={{ width: 6, height: 6, borderRadius: 999, background: "#F59E0B", display: "inline-block" }} title="Changed today" />}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!aides.length && (
              <tr><td colSpan={BLOCKS.length + 1} style={{ padding: 24, textAlign: "center", color: T.faint, fontSize: 13 }}>
                Add aides in the Team tab first.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  /* one day, students down the side (like the paper timetable) — each cell coloured by the aide supporting them */
  const StudentGrid = ({ dy, mode }) => {
    const ov = ovFor(dy);
    const today = mode === "today";
    const kids = [...students].sort((a, b) => (a.cls || "").localeCompare(b.cls || "") || (a.name || "").localeCompare(b.name || ""));
    return (
      <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: 14, background: T.card }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ padding: "10px 12px", textAlign: "left", fontFamily: F.body, fontSize: 11, fontWeight: 700, color: T.faint, borderBottom: `1px solid ${T.line}`, minWidth: 140 }}>
                {DAY_LABEL[dy]}
              </th>
              {BLOCKS.map((b) => (
                <th key={b.id} style={{
                  padding: "8px 8px", textAlign: "center", fontFamily: F.body, fontSize: 11, fontWeight: 700,
                  color: b.kind === "break" ? T.amber : T.ink, borderBottom: `1px solid ${T.line}`,
                  background: b.kind === "break" ? T.amberSoft : undefined, minWidth: b.kind === "break" ? 86 : 104,
                }}>
                  {b.label}
                  <div style={{ fontSize: 9.5, fontWeight: 600, color: T.faint }}>{b.time}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kids.map((kid) => {
              const kidAbsent = today && ov.absentS.includes(kid.id);
              return (
                <tr key={kid.id}>
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${T.lineSoft}`, background: kidAbsent ? T.redSoft : undefined }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => setProfileId(kid.id)}>
                      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 12.5, ...(kidAbsent ? { textDecoration: "line-through", color: T.red } : {}) }}>{kid.name || "?"}</div>
                      <span style={{ fontSize: 10.5, color: T.faint, fontWeight: 600 }}>{kid.cls}</span>
                    </div>
                    {kidAbsent && <div style={{ fontSize: 10, fontWeight: 700, color: T.red }}>Absent today</div>}
                  </td>
                  {BLOCKS.map((b) => {
                    const si = SESSIONS.findIndex((s) => s.id === b.id);
                    const subj = b.kind === "session" ? subjectFor(kid, dy, si) : "";
                    const assigned = aides.map((a, ai) => ({ a, ai }))
                      .filter(({ a }) => a.days?.[dy] && (today ? effPairs(dy, b.id, a.id) : basePairs(dy, b.id, a.id)).includes(kid.id));
                    const aAbsent = (a) => today && ov.absentA.includes(a.id);
                    const first = assigned[0];
                    const col = first ? aideColor(first.ai) : null;
                    const uncovered = today && assigned.length > 0 && assigned.every(({ a }) => aAbsent(a)) && !kidAbsent;
                    return (
                      <td key={b.id} style={{
                        borderBottom: `1px solid ${T.lineSoft}`, borderLeft: `1px solid ${T.lineSoft}`,
                        padding: "6px 6px", verticalAlign: "top",
                        background: uncovered ? T.redSoft : col ? col.soft : b.kind === "break" ? "#FFFDF4" : undefined,
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", minHeight: 30 }}>
                          {assigned.map(({ a, ai }) => {
                            const c2 = aideColor(ai);
                            const gone = aAbsent(a);
                            return (
                              <span key={a.id} style={{
                                fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "1px 7px",
                                background: gone ? T.redSoft : c2.main, color: gone ? T.red : c2.on,
                                border: `1px solid ${gone ? T.redLine : c2.main}`, whiteSpace: "nowrap",
                                ...(gone ? { textDecoration: "line-through" } : {}),
                              }}>{a.name}</span>
                            );
                          })}
                          {subj && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: isPriority(kid, subj) ? T.blueDeep : T.faint, paddingLeft: 1 }}>{subj}</span>
                          )}
                          {uncovered && <span style={{ fontSize: 9.5, fontWeight: 800, color: T.red }}>Needs cover</span>}
                          {!assigned.length && !subj && b.kind === "break" && <span style={{ fontSize: 9.5, fontWeight: 600, color: T.faint }}>—</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!students.length && (
              <tr><td colSpan={BLOCKS.length + 1} style={{ padding: 24, textAlign: "center", color: T.faint, fontSize: 13 }}>
                Add students in the Team tab first.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  /* ============================ LOGIN GATE ============================ */
  if (!role) return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: F.body, color: T.ink }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "56px 22px 60px", textAlign: "center" }}>
        <Pill tone="blue" style={{ fontSize: 11 }}>CPS · Learning Support</Pill>
        <h1 style={{ fontFamily: F.display, fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", margin: "12px 0 6px" }}>
          Aide <span style={{ color: T.blue }}>Timetable</span>
        </h1>
        <div style={{ fontSize: 14, color: T.sub, maxWidth: 560, margin: "0 auto 8px", lineHeight: 1.55 }}>
          Sign in to your view. Admin plans the week; aides and teachers see their day as it actually stands.
        </div>
        <Pill tone="amber" style={{ fontSize: 10.5, marginBottom: 26 }}>Prototype — single-browser demo · notifications simulated · no real student data</Pill>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, textAlign: "left", marginTop: 22 }}>
          {/* admin */}
          <div style={{ ...S.card, padding: 20 }}>
            <span style={S.eyebrow}>Admin</span>
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 17, margin: "8px 0 4px" }}>Plan &amp; run the week</div>
            <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5, marginBottom: 12 }}>
              Timetables, yard duty, hours, insights and settings.{!adminPass && " No passcode set yet — create one now."}
            </div>
            <label style={S.label}>{adminPass ? "Passcode" : "Create a passcode"}</label>
            <input style={S.input} type="password" value={passInput} onChange={(e) => setPassInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (adminPass ? loginAdmin() : null)} placeholder={adminPass ? "••••••" : "At least 4 characters"} />
            {!adminPass && (
              <div style={{ marginTop: 8 }}>
                <label style={S.label}>Confirm passcode</label>
                <input style={S.input} type="password" value={passConfirm} onChange={(e) => setPassConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loginAdmin()} placeholder="Same again" />
              </div>
            )}
            <button style={{ ...S.btn, marginTop: 12, width: "100%" }} onClick={loginAdmin}>{adminPass ? "Unlock admin" : "Set passcode & enter"}</button>
            {loginErr && <div style={{ marginTop: 8 }}><Pill tone="red" style={{ fontSize: 11 }}>{loginErr}</Pill></div>}
          </div>

          {/* aide */}
          <div style={{ ...S.card, padding: 20 }}>
            <span style={S.eyebrow}>Aide</span>
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 17, margin: "8px 0 4px" }}>My day at a glance</div>
            <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5, marginBottom: 12 }}>
              Your sessions, your students, today's changes — plus quick updates and reflections.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {aides.map((a, ai) => {
                const col = aideColor(ai);
                return (
                  <button key={a.id} onClick={() => loginAide(a)}
                    style={{ ...S.btnGhost, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", borderRadius: 12 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 999, background: col.main, color: col.on, fontSize: 9.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(a.name)}</span>
                    {a.name || "Unnamed aide"}
                  </button>
                );
              })}
              {!aides.length && <span style={{ fontSize: 12.5, color: T.faint }}>No aides set up yet — admin adds the team first.</span>}
            </div>
          </div>

          {/* teacher */}
          <div style={{ ...S.card, padding: 20 }}>
            <span style={S.eyebrow}>Teacher</span>
            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 17, margin: "8px 0 4px" }}>My class's support</div>
            <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5, marginBottom: 12 }}>
              Which of your students have aide support today, with whom, and any updates.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.keys(classes).sort().map((cls) => (
                <button key={cls} onClick={() => loginTeacher(cls)}
                  style={{ ...S.btnGhost, width: "100%", textAlign: "left", borderRadius: 12 }}>
                  {cls}{classes[cls]?.year ? ` · Year ${classes[cls].year}` : ""}
                  <span style={{ color: T.faint, fontWeight: 500, marginLeft: 6, fontSize: 11.5 }}>
                    {students.filter((s) => s.cls === cls).length} supported
                  </span>
                </button>
              ))}
              {!Object.keys(classes).length && <span style={{ fontSize: 12.5, color: T.faint }}>No classes set up yet — admin adds them first.</span>}
            </div>
          </div>
        </div>

        {!aides.length && (
          <div style={{ marginTop: 22, fontSize: 13, color: T.sub }}>
            First time here?{" "}
            <button onClick={loadSample} style={{ border: "none", background: "none", cursor: "pointer", color: T.blueDeep, fontWeight: 700, fontSize: 13, padding: 0 }}>
              Load sample data
            </button>{" "}
            to explore every view.
          </div>
        )}
        <div style={{ marginTop: 30, fontSize: 11.5, color: T.faint, lineHeight: 1.7, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
          Closed prototype: everything stays in this browser — nothing is sent anywhere. Use first names and an initial only;
          never surnames, dates of birth or photos. A real multi-user rollout needs a school-approved, Australian-hosted service.
        </div>
      </div>
    </div>
  );

  /* ============================ UI ============================ */
  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: F.body, color: T.ink }}>
      <style>{GLOBAL_CSS}</style>

      {/* ---------- header ---------- */}
      <div style={{ background: T.card, borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 22px", textAlign: "center" }}>
          <Pill tone="blue" style={{ fontSize: 11 }}>CPS · Learning Support · {whoAmI()}</Pill>
          <h1 style={{ fontFamily: F.display, fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", margin: "12px 0 6px" }}>
            Aide <span style={{ color: T.blue }}>Timetable</span>
          </h1>
          <div style={{ fontSize: 14, color: T.sub, maxWidth: 620, margin: "0 auto", lineHeight: 1.55 }}>
            {role === "admin"
              ? "The team, the students, the week. Suggest a timetable, tune it cell by cell, roster the yard — then run the day as it actually happens."
              : role === "aide"
              ? "Your day at a glance — knowing it may change. The bell flags anything new."
              : "Your class's aide support today — who, when, and anything worth knowing."}
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
            {(role === "admin"
              ? [["team", "Team"], ["classes", "Classes"], ["week", "Week"], ["today", "Today"], ["yard", "Yard duty"], ["hours", "Hours"], ["insights", "Insights"], ["import", "Import"], ["settings", "Settings"]]
              : role === "aide"
              ? [["aide-home", "My day"], ["aide-week", "My week"]]
              : [["teacher-home", "My class"]]
            ).map(([k, lab]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ ...S.btnGhost, ...(view === k ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                {lab}
              </button>
            ))}
            {/* bell */}
            <button onClick={() => { if (bellOpen) markSeen(); setBellOpen(!bellOpen); }}
              title="Changes & updates"
              style={{ ...S.btnGhost, position: "relative", padding: "8px 14px" }}>
              🔔
              {unreadActivity().length > 0 && (
                <span style={{ position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 999, background: "#DC2626", color: "#FFF", fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                  {unreadActivity().length}
                </span>
              )}
            </button>
            <button onClick={() => { setAssistOpen(true); setAssistErr(""); }}
              style={{ ...S.btnGhost, padding: "8px 16px", color: T.blueDeep, borderColor: T.blueLine, background: T.blueSoft }}>
              ✦ Assist
            </button>
            <button onClick={() => { setUrgentOpen(true); setUrgentSent(false); setUrgentStudent(null); setUrgentReason(URGENT_REASONS[0]); setUrgentNote(""); }}
              style={{ ...S.btn, background: "#DC2626", boxShadow: "0 1px 2px rgba(220,38,38,.35), 0 6px 16px rgba(220,38,38,.25)", padding: "8px 16px" }}>
              ⚠ Urgent
            </button>
            {role === "admin" && (
              <>
                <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={exportData} title="Download everything as a JSON backup">Backup</button>
                <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={() => loadRef.current?.click()} title="Restore from a JSON backup">Restore</button>
                <input ref={loadRef} type="file" hidden accept=".json,application/json" onChange={(e) => { loadData(e.target.files?.[0]); e.target.value = ""; }} />
              </>
            )}
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={logOut}>Log out</button>
            {savedMsg && <Pill tone="green" style={{ fontSize: 10.5 }}>{savedMsg}</Pill>}
          </div>
        </div>
      </div>
      <div className="no-print" style={{ background: T.amberSoft, borderBottom: `1px solid ${T.amberLine}`, textAlign: "center", padding: "6px 14px", fontSize: 11.5, color: T.amber, fontWeight: 600 }}>
        Prototype demo — single browser, simulated notifications, first names only, no real student data.
      </div>

      {/* ---------- bell panel ---------- */}
      {bellOpen && (() => {
        const key = sessionKey();
        const since = key ? lastSeen[key] || 0 : 0;
        const items = relevantActivity().slice(0, 30);
        return (
          <div style={{ position: "fixed", top: 74, right: 18, width: 380, maxWidth: "calc(100vw - 36px)", maxHeight: "62vh", overflowY: "auto", zIndex: 60, ...S.card, boxShadow: T.shadowLift, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <span style={S.eyebrow}>Changes & updates</span>
              <span style={{ flex: 1 }} />
              <button style={{ ...S.btnGhost, padding: "2px 9px", fontSize: 11 }} onClick={() => { markSeen(); setBellOpen(false); }}>✕</button>
            </div>
            {!items.length && <div style={{ fontSize: 12.5, color: T.faint, padding: "10px 0" }}>Nothing yet — timetable changes, updates and alerts land here.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((a) => {
                const fresh = a.ts > since && a.byRole !== role;
                const tone = a.kind === "urgent" ? T.redSoft : a.kind === "flag" ? T.amberSoft : "#FAFBFD";
                const line = a.kind === "urgent" ? T.redLine : a.kind === "flag" ? T.amberLine : T.lineSoft;
                return (
                  <div key={a.id} style={{ borderRadius: 10, border: `1px solid ${line}`, background: tone, padding: "8px 10px" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 10.5, color: T.faint, fontWeight: 600 }}>
                      {fresh && <span style={{ width: 7, height: 7, borderRadius: 999, background: T.blue, flex: "0 0 auto" }} />}
                      {a.by} · {fmtWhen(a.ts)}
                      {a.kind === "urgent" && <Pill tone="red" style={{ padding: "0 8px", fontSize: 9 }}>URGENT</Pill>}
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>{a.text}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 80px" }}>

        {/* ================= TEAM ================= */}
        {role === "admin" && view === "team" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
            {/* aides */}
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={S.eyebrow}>Aides</span>
                <span style={{ flex: 1 }} />
                <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addAide}>+ Aide</button>
              </div>
              {!aides.length && (
                <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6 }}>
                  No aides yet. Add your team, or{" "}
                  <button onClick={loadSample}
                    style={{ border: "none", background: "none", cursor: "pointer", color: T.blueDeep, fontWeight: 700, fontSize: 13, padding: 0 }}>
                    load sample data
                  </button>{" "}
                  to see the tool working.
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {aides.map((a, ai) => {
                  const col = aideColor(ai);
                  const open = editAide === a.id;
                  const mates = students.filter((s) => (s.preferredAides || []).includes(a.id));
                  return (
                    <div key={a.id} style={{ border: `1px solid ${open ? col.line : T.lineSoft}`, borderLeft: `4px solid ${col.main}`, borderRadius: 10, padding: open ? "8px 11px" : "6px 11px", background: open ? col.soft : "#FCFDFE" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 999, background: col.main, color: col.on, fontSize: 9.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{initials(a.name)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13 }}>{a.name || "Unnamed aide"}</span>
                            <span style={{ fontSize: 10.5, color: T.faint }}>{DAYS.filter((d) => a.days?.[d]).join(" · ") || "No days set"}</span>
                          </div>
                          {!open && mates.length > 0 && (
                            <div style={{ fontSize: 10.5, color: T.sub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Works well with: <b>{mates.map((s) => s.name).join(", ")}</b></div>
                          )}
                        </div>
                        <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 11 }} onClick={() => setEditAide(open ? null : a.id)}>{open ? "Done" : "Edit"}</button>
                        <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }} onClick={() => removeAide(a.id)}>✕</button>
                      </div>
                      {open && (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                          <div>
                            <label style={S.label}>Name</label>
                            <input style={S.input} value={a.name} onChange={(e) => patchAide(a.id, { name: e.target.value })} placeholder="e.g. Karen M" />
                          </div>
                          <div>
                            <label style={S.label}>Works these days</label>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {DAYS.map((d) => (
                                <button key={d} onClick={() => patchAide(a.id, { days: { ...a.days, [d]: !a.days?.[d] } })}
                                  style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5,
                                    ...(a.days?.[d] ? { background: col.main, color: col.on, borderColor: col.main } : { color: T.faint }) }}>
                                  {d}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label style={S.label}>Notes</label>
                            <input style={S.input} value={a.notes || ""} onChange={(e) => patchAide(a.id, { notes: e.target.value })} placeholder="strengths, constraints, anything useful" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* students */}
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={S.eyebrow}>Students</span>
                <span style={{ flex: 1 }} />
                <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addStudent}>+ Student</button>
              </div>
              {!students.length && <div style={{ fontSize: 13, color: T.sub }}>No students yet — add each student who receives aide support.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {students.map((st) => {
                  const open = editStudent === st.id;
                  return (
                    <div key={st.id} style={{ border: `1px solid ${open ? T.blueLine : T.lineSoft}`, borderRadius: 10, padding: open ? "8px 11px" : "6px 11px", background: open ? T.blueSoft : "#FCFDFE" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13 }}>{st.name || "Unnamed student"}</span>
                            {st.cls && <span style={{ color: T.faint, fontWeight: 600, fontSize: 11 }}>{st.cls}</span>}
                            <span style={{ fontSize: 10.5, color: T.faint }}>
                              {st.idealPerDay}×/day
                              {st.fundedHrs != null && ` · ${st.fundedHrs}h`}
                              {(st.prioritySubjects || []).length > 0 && ` · ${st.prioritySubjects.join(", ")}`}
                            </span>
                          </div>
                        </div>
                        <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 11 }} onClick={() => setProfileId(st.id)}>Profile</button>
                        <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 11 }} onClick={() => setEditStudent(open ? null : st.id)}>{open ? "Done" : "Edit"}</button>
                        <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }} onClick={() => removeStudent(st.id)}>✕</button>
                      </div>
                      {open && (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                            <div>
                              <label style={S.label}>Name</label>
                              <input style={S.input} value={st.name} onChange={(e) => patchStudent(st.id, { name: e.target.value })} />
                            </div>
                            <div>
                              <label style={S.label}>Class</label>
                              <input style={S.input} list="cls-list" value={st.cls} onChange={(e) => patchStudent(st.id, { cls: e.target.value })} placeholder="3B" />
                              <datalist id="cls-list">{Object.keys(classes).map((c) => <option key={c} value={c} />)}</datalist>
                            </div>
                            <div>
                              <label style={S.label}>Ideal / day</label>
                              <input style={S.input} type="number" min={0} max={6} value={st.idealPerDay}
                                onChange={(e) => patchStudent(st.id, { idealPerDay: clamp(e.target.value, 0, 6) })} />
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                            <div>
                              <label style={S.label}>Funded h/wk <span style={{ color: T.faint, fontWeight: 500 }}>(optional)</span></label>
                              <input style={S.input} type="number" min={0} value={st.fundedHrs ?? ""} placeholder="—"
                                onChange={(e) => patchStudent(st.id, { fundedHrs: e.target.value === "" ? null : Number(e.target.value) })} />
                            </div>
                            <div>
                              <label style={S.label}>Priority subjects / events</label>
                              <input style={S.input} value={(st.prioritySubjects || []).join(", ")}
                                onChange={(e) => patchStudent(st.id, { prioritySubjects: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                                placeholder="Reading, Maths, Assembly" />
                              {(() => { const clsSubs = subjectsForClass(st.cls); return clsSubs.length > 0 && (
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                                  <span style={{ fontSize: 10, color: T.faint, fontWeight: 600, width: "100%" }}>From {st.cls || "this class"}'s timetable:</span>
                                  {clsSubs.slice(0, 16).map((sub) => {
                                    const on = (st.prioritySubjects || []).some((p) => p.toLowerCase() === sub.toLowerCase());
                                    return (
                                      <button key={sub} onClick={() => patchStudent(st.id, {
                                        prioritySubjects: on ? st.prioritySubjects.filter((p) => p.toLowerCase() !== sub.toLowerCase()) : [...(st.prioritySubjects || []), sub],
                                      })}
                                        style={{ ...S.btnGhost, padding: "2px 9px", fontSize: 10.5,
                                          ...(on ? { background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep } : { color: T.faint }) }}>
                                        {sub}
                                      </button>
                                    );
                                  })}
                                </div>
                              ); })()}
                            </div>
                          </div>
                          <div>
                            <label style={S.label}>Works well with</label>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {aides.map((a, ai) => {
                                const on = (st.preferredAides || []).includes(a.id);
                                const col = aideColor(ai);
                                return (
                                  <button key={a.id} onClick={() => patchStudent(st.id, {
                                    preferredAides: on ? st.preferredAides.filter((x) => x !== a.id) : [...(st.preferredAides || []), a.id],
                                  })}
                                    style={{ ...S.btnGhost, padding: "4px 12px", fontSize: 11.5,
                                      ...(on ? { background: col.main, color: col.on, borderColor: col.main } : { color: T.sub }) }}>
                                    {a.name || "Unnamed"}
                                  </button>
                                );
                              })}
                              {!aides.length && <span style={{ fontSize: 12, color: T.faint }}>Add aides first</span>}
                            </div>
                          </div>
                          <div>
                            <label style={S.label}>Notes</label>
                            <input style={S.input} value={st.notes || ""} onChange={(e) => patchStudent(st.id, { notes: e.target.value })} placeholder="regulation supports, triggers, wins" />
                          </div>
                          {classes[st.cls] && (
                            <div>
                              <label style={S.label}>Suggested support sessions <span style={{ color: T.faint, fontWeight: 500 }}>(from {st.cls}'s timetable + priorities)</span></label>
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                {DAYS.map((d) => (
                                  <div key={d} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                                    <span style={{ width: 34, color: T.faint, fontWeight: 700 }}>{d}</span>
                                    {suggestedSessions(st, d).map(({ s, i }) => (
                                      <Pill key={s.id} tone={isPriority(st, subjectFor(st, d, i)) ? "blue" : "plain"} style={{ padding: "2px 9px", fontSize: 10.5 }}>
                                        {s.label.replace("Session ", "S")}{subjectFor(st, d, i) ? ` · ${subjectFor(st, d, i)}` : ""}
                                      </Pill>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ================= CLASSES ================= */}
        {role === "admin" && view === "classes" && (
          <div style={{ ...S.card, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={S.eyebrow}>Year-level class timetables</span>
              <span style={{ flex: 1 }} />
              <button style={S.btnGhost} onClick={() => { setImpMode("classtt"); setView("import"); }}>Upload a timetable</button>
              <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={() => {
                const name = window.prompt("Class code (e.g. 3B):");
                if (!name?.trim()) return;
                setClasses((c) => ({ ...c, [name.trim()]: { year: "", tt: Object.fromEntries(DAYS.map((d) => [d, ["", "", "", "", "", ""]])) } }));
                setClsOpen(name.trim());
              }}>+ Class</button>
            </div>
            <div style={{ fontSize: 13, color: T.sub, marginBottom: 14, lineHeight: 1.55 }}>
              Each class carries six 50-minute sessions a day. The week grid reads these to label what a student's
              class is doing in every session — and Suggest Week uses them to land support on priority subjects.
            </div>
            {!Object.keys(classes).length && <div style={{ fontSize: 13, color: T.faint }}>No classes yet — add one, or import from the Import tab.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(classes).sort(([a], [b]) => a.localeCompare(b)).map(([name, c]) => {
                const open = clsOpen === name;
                const kids = students.filter((s) => s.cls === name);
                return (
                  <div key={name} style={{ border: `1px solid ${open ? T.blueLine : T.lineSoft}`, borderRadius: 12, background: open ? "#FCFDFF" : "#FCFDFE" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }} onClick={() => setClsOpen(open ? null : name)}>
                      <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: 14 }}>{name}</span>
                      {c.year && <Pill style={{ padding: "2px 10px", fontSize: 10.5 }}>Year {c.year}</Pill>}
                      <span style={{ fontSize: 11.5, color: T.sub }}>
                        {kids.length ? `${kids.length} supported student${kids.length > 1 ? "s" : ""}: ${kids.map((k) => k.name).join(", ")}` : "no supported students"}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }}
                        onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete class ${name}?`)) setClasses((cs) => { const n = { ...cs }; delete n[name]; return n; }); }}>✕</button>
                      <span style={{ color: T.faint, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
                    </div>
                    {open && (
                      <div style={{ padding: "0 14px 14px" }}>
                        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
                          <label style={{ ...S.label, marginBottom: 0 }}>Year level</label>
                          <input style={{ ...S.input, width: 70 }} value={c.year || ""} onChange={(e) => setClasses((cs) => ({ ...cs, [name]: { ...c, year: e.target.value } }))} placeholder="3" />
                        </div>
                        <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: 12 }}>
                          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 820 }}>
                            <thead>
                              <tr>
                                <th style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: T.faint, textAlign: "left", borderBottom: `1px solid ${T.line}`, minWidth: 96 }}></th>
                                {BLOCKS.map((b) => (
                                  <th key={b.id} style={{ padding: "8px 6px", fontSize: 10.5, fontWeight: 700, textAlign: "center",
                                    color: b.kind === "break" ? T.amber : T.ink, background: b.kind === "break" ? T.amberSoft : undefined,
                                    borderBottom: `1px solid ${T.line}`, minWidth: b.kind === "break" ? 48 : 100 }}>
                                    {b.label}<div style={{ fontSize: 9, fontWeight: 600, color: T.faint }}>{b.time}</div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {DAYS.map((d) => (
                                <tr key={d}>
                                  <td style={{ padding: "5px 10px", fontSize: 12, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", borderBottom: `1px solid ${T.lineSoft}` }}>{DAY_LABEL[d]}</td>
                                  {BLOCKS.map((b) => {
                                    if (b.kind === "break") return <td key={b.id} style={{ background: "#FFFDF4", borderBottom: `1px solid ${T.lineSoft}`, borderLeft: `1px solid ${T.lineSoft}` }} />;
                                    const i = SESSIONS.findIndex((s) => s.id === b.id);
                                    return (
                                      <td key={b.id} style={{ padding: 3, borderBottom: `1px solid ${T.lineSoft}`, borderLeft: `1px solid ${T.lineSoft}` }}>
                                        <input style={{ ...S.input, padding: "6px 8px", fontSize: 12, borderRadius: 8 }}
                                          value={c.tt?.[d]?.[i] || ""}
                                          onChange={(e) => setClasses((cs) => {
                                            const tt = { ...c.tt, [d]: [...(c.tt?.[d] || ["", "", "", "", "", ""])] };
                                            tt[d][i] = e.target.value;
                                            return { ...cs, [name]: { ...c, tt } };
                                          })} />
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= WEEK ================= */}
        {role === "admin" && view === "week" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {!wholeWeek && <DayPills value={day} onChange={setDay} />}
              <span style={{ flex: 1 }} />
              <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 999, overflow: "hidden" }}>
                {[["student", "By student"], ["aide", "By aide"]].map(([k, lab]) => (
                  <button key={k} onClick={() => setWeekBy(k)}
                    style={{ border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                      background: weekBy === k ? T.ink : "transparent", color: weekBy === k ? "#FFF" : T.sub }}>{lab}</button>
                ))}
              </div>
              <Toggle on={wholeWeek} onClick={() => setWholeWeek(!wholeWeek)}>Whole week</Toggle>
              <button style={S.btnGhost} onClick={() => window.print()}>Print</button>
              <button style={S.btn} onClick={suggestWeek}>✦ Suggest week</button>
            </div>
            <div style={{ fontSize: 12, color: T.sub }} className="no-print">
              {weekBy === "student"
                ? "Students down the side, like the paper timetable — each cell is coloured by the aide supporting them. Tap a name to open a profile. Switch to By aide to assign students."
                : "Tap any cell to assign students. Blue subject labels = a priority subject for that student. Amber columns are breaks — assign a student there for break-time support, or they show yard duty from the Yard tab."}
            </div>
            {(wholeWeek ? DAYS : [day]).map((dy) => (
              <div key={dy}>
                {wholeWeek && <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16, margin: "8px 0 6px" }}>{DAY_LABEL[dy]}</div>}
                {weekBy === "student" ? <StudentGrid dy={dy} mode="base" /> : <DayGrid dy={dy} mode="base" />}
              </div>
            ))}
            {/* per-student week summary strip */}
            {students.length > 0 && (
              <div style={{ ...S.card, padding: 14 }}>
                <span style={S.eyebrow}>This week at a glance</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {students.map((st) => {
                    const mins = weekMinutes(st.id);
                    const ideal = clamp(st.idealPerDay, 0, 6) * 5 * SESSION_MIN;
                    const tone = mins >= ideal ? "green" : mins >= ideal * 0.6 ? "amber" : "red";
                    return <Pill key={st.id} tone={tone} style={{ fontSize: 11 }}>{st.name} · {hrs(mins)} / {hrs(ideal)}</Pill>;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TODAY ================= */}
        {role === "admin" && view === "today" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} className="no-print">
              <DayPills value={day} onChange={setDay} />
              <span style={{ flex: 1 }} />
              {dayHasChanges(day) && <button style={{ ...S.btnGhost, color: T.red, borderColor: T.redLine }} onClick={() => resetDay(day)}>Reset {day}</button>}
            </div>
            <div style={{ ...S.card, padding: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={S.label}>Student absences <span style={{ color: T.faint, fontWeight: 500 }}>(tap to toggle)</span></label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {students.map((st) => {
                      const off = ovFor(day).absentS.includes(st.id);
                      return (
                        <button key={st.id} onClick={() => toggleAbsent(day, "s", st.id)}
                          style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5,
                            ...(off ? { background: T.redSoft, borderColor: T.redLine, color: T.red, textDecoration: "line-through" } : {}) }}>
                          {st.name}
                        </button>
                      );
                    })}
                    {!students.length && <span style={{ fontSize: 12, color: T.faint }}>No students yet</span>}
                  </div>
                </div>
                <div>
                  <label style={S.label}>Aide absences</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {aides.filter((a) => a.days?.[day]).map((a) => {
                      const off = ovFor(day).absentA.includes(a.id);
                      return (
                        <button key={a.id} onClick={() => toggleAbsent(day, "a", a.id)}
                          style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5,
                            ...(off ? { background: T.redSoft, borderColor: T.redLine, color: T.red, textDecoration: "line-through" } : {}) }}>
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={S.label}>What's popped up today</label>
                <textarea style={{ ...S.input, minHeight: 54, resize: "vertical" }} value={ovFor(day).note}
                  onChange={(e) => setDayOv((m) => ({ ...m, [day]: { absentS: [], absentA: [], cells: {}, ...(m[day] || {}), note: e.target.value } }))}
                  placeholder="Excursion for 3B after lunch · photographer at 10am · Cooper unsettled at drop-off" />
              </div>
            </div>
            <div style={{ fontSize: 12, color: T.sub }} className="no-print">
              This is the base week with today's reality layered on top — the Week tab is untouched. Red cells need cover:
              tap them to reassign. Amber dots mark cells changed just for today.
            </div>
            <DayGrid dy={day} mode="today" />
          </div>
        )}

        {/* ================= YARD DUTY ================= */}
        {role === "admin" && view === "yard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} className="no-print">
              {!wholeWeek && <DayPills value={day} onChange={setDay} />}
              <span style={{ flex: 1 }} />
              <Toggle on={wholeWeek} onClick={() => setWholeWeek(!wholeWeek)}>Whole week</Toggle>
              <button style={S.btnGhost} onClick={() => window.print()}>Print</button>
              <button style={S.btn} onClick={suggestYard}>✦ Suggest roster</button>
            </div>
            <div style={{ ...S.card, padding: 14 }} className="no-print">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={S.label}>Duty areas</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {yardAreas.map((ar) => (
                      <Pill key={ar} tone="amber" style={{ fontSize: 11 }}>
                        {ar}
                        <button onClick={() => {
                          if (!window.confirm(`Remove area "${ar}" and its duties?`)) return;
                          setYardAreas((xs) => xs.filter((x) => x !== ar));
                          setYard((y) => Object.fromEntries(Object.entries(y).filter(([k]) => !k.endsWith(`|${ar}`))));
                        }} style={{ border: "none", background: "none", cursor: "pointer", color: T.amber, padding: 0, fontSize: 11 }}>✕</button>
                      </Pill>
                    ))}
                    <button style={{ ...S.btnGhost, padding: "4px 12px", fontSize: 11 }} onClick={() => {
                      const ar = window.prompt("New duty area:");
                      if (ar?.trim() && !yardAreas.includes(ar.trim())) setYardAreas((xs) => [...xs, ar.trim()]);
                    }}>+ Area</button>
                  </div>
                </div>
                <div>
                  <label style={S.label}>Extra staff in the pool <span style={{ color: T.faint, fontWeight: 500 }}>(teachers, principal…)</span></label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {extraStaff.map((n) => (
                      <Pill key={n} style={{ fontSize: 11 }}>
                        {n}
                        <button onClick={() => setExtraStaff((xs) => xs.filter((x) => x !== n))}
                          style={{ border: "none", background: "none", cursor: "pointer", color: T.faint, padding: 0, fontSize: 11 }}>✕</button>
                      </Pill>
                    ))}
                    <button style={{ ...S.btnGhost, padding: "4px 12px", fontSize: 11 }} onClick={() => {
                      const n = window.prompt("Staff name:");
                      if (n?.trim() && !extraStaff.includes(n.trim())) setExtraStaff((xs) => [...xs, n.trim()]);
                    }}>+ Staff</button>
                  </div>
                </div>
              </div>
            </div>
            {(wholeWeek ? DAYS : [day]).map((dy) => (
              <div key={dy}>
                {wholeWeek && <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16, margin: "8px 0 6px" }}>{DAY_LABEL[dy]}</div>}
                <div style={{ overflowX: "auto", border: `1px solid ${T.line}`, borderRadius: 14, background: T.card }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: T.faint, borderBottom: `1px solid ${T.line}` }}>{DAY_LABEL[dy]}</th>
                        {yardAreas.map((ar) => (
                          <th key={ar} style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, fontWeight: 700, color: T.ink, borderBottom: `1px solid ${T.line}` }}>{ar}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {YARD_SLOTS.map((slot) => (
                        <tr key={slot.id}>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${T.lineSoft}`, whiteSpace: "nowrap" }}>
                            <div style={{ fontWeight: 700, fontSize: 12, color: T.amber }}>{slot.label}</div>
                            <div style={{ fontSize: 9.5, color: T.faint, fontWeight: 600 }}>{slot.time}</div>
                          </td>
                          {yardAreas.map((ar) => {
                            const k = `${dy}|${slot.id}|${ar}`;
                            const pool = [...aides.filter((a) => a.days?.[dy]).map((a) => a.name), ...extraStaff].filter(Boolean);
                            return (
                              <td key={ar} style={{ padding: 4, borderBottom: `1px solid ${T.lineSoft}`, borderLeft: `1px solid ${T.lineSoft}` }}>
                                <select style={{ ...S.input, padding: "6px 8px", fontSize: 12, borderRadius: 8, appearance: "auto", background: yard[k] ? T.amberSoft : T.card, borderColor: yard[k] ? T.amberLine : T.line }}
                                  value={yard[k] || ""}
                                  onChange={(e) => setYard((y) => { const n = { ...y }; if (e.target.value) n[k] = e.target.value; else delete n[k]; return n; })}>
                                  <option value="">—</option>
                                  {pool.map((n) => <option key={n} value={n}>{n}</option>)}
                                  {yard[k] && !pool.includes(yard[k]) && <option value={yard[k]}>{yard[k]}</option>}
                                </select>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {/* fairness strip */}
            {(aides.length > 0 || extraStaff.length > 0) && (
              <div style={{ ...S.card, padding: 14 }}>
                <span style={S.eyebrow}>Duties per person this week</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {[...aides.map((a) => a.name), ...extraStaff].filter(Boolean).map((n) => (
                    <Pill key={n} style={{ fontSize: 11 }}>{n} · {aideYardCount(n)}</Pill>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= HOURS ================= */}
        {role === "admin" && view === "hours" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ ...S.card, padding: 22 }}>
              <span style={S.eyebrow}>Support hours per student</span>
              <div style={{ fontSize: 12.5, color: T.sub, margin: "8px 0 14px" }}>
                Planned = the base week grid. This week = after today-tab absences and changes. Ideal = ideal sessions × 5 days.
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                  <thead>
                    <tr>
                      {["Student", "Class", "Ideal / wk", "Planned", "This week", "Funded", ""].map((h) => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700, color: T.faint, borderBottom: `1px solid ${T.line}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((st) => {
                      const ideal = clamp(st.idealPerDay, 0, 6) * 5 * SESSION_MIN;
                      const planned = weekMinutes(st.id);
                      const eff = weekMinutes(st.id, true);
                      const funded = st.fundedHrs != null ? st.fundedHrs * 60 : null;
                      const target = funded ?? ideal;
                      const pct = target ? Math.min(100, Math.round((planned / target) * 100)) : 0;
                      return (
                        <tr key={st.id}>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.lineSoft}`, fontWeight: 700, fontFamily: F.display, fontSize: 13 }}>{st.name}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.lineSoft}`, fontSize: 12, color: T.sub }}>{st.cls || "—"}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.lineSoft}`, fontSize: 12 }}>{hrs(ideal)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.lineSoft}`, fontSize: 12, fontWeight: 700, color: planned >= ideal ? T.green : T.ink }}>{hrs(planned)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.lineSoft}`, fontSize: 12, color: eff < planned ? T.amber : T.sub }}>{hrs(eff)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.lineSoft}`, fontSize: 12, color: T.sub }}>{funded != null ? hrs(funded) : "—"}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${T.lineSoft}`, minWidth: 140 }}>
                            <div style={{ height: 8, borderRadius: 999, background: T.lineSoft, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: pct >= 100 ? "#22C55E" : pct >= 60 ? T.blue : "#F59E0B", transition: "width .2s" }} />
                            </div>
                            <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>{pct}% of {funded != null ? "funded" : "ideal"}</div>
                          </td>
                        </tr>
                      );
                    })}
                    {!students.length && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: T.faint, fontSize: 13 }}>Add students in the Team tab.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ ...S.card, padding: 22 }}>
              <span style={S.eyebrow}>Load per aide</span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                {aides.map((a, ai) => {
                  const { n, breaks } = aideWeekSessions(a.id);
                  const col = aideColor(ai);
                  const daysIn = DAYS.filter((d) => a.days?.[d]).length;
                  return (
                    <div key={a.id} style={{ border: `1px solid ${col.line}`, borderLeft: `4px solid ${col.main}`, borderRadius: 12, padding: "10px 14px", background: col.soft, minWidth: 190 }}>
                      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13.5, color: col.text }}>{a.name || "Unnamed"}</div>
                      <div style={{ fontSize: 11.5, color: T.sub, marginTop: 4, lineHeight: 1.6 }}>
                        {n} support sessions ({hrs(n * SESSION_MIN)}) · {daysIn} day{daysIn !== 1 ? "s" : ""}/wk<br />
                        {breaks} break-time supports · {aideYardCount(a.name)} yard duties
                      </div>
                    </div>
                  );
                })}
                {!aides.length && <span style={{ fontSize: 13, color: T.faint }}>Add aides in the Team tab.</span>}
              </div>
            </div>
          </div>
        )}

        {/* ================= IMPORT ================= */}
        {role === "admin" && view === "import" && (
          <div style={{ ...S.card, padding: 22 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
              {[["preinfo", "Pre-information — aides & students"], ["classtt", "Year-level class timetables"], ["weektt", "Current aide timetable"]].map(([k, lab]) => (
                <button key={k} onClick={() => { setImpMode(k); setImpPreview(null); setImpErr(""); }}
                  style={{ ...S.btnGhost, ...(impMode === k ? { background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep } : {}) }}>
                  {lab}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6, marginBottom: 14 }}>
              {impMode === "preinfo"
                ? "Paste or upload anything that lists your aides and students — a handover doc, funding spreadsheet, last term's timetable, an email. It's parsed into aides (with working days) and students (class, ideal sessions, funded hours, priority subjects, preferred aides) and pre-fills the Team tab. Existing names are updated, new ones added."
                : impMode === "classtt"
                ? "Upload or paste a year-level timetable — the schedule is mapped onto the six-session day for each class, so the week grid knows what every student's class is doing in every session."
                : "Already running an aide timetable in Word, Excel or on paper? Upload or paste it and every assignment is read straight into the Week grid — mapped onto the six-session day, with break-time support landing on recess and lunch. Aides and students it mentions who aren't in the Team tab yet are created automatically (aides get the days they appear on), and existing cells are kept: the import fills on top of them."}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button style={S.btnGhost} onClick={() => fileRef.current?.click()} disabled={impBusy}>Upload file (.docx · .xlsx · .pdf · image)</button>
              <input ref={fileRef} type="file" hidden accept=".txt,.md,.csv,.tsv,.docx,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.gif"
                onChange={(e) => { onImportFile(e.target.files?.[0]); e.target.value = ""; }} />
              <span style={{ fontSize: 12, color: T.faint }}>or paste below</span>
            </div>
            <textarea style={{ ...S.input, minHeight: 140, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              value={impText} onChange={(e) => setImpText(e.target.value)}
              placeholder={impMode === "preinfo"
                ? "Karen works Mon–Fri. Priya works Mon, Tue, Wed and is great with Cooper (5C, 16 funded hours, needs support in Writing and Maths, ideally 4 sessions a day)…"
                : impMode === "classtt"
                ? "Year 3 timetable…\nMon 9:00 Reading, 9:50 Writing, 11:10 Maths…"
                : "Mon: Karen with Archie 9:00–10:40, Cooper after recess…\nTue: Priya — Billie session 1, lunch support with Cooper…"} />
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              <button style={S.btn} disabled={impBusy || !impText.trim()} onClick={() => runImport(impText)}>
                {impBusy ? "Reading…" : "✦ Parse with Claude"}
              </button>
              {impErr && <Pill tone="red" style={{ fontSize: 11 }}>{impErr}</Pill>}
            </div>
            {impPreview && (
              <div style={{ marginTop: 16, border: `1px solid ${T.greenLine}`, borderRadius: 12, background: T.greenSoft, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: T.green, marginBottom: 8 }}>Found — review, then apply:</div>
                {impMode === "preinfo" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                    {(impPreview.aides || []).map((a, i) => (
                      <div key={i}>🧑‍🏫 <b>{a.name}</b> — {(a.days || DAYS).join(", ")}{a.notes ? ` · ${a.notes}` : ""}</div>
                    ))}
                    {(impPreview.students || []).map((s2, i) => (
                      <div key={i}>🎒 <b>{s2.name}</b>{s2.cls ? ` (${s2.cls})` : ""} — {s2.idealPerDay ?? 2}/day
                        {s2.fundedHrs != null ? ` · ${s2.fundedHrs}h funded` : ""}
                        {(s2.prioritySubjects || []).length ? ` · priority: ${s2.prioritySubjects.join(", ")}` : ""}
                        {(s2.preferredAides || []).length ? ` · with: ${s2.preferredAides.join(", ")}` : ""}</div>
                    ))}
                    {!(impPreview.aides || []).length && !(impPreview.students || []).length && <div style={{ color: T.sub }}>Nothing recognisable found.</div>}
                  </div>
                ) : impMode === "weektt" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                    {(() => {
                      const asg = (impPreview.assignments || []).filter((x) => DAYS.includes(x.day) && BLOCKS.some((b) => b.id === x.block));
                      const blockLabel = (id) => BLOCKS.find((b) => b.id === id)?.label || id;
                      const newAides = [...new Set(asg.map((x) => x.aide).filter((n) => n && !matchByName(aides, n)))];
                      const newStudents = [...new Set(asg.flatMap((x) => x.students || []).filter((n) => n && !matchByName(students, n)))];
                      return (
                        <>
                          {DAYS.filter((d) => asg.some((x) => x.day === d)).map((d) => (
                            <div key={d}>📅 <b>{DAY_LABEL[d]}</b> — {asg.filter((x) => x.day === d)
                              .map((x) => `${x.aide} → ${(x.students || []).join(", ")} (${blockLabel(x.block)})`).join(" · ")}</div>
                          ))}
                          {newAides.length > 0 && <div style={{ color: T.amber }}>Will add aides: <b>{newAides.join(", ")}</b></div>}
                          {newStudents.length > 0 && <div style={{ color: T.amber }}>Will add students: <b>{newStudents.join(", ")}</b></div>}
                          {!asg.length && <div style={{ color: T.sub }}>No assignments recognised — check the timetable names days and students.</div>}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                    {(impPreview.classes || []).map((c, i) => (
                      <div key={i}>🏫 <b>{c.name}</b>{c.year ? ` (Year ${c.year})` : ""} — Mon: {(c.tt?.Mon || []).filter(Boolean).join(" · ") || "?"}</div>
                    ))}
                    {!(impPreview.classes || []).length && <div style={{ color: T.sub }}>No classes recognised.</div>}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button style={S.btn} onClick={applyPreview}>Apply</button>
                  <button style={S.btnGhost} onClick={() => setImpPreview(null)}>Discard</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= AIDE — MY DAY ================= */}
        {view === "aide-home" && role === "aide" && (() => {
          const me = aideById(roleId);
          const ov = ovFor(day);
          const meAbsent = ov.absentA.includes(roleId);
          const working = !!me?.days?.[day];
          const myIds = aideStudentIds(roleId);
          const recentNotes = myIds.flatMap((sid) => flagsFor(sid).map((f) => ({ ...f, sid })))
            .filter((f) => f.ts > Date.now() - 3 * 86400000).sort((a, b) => b.ts - a.ts).slice(0, 6);
          const changedCount = Object.keys(ov.cells || {}).filter((k) => k.endsWith(`|${roleId}`)).length;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760, margin: "0 auto" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <DayPills value={day} onChange={setDay} />
              </div>
              {changedCount > 0 && (
                <div style={{ borderRadius: 12, border: `1px solid ${T.amberLine}`, background: T.amberSoft, padding: "10px 14px", fontSize: 12.5, color: T.amber, fontWeight: 600 }}>
                  ⚠ {changedCount} of your {DAY_LABEL[day]} sessions {changedCount === 1 ? "has" : "have"} changed from the base week — changed cells wear an amber dot.
                </div>
              )}
              {ov.note && (
                <div style={{ borderRadius: 12, border: `1px solid ${T.blueLine}`, background: T.blueSoft, padding: "10px 14px", fontSize: 12.5, color: T.blueDeep }}>
                  📌 {ov.note}
                </div>
              )}
              {meAbsent && <div style={{ borderRadius: 12, border: `1px solid ${T.redLine}`, background: T.redSoft, padding: "10px 14px", fontSize: 12.5, color: T.red, fontWeight: 700 }}>You're marked absent {DAY_LABEL[day]} — your sessions are being covered.</div>}
              {!working && !meAbsent && <div style={{ ...S.card, textAlign: "center", color: T.sub, fontSize: 13.5 }}>You don't work {DAY_LABEL[day]}s — enjoy the day off.</div>}
              {working && !meAbsent && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {BLOCKS.map((b) => {
                    const ids = effPairs(day, b.id, roleId);
                    const changed = ov.cells && ov.cells[`${b.id}|${roleId}`] !== undefined;
                    const duty = b.kind === "break" ? dutyFor(day, b.id, me) : [];
                    const si = SESSIONS.findIndex((s) => s.id === b.id);
                    const isBreak = b.kind === "break";
                    return (
                      <div key={b.id} style={{ ...S.card, padding: "12px 16px", borderLeft: `4px solid ${isBreak ? "#F59E0B" : ids.length ? T.blue : T.line}`, background: isBreak ? "#FFFDF4" : T.card }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ minWidth: 96 }}>
                            <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 13.5, color: isBreak ? T.amber : T.ink }}>{b.label}</div>
                            <div style={{ fontSize: 10.5, color: T.faint, fontWeight: 600 }}>{b.time}</div>
                          </div>
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                            {ids.map((sid) => {
                              const st = studentById(sid);
                              const absent = ov.absentS.includes(sid);
                              const subj = !isBreak && st ? subjectFor(st, day, si) : "";
                              const done = !isBreak && reflectionDone(day, b.id, roleId, sid);
                              return (
                                <div key={sid} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  <button onClick={() => setProfileId(sid)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}>
                                    <StudentChip st={st} struck={absent} />
                                  </button>
                                  {subj && <span style={{ fontSize: 11.5, fontWeight: 600, color: st && isPriority(st, subj) ? T.blueDeep : T.faint }}>{subj}</span>}
                                  {absent && <Pill tone="red" style={{ padding: "1px 8px", fontSize: 9.5 }}>absent</Pill>}
                                  {!isBreak && !absent && (
                                    done
                                      ? <Pill tone="green" style={{ padding: "1px 9px", fontSize: 9.5 }}>✓ reflected</Pill>
                                      : <button onClick={() => { setReflectFor({ day, block: b.id, aideId: roleId, studentId: sid }); setReflectEng(0); setReflectReg(0); setReflectNote(""); }}
                                          style={{ ...S.btnGhost, padding: "2px 10px", fontSize: 10.5 }}>Reflect</button>
                                  )}
                                </div>
                              );
                            })}
                            {isBreak && duty.map((d2) => (
                              <span key={d2} style={{ fontSize: 11, fontWeight: 700, color: T.amber }}>Yard duty · {d2}</span>
                            ))}
                            {!ids.length && !duty.length && (
                              <span style={{ fontSize: 12, color: T.faint }}>{isBreak ? "Break — all yours" : "Free — may be used for cover"}</span>
                            )}
                          </div>
                          {changed && <span title="Changed today" style={{ width: 9, height: 9, borderRadius: 999, background: "#F59E0B", flex: "0 0 auto" }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={S.btn} onClick={() => { setFlagFor("pick"); setFlagCatSel("heads-up"); setFlagText(""); }}>+ Update / tag a student</button>
              </div>
              {recentNotes.length > 0 && (
                <div style={{ ...S.card, padding: 16 }}>
                  <span style={S.eyebrow}>Recent notes on your students</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                    {recentNotes.map((f) => {
                      const cat = flagCat(f.category);
                      return (
                        <div key={f.id} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                          <Pill tone={cat.tone} style={{ padding: "1px 9px", fontSize: 9.5, marginRight: 6 }}>{cat.label}</Pill>
                          <b>{studentById(f.sid)?.name}</b> — {f.text}
                          <span style={{ color: T.faint, fontSize: 10.5 }}> · {f.by}, {fmtWhen(f.ts)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ================= AIDE — MY WEEK ================= */}
        {view === "aide-week" && role === "aide" && (() => {
          const me = aideById(roleId);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 12.5, color: T.sub }}>
                Your base week — the plan as it stands. Check <b>My day</b> each morning for what's actually on.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                {DAYS.map((dy) => {
                  const working = !!me?.days?.[dy];
                  return (
                    <div key={dy} style={{ ...S.card, padding: 14, opacity: working ? 1 : 0.55 }}>
                      <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
                        {DAY_LABEL[dy]}{dayHasChanges(dy) && <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: "#F59E0B", marginLeft: 6 }} title="Has day-of changes" />}
                      </div>
                      {!working && <div style={{ fontSize: 12, color: T.faint }}>Not working</div>}
                      {working && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {BLOCKS.map((b) => {
                            const ids = basePairs(dy, b.id, roleId);
                            const duty = b.kind === "break" ? dutyFor(dy, b.id, me) : [];
                            if (!ids.length && !duty.length) return null;
                            const si = SESSIONS.findIndex((s) => s.id === b.id);
                            return (
                              <div key={b.id} style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                                <span style={{ fontWeight: 700, color: b.kind === "break" ? T.amber : T.blueDeep }}>{b.label.replace("Session ", "S")}</span>{" "}
                                {ids.map((sid) => {
                                  const st = studentById(sid);
                                  const subj = st && si >= 0 ? subjectFor(st, dy, si) : "";
                                  return <span key={sid}>{st?.name}{subj ? ` · ${subj}` : ""}{" "}</span>;
                                })}
                                {duty.map((d2) => <span key={d2} style={{ color: T.amber }}>Yard · {d2}</span>)}
                              </div>
                            );
                          })}
                          {BLOCKS.every((b) => !basePairs(dy, b.id, roleId).length && !(b.kind === "break" && dutyFor(dy, b.id, me).length)) && (
                            <div style={{ fontSize: 12, color: T.faint }}>Nothing rostered yet</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ================= TEACHER — MY CLASS ================= */}
        {view === "teacher-home" && role === "teacher" && (() => {
          const myKids = students.filter((s) => s.cls === roleId);
          const ov = ovFor(day);
          const kidFeed = myKids.flatMap((s) => flagsFor(s.id).map((f) => ({ ...f, sid: s.id })))
            .filter((f) => f.ts > Date.now() - 7 * 86400000).sort((a, b) => b.ts - a.ts).slice(0, 8);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 860, margin: "0 auto" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <DayPills value={day} onChange={setDay} />
                <span style={{ flex: 1 }} />
                <button style={S.btn} onClick={() => { setFlagFor("pick"); setFlagCatSel("heads-up"); setFlagText(""); }}>+ Update / tag a student</button>
              </div>
              {ov.note && (
                <div style={{ borderRadius: 12, border: `1px solid ${T.blueLine}`, background: T.blueSoft, padding: "10px 14px", fontSize: 12.5, color: T.blueDeep }}>📌 {ov.note}</div>
              )}
              {!myKids.length && <div style={{ ...S.card, textAlign: "center", color: T.sub, fontSize: 13.5 }}>No supported students recorded for {roleId} yet.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {myKids.map((st) => {
                  const absent = ov.absentS.includes(st.id);
                  const sessionsToday = BLOCKS.map((b) => {
                    const aide = aides.find((a) => effPairs(day, b.id, a.id).includes(st.id));
                    return aide ? { b, aide } : null;
                  }).filter(Boolean);
                  return (
                    <div key={st.id} style={{ ...S.card, padding: 16, borderLeft: `4px solid ${absent ? "#EF4444" : T.blue}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 15, ...(absent ? { textDecoration: "line-through", color: T.red } : {}) }}>
                          {st.name}
                        </div>
                        {absent && <Pill tone="red" style={{ padding: "1px 9px", fontSize: 9.5 }}>absent today</Pill>}
                        <span style={{ fontSize: 11.5, color: T.sub }}>{sessionsToday.filter((x) => x.b.kind === "session").length}/{st.idealPerDay} ideal sessions covered {DAY_LABEL[day]}</span>
                        <span style={{ flex: 1 }} />
                        <button style={{ ...S.btnGhost, padding: "3px 12px", fontSize: 11 }} onClick={() => setProfileId(st.id)}>Profile</button>
                        <button style={{ ...S.btnGhost, padding: "3px 12px", fontSize: 11 }} onClick={() => { setFlagFor(st.id); setFlagCatSel("heads-up"); setFlagText(""); }}>+ Update</button>
                      </div>
                      {!absent && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                          {sessionsToday.map(({ b, aide }) => {
                            const si = SESSIONS.findIndex((s) => s.id === b.id);
                            const subj = si >= 0 ? subjectFor(st, day, si) : "";
                            return (
                              <Pill key={b.id} tone={b.kind === "break" ? "amber" : "blue"} style={{ fontSize: 10.5, padding: "3px 11px" }}>
                                {b.label.replace("Session ", "S")} · {aide.name}{subj ? ` · ${subj}` : b.kind === "break" ? " · break support" : ""}
                              </Pill>
                            );
                          })}
                          {!sessionsToday.length && <span style={{ fontSize: 12, color: T.faint }}>No aide sessions {DAY_LABEL[day]}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {kidFeed.length > 0 && (
                <div style={{ ...S.card, padding: 16 }}>
                  <span style={S.eyebrow}>This week's updates on your students</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                    {kidFeed.map((f) => {
                      const cat = flagCat(f.category);
                      return (
                        <div key={f.id} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                          <Pill tone={cat.tone} style={{ padding: "1px 9px", fontSize: 9.5, marginRight: 6 }}>{cat.label}</Pill>
                          <b>{studentById(f.sid)?.name}</b> — {f.text}
                          <span style={{ color: T.faint, fontSize: 10.5 }}> · {f.by}, {fmtWhen(f.ts)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ================= INSIGHTS (admin) ================= */}
        {view === "insights" && role === "admin" && (() => {
          const now = Date.now();
          const softWatch = students.filter((st) => flagsFor(st.id).filter((f) => f.category === "soft-signs" && f.ts > now - 14 * 86400000).length >= 2);
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 12.5, color: T.sub }}>
                Patterns over time — flags by category, four-week trend, and how sessions feel by aide pairing (from reflections).
              </div>
              {softWatch.length > 0 && (
                <div style={{ borderRadius: 12, border: `1px solid ${T.amberLine}`, background: T.amberSoft, padding: "12px 16px", fontSize: 13, color: T.amber, fontWeight: 600 }}>
                  ⚠ Soft signs building: {softWatch.map((s) => s.name).join(", ")} — 2+ soft-sign flags in the last fortnight. Worth a Wellbeing conversation.
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 14 }}>
                {students.map((st) => {
                  const fs = flagsFor(st.id);
                  const catCounts = FLAG_CATS.map((c) => ({ c, n: fs.filter((f) => f.category === c.id && f.ts > now - 28 * 86400000).length })).filter((x) => x.n > 0);
                  const weeks = [3, 2, 1, 0].map((w) => {
                    const from = now - (w + 1) * 7 * 86400000, to = now - w * 7 * 86400000;
                    return { w, n: fs.filter((f) => f.ts > from && f.ts <= to).length, soft: fs.filter((f) => f.category === "soft-signs" && f.ts > from && f.ts <= to).length };
                  });
                  const maxN = Math.max(1, ...weeks.map((x) => x.n));
                  const refs = reflections.filter((r) => r.studentId === st.id);
                  const avg = (arr, k) => (arr.length ? (arr.reduce((s2, r) => s2 + r[k], 0) / arr.length).toFixed(1) : null);
                  const byAide = aides.map((a) => ({ a, rs: refs.filter((r) => r.aideId === a.id) })).filter((x) => x.rs.length);
                  return (
                    <div key={st.id} style={{ ...S.card, padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 15 }}>{st.name}</div>
                        <span style={{ fontSize: 11, color: T.faint, fontWeight: 600 }}>{st.cls}</span>
                        <span style={{ flex: 1 }} />
                        <button style={{ ...S.btnGhost, padding: "2px 11px", fontSize: 10.5 }} onClick={() => setProfileId(st.id)}>Profile</button>
                      </div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                        {catCounts.map(({ c, n }) => <Pill key={c.id} tone={c.tone} style={{ padding: "1px 9px", fontSize: 9.5 }}>{c.label} × {n}</Pill>)}
                        {!catCounts.length && <span style={{ fontSize: 11.5, color: T.faint }}>No flags in the last 4 weeks</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 44, marginTop: 12 }}>
                        {weeks.map(({ w, n, soft }) => (
                          <div key={w} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <div style={{ width: "100%", height: Math.round((n / maxN) * 34) + 2, borderRadius: 4, background: soft > 0 ? "#F59E0B" : T.blueLine, position: "relative" }} title={`${n} flags${soft ? ` (${soft} soft signs)` : ""}`} />
                            <span style={{ fontSize: 8.5, color: T.faint, fontWeight: 600 }}>{w === 0 ? "this wk" : `-${w}wk`}</span>
                          </div>
                        ))}
                      </div>
                      {refs.length > 0 && (
                        <div style={{ marginTop: 10, fontSize: 11.5, color: T.sub, lineHeight: 1.7 }}>
                          <b style={{ color: T.ink }}>Sessions feel</b> — engagement {avg(refs, "engagement")}/5 · regulation {avg(refs, "regulation")}/5 <span style={{ color: T.faint }}>({refs.length} reflection{refs.length !== 1 ? "s" : ""})</span>
                          {byAide.map(({ a, rs }) => (
                            <div key={a.id}>· with <b style={{ color: T.ink }}>{a.name}</b>: {avg(rs, "engagement")}/5 eng, {avg(rs, "regulation")}/5 reg ({rs.length})</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!students.length && <div style={{ fontSize: 13, color: T.faint }}>Add students first.</div>}
              </div>
            </div>
          );
        })()}

        {/* ================= SETTINGS (admin) ================= */}
        {view === "settings" && role === "admin" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
            <div style={{ ...S.card, padding: 20 }}>
              <span style={S.eyebrow}>Admin passcode</span>
              <div style={{ fontSize: 12, color: T.sub, margin: "8px 0 12px", lineHeight: 1.5 }}>
                Gates the admin pages on this device. Prototype-grade only — it isn't encryption.
              </div>
              <label style={S.label}>New passcode</label>
              <input style={S.input} type="password" value={passNew} onChange={(e) => setPassNew(e.target.value)} placeholder="At least 4 characters" />
              <label style={{ ...S.label, marginTop: 8 }}>Confirm</label>
              <input style={S.input} type="password" value={passNew2} onChange={(e) => setPassNew2(e.target.value)} />
              <button style={{ ...S.btn, marginTop: 12 }} onClick={() => {
                if (passNew.length < 4) return window.alert("Passcode needs at least 4 characters.");
                if (passNew !== passNew2) return window.alert("Passcodes don't match.");
                setAdminPass(passNew); setPassNew(""); setPassNew2(""); window.alert("Passcode updated.");
              }}>Update passcode</button>
            </div>
            <div style={{ ...S.card, padding: 20 }}>
              <span style={S.eyebrow}>Urgent-alert group</span>
              <div style={{ fontSize: 12, color: T.sub, margin: "8px 0 12px", lineHeight: 1.5 }}>
                Who the ⚠ Urgent button names. In this prototype the alert lands in everyone's bell feed — in a real rollout it would page these people.
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {notifyGroup.map((n) => (
                  <Pill key={n} tone="red" style={{ fontSize: 11 }}>
                    {n}
                    <button onClick={() => setNotifyGroup((xs) => xs.filter((x) => x !== n))}
                      style={{ border: "none", background: "none", cursor: "pointer", color: T.red, padding: 0, fontSize: 11 }}>✕</button>
                  </Pill>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <input style={{ ...S.input, flex: 1 }} value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newStaffName.trim()) { setNotifyGroup((xs) => [...new Set([...xs, newStaffName.trim()])]); setNewStaffName(""); } }}
                  placeholder="Wellbeing Team, principal, an aide…" />
                <button style={{ ...S.btnGhost }} onClick={() => { if (newStaffName.trim()) { setNotifyGroup((xs) => [...new Set([...xs, newStaffName.trim()])]); setNewStaffName(""); } }}>Add</button>
              </div>
            </div>
            <div style={{ ...S.card, padding: 20 }}>
              <span style={S.eyebrow}>AI — Assist & imports</span>
              <div style={{ fontSize: 12, color: T.sub, margin: "8px 0 12px", lineHeight: 1.6 }}>
                Powers the ✦ Assist button (describe a problem, get options) and Import parsing.
                Inside claude.ai no key is needed. On a hosted site (e.g. Netlify), paste an Anthropic API key —
                it stays in this browser only. Use a low-spend-limit key from console.anthropic.com.
              </div>
              <label style={S.label}>Anthropic API key</label>
              <input style={S.input} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} placeholder="sk-ant-…" />
              {apiKey && <div style={{ marginTop: 8 }}><Pill tone="green" style={{ fontSize: 10.5 }}>Key set — AI features active on this device</Pill></div>}
            </div>
            <div style={{ ...S.card, padding: 20 }}>
              <span style={S.eyebrow}>Privacy & data</span>
              <div style={{ fontSize: 12.5, color: T.sub, marginTop: 8, lineHeight: 1.8 }}>
                · Closed prototype — everything lives in this browser only; nothing is transmitted.<br />
                · Use <b>first names + initial</b> only. Never surnames, dates of birth, photos or addresses.<br />
                · The urgent alert is simulated. Serious concerns always go by phone to the Wellbeing Team.<br />
                · A real multi-user version needs a school-approved service with authentication and Australian data residency, via the department's software approval process.
              </div>
              <button style={{ ...S.btnGhost, marginTop: 14, color: T.red, borderColor: T.redLine }} onClick={() => {
                if (!window.confirm("Erase ALL data in this browser — timetables, students, flags, reflections, everything?")) return;
                setAides([]); setStudents([]); setClasses({}); setPlan({}); setYard({}); setYardAreas(DEFAULT_AREAS);
                setExtraStaff([]); setDayOv({}); setNotifyGroup(["Wellbeing Team"]); setFlags({}); setReflections([]); setActivity([]); setLastSeen({});
              }}>Erase all data</button>
            </div>
          </div>
        )}
      </div>

      {/* ================= CELL EDITOR MODAL ================= */}
      {editCell && (() => {
        const { day: dy, blockId, aideId, mode } = editCell;
        const a = aideById(aideId);
        const block = BLOCKS.find((b) => b.id === blockId);
        const current = mode === "today" ? effPairs(dy, blockId, aideId) : basePairs(dy, blockId, aideId);
        const ranked = rankStudentsFor(dy, blockId, aideId);
        const col = aideColor(aideIdx(aideId));
        const aideAbsent = mode === "today" && ovFor(dy).absentA.includes(aideId);
        const freeAides = mode !== "today" ? [] :
          aides.filter((x) => x.id !== aideId && x.days?.[dy] && !ovFor(dy).absentA.includes(x.id) && effPairs(dy, blockId, x.id).length === 0);
        return (
          <div onClick={() => setEditCell(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ ...S.card, boxShadow: T.shadowLift, width: 520, maxWidth: "100%", maxHeight: "84vh", overflowY: "auto", padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ width: 24, height: 24, borderRadius: 999, background: col.main, color: col.on, fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(a?.name)}</span>
                <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16 }}>
                  {a?.name} · {DAY_LABEL[dy]} · {block?.label}
                </div>
                {aideAbsent && <Pill tone="red" style={{ padding: "2px 10px", fontSize: 10 }}>absent today</Pill>}
                <span style={{ flex: 1 }} />
                <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 12 }} onClick={() => setEditCell(null)}>✕</button>
              </div>
              <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 12 }}>
                {block?.time}{mode === "today" ? " — changing today only; the base week stays put." : " — editing the base week."}
              </div>

              {current.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Assigned</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {current.map((sid) => (
                      <span key={sid} style={{ ...S.pill, background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep, fontSize: 12 }}>
                        {studentById(sid)?.name || "?"}
                        <button onClick={() => setCellPairs(dy, blockId, aideId, current.filter((x) => x !== sid), mode)}
                          style={{ border: "none", background: "none", cursor: "pointer", color: T.blueDeep, padding: 0, fontSize: 12 }}>✕</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <label style={S.label}>{block?.kind === "break" ? "Support a student through the break" : "Add a student"} <span style={{ color: T.faint, fontWeight: 500 }}>(best fits first)</span></label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ranked.filter(({ st }) => !current.includes(st.id)).map(({ st, sc, reasons }) => {
                  const absent = mode === "today" && ovFor(dy).absentS.includes(st.id);
                  return (
                    <button key={st.id} disabled={absent}
                      onClick={() => setCellPairs(dy, blockId, aideId, [...current, st.id], mode)}
                      style={{ textAlign: "left", cursor: absent ? "not-allowed" : "pointer", borderRadius: 10, padding: "8px 11px",
                        background: absent ? T.redSoft : sc >= 5 ? T.greenSoft : "#FAFBFD",
                        border: `1px solid ${absent ? T.redLine : sc >= 5 ? T.greenLine : T.lineSoft}`, fontFamily: F.body }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, ...(absent ? { textDecoration: "line-through", color: T.red } : {}) }}>
                          {st.name}{st.cls ? ` · ${st.cls}` : ""}
                        </span>
                        {sc >= 5 && !absent && <Pill tone="green" style={{ padding: "1px 8px", fontSize: 9.5 }}>strong fit</Pill>}
                        {absent && <Pill tone="red" style={{ padding: "1px 8px", fontSize: 9.5 }}>absent today</Pill>}
                      </div>
                      <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>{reasons.join(" · ")}</div>
                    </button>
                  );
                })}
                {!students.length && <span style={{ fontSize: 12.5, color: T.faint }}>Add students in the Team tab first.</span>}
              </div>

              {mode === "today" && current.length > 0 && freeAides.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <label style={S.label}>{aideAbsent ? "Cover — hand this cell to a free aide" : "Hand this cell to a free aide"}</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {freeAides.map((x) => (
                      <button key={x.id} style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5 }}
                        onClick={() => {
                          setCellPairs(dy, blockId, x.id, [...effPairs(dy, blockId, x.id), ...current], "today");
                          setCellPairs(dy, blockId, aideId, [], "today");
                          setEditCell(null);
                        }}>
                        → {x.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {current.length > 0 && (
                <button style={{ ...S.btnGhost, marginTop: 14, color: T.red, borderColor: T.redLine }}
                  onClick={() => { setCellPairs(dy, blockId, aideId, [], mode); setEditCell(null); }}>
                  Clear cell
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ================= STUDENT PROFILE MODAL ================= */}
      {profileId && (() => {
        const st = studentById(profileId);
        if (!st) return null;
        const fs = flagsFor(st.id).slice(0, 8);
        const refs = reflections.filter((r) => r.studentId === st.id).slice(0, 5);
        const avg = (k) => (refs.length ? (refs.reduce((s2, r) => s2 + r[k], 0) / refs.length).toFixed(1) : null);
        const isAdmin = role === "admin";
        return (
          <div onClick={() => setProfileId(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.4)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ ...S.card, boxShadow: T.shadowLift, width: 620, maxWidth: "100%", maxHeight: "86vh", overflowY: "auto", padding: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 19 }}>{st.name}</div>
                {st.cls && <Pill style={{ padding: "2px 10px", fontSize: 10.5 }}>{st.cls}{st.year ? ` · Year ${st.year}` : ""}</Pill>}
                <span style={{ flex: 1 }} />
                <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 12 }} onClick={() => setProfileId(null)}>✕</button>
              </div>
              <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 14 }}>
                {st.idealPerDay} ideal sessions/day · {hrs(weekMinutes(st.id))} planned this week{st.fundedHrs != null ? ` · ${st.fundedHrs}h funded` : ""}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={() => { setFlagFor(st.id); setFlagCatSel("heads-up"); setFlagText(""); }}>+ Update / tag</button>
                <button style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12, color: "#DC2626", borderColor: T.redLine }}
                  onClick={() => { setUrgentOpen(true); setUrgentSent(false); setUrgentStudent(st.id); setUrgentReason(URGENT_REASONS[0]); setUrgentNote(""); }}>⚠ Urgent</button>
              </div>

              <label style={S.label}>Strategies that work</label>
              {isAdmin ? (
                <textarea style={{ ...S.input, minHeight: 64, resize: "vertical" }} value={st.strategies || ""}
                  onChange={(e) => patchStudent(st.id, { strategies: e.target.value })}
                  placeholder="First/then language · movement breaks · visual timetable…" />
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.6, background: "#FAFBFD", border: `1px solid ${T.lineSoft}`, borderRadius: 10, padding: "10px 12px" }}>
                  {st.strategies || <span style={{ color: T.faint }}>None recorded yet.</span>}
                </div>
              )}

              <label style={{ ...S.label, marginTop: 14 }}>IEP goals</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(st.iepGoals || []).map((g) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: T.blueSoft, border: `1px solid ${T.blueLine}`, borderRadius: 10, padding: "8px 12px" }}>
                    <span style={{ fontSize: 13, color: T.blueDeep, fontWeight: 600, flex: 1, lineHeight: 1.5 }}>
                      {g.goal}{g.note && <span style={{ fontWeight: 400, color: T.sub }}> — {g.note}</span>}
                    </span>
                    {isAdmin && (
                      <button onClick={() => patchStudent(st.id, { iepGoals: st.iepGoals.filter((x) => x.id !== g.id) })}
                        style={{ border: "none", background: "none", cursor: "pointer", color: T.faint, fontSize: 12, padding: 0 }}>✕</button>
                    )}
                  </div>
                ))}
                {!(st.iepGoals || []).length && <span style={{ fontSize: 12.5, color: T.faint }}>No goals recorded.</span>}
                {isAdmin && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input style={{ ...S.input, flex: 1 }} value={newGoal} onChange={(e) => setNewGoal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newGoal.trim()) { patchStudent(st.id, { iepGoals: [...(st.iepGoals || []), { id: uid(), goal: newGoal.trim(), note: "" }] }); setNewGoal(""); } }}
                      placeholder="Add a goal…" />
                    <button style={S.btnGhost} onClick={() => { if (newGoal.trim()) { patchStudent(st.id, { iepGoals: [...(st.iepGoals || []), { id: uid(), goal: newGoal.trim(), note: "" }] }); setNewGoal(""); } }}>Add</button>
                  </div>
                )}
              </div>

              {refs.length > 0 && (
                <>
                  <label style={{ ...S.label, marginTop: 14 }}>How sessions have felt <span style={{ color: T.faint, fontWeight: 500 }}>(latest reflections)</span></label>
                  <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 6 }}>Engagement {avg("engagement")}/5 · Regulation {avg("regulation")}/5</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {refs.filter((r) => r.note).map((r) => (
                      <div key={r.id} style={{ fontSize: 12, color: T.sub, lineHeight: 1.5 }}>
                        "{r.note}" <span style={{ color: T.faint, fontSize: 10.5 }}>— {aideById(r.aideId)?.name}, {fmtWhen(r.ts)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <label style={{ ...S.label, marginTop: 14 }}>Recent updates</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {fs.map((f) => {
                  const cat = flagCat(f.category);
                  return (
                    <div key={f.id} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                      <Pill tone={cat.tone} style={{ padding: "1px 9px", fontSize: 9.5, marginRight: 6 }}>{cat.label}</Pill>
                      {f.text}
                      <span style={{ color: T.faint, fontSize: 10.5 }}> · {f.by}, {fmtWhen(f.ts)}</span>
                    </div>
                  );
                })}
                {!fs.length && <span style={{ fontSize: 12.5, color: T.faint }}>No updates yet.</span>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================= ADD UPDATE / FLAG MODAL ================= */}
      {flagFor && (() => {
        const picking = flagFor === "pick";
        const st = picking ? null : studentById(flagFor);
        const pickable = role === "admin" ? students : students.filter((s) => myStudentIds().includes(s.id));
        return (
          <div onClick={() => setFlagFor(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.4)", zIndex: 55, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ ...S.card, boxShadow: T.shadowLift, width: 480, maxWidth: "100%", maxHeight: "84vh", overflowY: "auto", padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16 }}>
                  {picking ? "Update / tag a student" : `Update — ${st?.name}`}
                </div>
                <span style={{ flex: 1 }} />
                <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 12 }} onClick={() => setFlagFor(null)}>✕</button>
              </div>
              <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 12 }}>
                Seen by admin and by the aides and teacher working with this student — for the rest of today and beyond.
              </div>
              {picking ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {pickable.map((s2) => (
                    <button key={s2.id} style={S.btnGhost} onClick={() => setFlagFor(s2.id)}>{s2.name}{s2.cls ? ` · ${s2.cls}` : ""}</button>
                  ))}
                  {!pickable.length && <span style={{ fontSize: 12.5, color: T.faint }}>No students linked to you yet.</span>}
                </div>
              ) : (
                <>
                  <label style={S.label}>What kind of update?</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {FLAG_CATS.map((c) => (
                      <button key={c.id} onClick={() => setFlagCatSel(c.id)}
                        style={{ ...S.btnGhost, padding: "5px 13px", fontSize: 11.5,
                          ...(flagCatSel === c.id ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                  {flagCatSel === "soft-signs" && (
                    <div style={{ fontSize: 11.5, color: T.amber, background: T.amberSoft, border: `1px solid ${T.amberLine}`, borderRadius: 10, padding: "8px 11px", marginBottom: 10, lineHeight: 1.5 }}>
                      Soft signs — subtle shifts worth noting: withdrawn, restless, teary, off food, seeking out adults. Patterns show up in Insights.
                    </div>
                  )}
                  <label style={S.label}>The update</label>
                  <textarea style={{ ...S.input, minHeight: 70, resize: "vertical" }} value={flagText} onChange={(e) => setFlagText(e.target.value)}
                    placeholder="Rough start at drop-off — went well with quiet reading. Keep transitions gentle today." autoFocus />
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button style={S.btn} disabled={!flagText.trim()}
                      onClick={() => { addFlag(flagFor, flagCatSel, flagText); setFlagFor(null); }}>
                      Post update
                    </button>
                    <button style={S.btnGhost} onClick={() => setFlagFor(null)}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ================= REFLECTION MODAL ================= */}
      {reflectFor && (() => {
        const st = studentById(reflectFor.studentId);
        const b = BLOCKS.find((x) => x.id === reflectFor.block);
        const Scale = ({ value, onChange, kind }) => (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {RATING.map((n) => (
              <button key={n} onClick={() => onChange(n)}
                style={{ ...S.btnGhost, width: 38, padding: "8px 0", fontSize: 13, fontWeight: 800, textAlign: "center",
                  ...(value === n ? { background: T.blue, color: "#FFF", borderColor: T.blue } : {}) }}>
                {n}
              </button>
            ))}
            {value > 0 && <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 600 }}>{RATING_LABEL[kind][value - 1]}</span>}
          </div>
        );
        return (
          <div onClick={() => setReflectFor(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.4)", zIndex: 55, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ ...S.card, boxShadow: T.shadowLift, width: 460, maxWidth: "100%", padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16 }}>Quick reflection — {st?.name}</div>
                <span style={{ flex: 1 }} />
                <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 12 }} onClick={() => setReflectFor(null)}>✕</button>
              </div>
              <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 14 }}>{DAY_LABEL[reflectFor.day]} · {b?.label} — 20 seconds, feeds the patterns in Insights.</div>
              <label style={S.label}>Engagement</label>
              <Scale value={reflectEng} onChange={setReflectEng} kind="engagement" />
              <label style={{ ...S.label, marginTop: 12 }}>Regulation</label>
              <Scale value={reflectReg} onChange={setReflectReg} kind="regulation" />
              <label style={{ ...S.label, marginTop: 12 }}>Anything worth noting? <span style={{ color: T.faint, fontWeight: 500 }}>(optional)</span></label>
              <textarea style={{ ...S.input, minHeight: 56, resize: "vertical" }} value={reflectNote} onChange={(e) => setReflectNote(e.target.value)}
                placeholder="What worked, what didn't, anything for tomorrow…" />
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button style={S.btn} disabled={!reflectEng || !reflectReg}
                  onClick={() => { addReflection({ ...reflectFor, engagement: reflectEng, regulation: reflectReg, note: reflectNote.trim() }); setReflectFor(null); }}>
                  Save reflection
                </button>
                <button style={S.btnGhost} onClick={() => setReflectFor(null)}>Not now</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================= AI ASSIST MODAL ================= */}
      {assistOpen && (
        <div onClick={() => setAssistOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.4)", zIndex: 55, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ ...S.card, boxShadow: T.shadowLift, width: 600, maxWidth: "100%", maxHeight: "86vh", overflowY: "auto", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 17 }}>✦ Assist</div>
              <Pill tone="blue" style={{ padding: "1px 9px", fontSize: 9.5 }}>{DAY_LABEL[day]}</Pill>
              <span style={{ flex: 1 }} />
              <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 12 }} onClick={() => setAssistOpen(false)}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 12, lineHeight: 1.55 }}>
              Describe the problem — Claude reads your aides, students, {DAY_LABEL[day]}'s schedule, absences and this
              week's updates, and offers options. Suggestions only: you know the children.
            </div>
            <textarea style={{ ...S.input, minHeight: 76, resize: "vertical" }} value={assistQ} onChange={(e) => setAssistQ(e.target.value)}
              placeholder={"e.g. Lisa is away tomorrow and Emerson needs full-day cover…\nCooper escalates at lunch transitions — what could we try?\nThursday's plan is empty because of the strike — draft one."}
              autoFocus />
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button style={S.btn} disabled={assistBusy || !assistQ.trim()} onClick={runAssist}>
                {assistBusy ? "Thinking…" : "✦ Suggest options"}
              </button>
              {assistErr && <Pill tone="red" style={{ fontSize: 11 }}>{assistErr}</Pill>}
            </div>
            {assistAnswer && (
              <div style={{ marginTop: 14, border: `1px solid ${T.blueLine}`, background: T.blueSoft, borderRadius: 12, padding: "12px 15px", fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                {assistAnswer}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= URGENT SUPPORT MODAL (simulated) ================= */}
      {urgentOpen && (() => {
        const pickable = role === "admin" ? students : students.filter((s) => myStudentIds().includes(s.id));
        return (
          <div onClick={() => setUrgentOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ ...S.card, boxShadow: T.shadowLift, width: 500, maxWidth: "100%", maxHeight: "86vh", overflowY: "auto", padding: 20, borderTop: "4px solid #DC2626" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 17, color: "#DC2626" }}>⚠ Request immediate support</div>
                <span style={{ flex: 1 }} />
                <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 12 }} onClick={() => setUrgentOpen(false)}>✕</button>
              </div>
              <div style={{ borderRadius: 10, border: `1px solid ${T.redLine}`, background: T.redSoft, padding: "9px 12px", fontSize: 12, color: T.red, fontWeight: 600, lineHeight: 1.5, marginBottom: 14 }}>
                Prototype — this does NOT actually notify anyone. In a real situation, phone the office / Wellbeing Team first. This button logs the request and flags it in every bell feed.
              </div>
              {urgentSent ? (
                <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
                  <div style={{ fontSize: 34 }}>✓</div>
                  <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>Logged & flagged</div>
                  <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.6, marginBottom: 14 }}>
                    In a live rollout, {notifyGroup.join(", ")} would be paged right now. Here it's in the activity feed for everyone.
                  </div>
                  <button style={S.btn} onClick={() => setUrgentOpen(false)}>Close</button>
                </div>
              ) : (
                <>
                  <label style={S.label}>Student <span style={{ color: T.faint, fontWeight: 500 }}>(optional)</span></label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {pickable.map((s2) => (
                      <button key={s2.id} onClick={() => setUrgentStudent(urgentStudent === s2.id ? null : s2.id)}
                        style={{ ...S.btnGhost, padding: "4px 12px", fontSize: 11.5,
                          ...(urgentStudent === s2.id ? { background: "#DC2626", color: "#FFF", borderColor: "#DC2626" } : {}) }}>
                        {s2.name}
                      </button>
                    ))}
                  </div>
                  <label style={S.label}>What's happening?</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {URGENT_REASONS.map((r) => (
                      <button key={r} onClick={() => setUrgentReason(r)}
                        style={{ ...S.btnGhost, padding: "4px 12px", fontSize: 11.5,
                          ...(urgentReason === r ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                        {r}
                      </button>
                    ))}
                  </div>
                  <label style={S.label}>Where / details</label>
                  <input style={S.input} value={urgentNote} onChange={(e) => setUrgentNote(e.target.value)} placeholder="e.g. 5C classroom, needs a second adult" />
                  <div style={{ fontSize: 11.5, color: T.sub, margin: "12px 0" }}>
                    Would notify: {notifyGroup.map((n) => <Pill key={n} tone="red" style={{ padding: "1px 9px", fontSize: 10, marginRight: 4 }}>{n}</Pill>)}
                  </div>
                  <button style={{ ...S.btn, background: "#DC2626", boxShadow: "0 1px 2px rgba(220,38,38,.35), 0 6px 16px rgba(220,38,38,.25)", width: "100%" }}
                    onClick={() => { sendUrgent(urgentStudent, urgentReason, urgentNote.trim()); setUrgentSent(true); }}>
                    Send urgent request (simulated)
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
