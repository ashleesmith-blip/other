import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   CLASS CREATOR — build next year's classes from cohort data
   CPS · Groupings · standalone tool

   · Cohort tab holds the students: curriculum levels (Reading /
     Writing / Maths), learning needs, strengths and notes —
     typed, pasted, AI-imported from any document, or imported
     straight from the Sociogram's grouping-data JSON
   · Constraints tab holds the new classes + their teachers,
     keep-together pairs, must-separate pairs and student→teacher
     recommendations
   · ✦ Suggest classes balances curriculum levels, learning
     needs, gender and size across classes while honouring
     separations, keeping keep-pairs whole, landing teacher
     recommendations and trying to give everyone a chosen friend
   · Manual override with re-balance: move any student by hand,
     lock them, and re-suggest around the locks
   · Review tab is the constraint-transparency layer: every
     keep / separate / recommendation shown as satisfied or
     traded off, plus balance stats and friend coverage
   · Aesthetic + patterns lifted from Chunk & Check
   ============================================================ */

/* ---------- misc helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (n) => Math.round(n * 10) / 10;

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

/* ---------- Anthropic API helper ---------- */
async function askClaude(messages, maxTokens = 2000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages }),
  });
  const data = await res.json();
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

/* ---------- class colours — same wheel as Chunk & Check levels ---------- */
const COLORS = [
  { main: "#3B82F6", text: "#1D4ED8", soft: "#EFF6FF", line: "#BFDBFE", on: "#FFFFFF" },
  { main: "#22C55E", text: "#15803D", soft: "#F0FDF4", line: "#BBF7D0", on: "#FFFFFF" },
  { main: "#EC4899", text: "#BE185D", soft: "#FDF2F8", line: "#FBCFE8", on: "#FFFFFF" },
  { main: "#F97316", text: "#C2410C", soft: "#FFF7ED", line: "#FED7AA", on: "#FFFFFF" },
  { main: "#6366F1", text: "#4338CA", soft: "#EEF2FF", line: "#C7D2FE", on: "#FFFFFF" },
  { main: "#14B8A6", text: "#0F766E", soft: "#F0FDFA", line: "#99F6E4", on: "#FFFFFF" },
  { main: "#EAB308", text: "#A16207", soft: "#FEFCE8", line: "#FDE68A", on: "#422006" },
  { main: "#EF4444", text: "#B91C1C", soft: "#FEF2F2", line: "#FECACA", on: "#FFFFFF" },
];
const colorFor = (i) => COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];

const SUBJECTS = [
  { key: "reading", label: "Reading" },
  { key: "writing", label: "Writing" },
  { key: "maths", label: "Maths" },
];
const NEED_PRESETS = ["ADHD", "EAL", "Dyslexia", "Dysgraphia", "Dyscalculia", "Support", "Extension", "Medical"];

/* ---------- AI import prompt ---------- */
const COHORT_PROMPT = `You are helping build primary-school classes from cohort data. From the source text below, extract every student you can find. Respond with ONLY valid JSON, no prose, in exactly this shape:
{"students":[{"name":"","gender":"F","cls":"","reading":3.5,"writing":3.5,"maths":3.5,"needs":[],"strengths":"","notes":""}]}
Rules: gender = "F", "M" or "" if unstated. cls = the student's CURRENT class code, e.g. "5B". reading/writing/maths = Victorian Curriculum levels as numbers (e.g. 4, 4.5, 5.5) — null if unstated. needs = learning needs from this list where mentioned: ADHD, EAL, Dyslexia, Dysgraphia, Dyscalculia, Support, Extension, Medical (use other short labels if the source names something else). strengths = a short phrase. Leave fields empty/null rather than guessing wildly.`;

/* ---------- sample data ---------- */
const SAMPLE = () => {
  const rows = [
    // name, cls, gender, reading, writing, maths, needs
    ["Ava R", "5A", "F", 5.5, 5.5, 5.0, ["Extension"]], ["Ben T", "5A", "M", 4.5, 4.0, 5.0, ["ADHD"]],
    ["Chloe M", "5A", "F", 5.0, 5.0, 4.5, []], ["Dev P", "5A", "M", 4.0, 4.0, 4.5, ["EAL"]],
    ["Eli S", "5A", "M", 3.5, 3.5, 4.0, ["Dyslexia", "Support"]], ["Freya K", "5A", "F", 5.0, 4.5, 4.5, []],
    ["Gus W", "5A", "M", 4.5, 4.5, 5.5, ["Extension"]], ["Harper L", "5A", "F", 4.0, 4.5, 4.0, []],
    ["Ivy C", "5A", "F", 3.5, 3.5, 3.5, ["Support"]], ["Jack D", "5A", "M", 4.5, 4.0, 4.5, []],
    ["Kai N", "5A", "M", 5.0, 4.5, 5.5, ["Extension"]], ["Lily B", "5A", "F", 4.5, 5.0, 4.0, []],
    ["Marcus O", "5B", "M", 4.0, 3.5, 4.5, ["ADHD"]], ["Nora F", "5B", "F", 5.5, 5.5, 5.0, ["Extension"]],
    ["Oscar H", "5B", "M", 3.5, 3.5, 4.0, ["Dysgraphia"]], ["Priya S", "5B", "F", 5.0, 5.0, 5.5, ["Extension"]],
    ["Quinn A", "5B", "F", 4.0, 4.0, 3.5, ["Dyscalculia"]], ["Ruby J", "5B", "F", 4.5, 4.5, 4.5, []],
    ["Sam E", "5B", "M", 4.0, 4.0, 4.5, []], ["Tara V", "5B", "F", 3.5, 4.0, 3.5, ["EAL", "Support"]],
    ["Umar M", "5B", "M", 4.5, 4.0, 5.0, []], ["Violet G", "5B", "F", 5.0, 4.5, 4.5, []],
    ["Will P", "5B", "M", 4.0, 4.5, 4.0, ["ADHD"]], ["Zoe T", "5B", "F", 4.5, 4.5, 4.0, []],
  ];
  const students = rows.map(([name, cls, gender, reading, writing, maths, needs]) => ({
    id: uid(), name, cls, gender, levels: { reading, writing, maths }, needs, strengths: "", notes: "",
  }));
  const id = (n) => students.find((s) => s.name.startsWith(n)).id;
  const socio = {};
  const pick = (from, friends, avoidL = []) => { socio[id(from)] = { friends: friends.map(id), avoid: avoidL.map(id) }; };
  pick("Ava", ["Chloe", "Freya", "Harper"]); pick("Chloe", ["Ava", "Freya", "Lily"]);
  pick("Freya", ["Ava", "Chloe", "Ivy"]); pick("Harper", ["Ava", "Ivy", "Zoe"]);
  pick("Ivy", ["Freya", "Harper", "Lily"]); pick("Lily", ["Chloe", "Ivy", "Ruby"]);
  pick("Ben", ["Jack", "Gus", "Dev"], ["Marcus"]); pick("Jack", ["Ben", "Gus", "Kai"]);
  pick("Gus", ["Ben", "Jack", "Eli"]); pick("Dev", ["Ben", "Kai", "Sam"]);
  pick("Kai", ["Jack", "Dev", "Eli"]); pick("Eli", ["Gus", "Kai", "Will"]);
  pick("Marcus", ["Oscar", "Sam", "Will"], ["Ben"]); pick("Oscar", ["Marcus", "Sam", "Umar"]);
  pick("Sam", ["Marcus", "Oscar", "Dev"]); pick("Umar", ["Oscar", "Will", "Sam"]);
  pick("Will", ["Marcus", "Umar", "Eli"]); pick("Nora", ["Priya", "Ruby", "Quinn"]);
  pick("Priya", ["Nora", "Quinn", "Tara"]); pick("Quinn", ["Priya", "Nora", "Violet"]);
  pick("Ruby", ["Nora", "Lily", "Tara"]); pick("Tara", ["Priya", "Ruby", "Zoe"]);
  pick("Violet", ["Quinn", "Zoe", "Tara"]); pick("Zoe", ["Harper", "Violet", "Tara"]);
  const newClasses = [
    { id: uid(), name: "6A", teacher: "Ms Chen" },
    { id: uid(), name: "6B", teacher: "Mr Papadopoulos" },
  ];
  const keeps = [[id("Eli"), id("Gus")], [id("Tara"), id("Priya")]];
  const seps = [[id("Ben"), id("Marcus")], [id("Jack"), id("Will")]];
  const recs = [{ studentId: id("Eli"), classId: newClasses[0].id }, { studentId: id("Quinn"), classId: newClasses[1].id }];
  return { students, socio, newClasses, keeps, seps, recs };
};

/* ============================================================ */
export default function App() {
  const [students, setStudents] = useState([]);
  const [socio, setSocio] = useState({});            // { studentId: { friends:[], avoid:[] } }
  const [newClasses, setNewClasses] = useState([]);  // [{ id, name, teacher }]
  const [keeps, setKeeps] = useState([]);            // [[idA, idB]]
  const [seps, setSeps] = useState([]);              // [[idA, idB]]
  const [recs, setRecs] = useState([]);              // [{ studentId, classId }]
  const [placement, setPlacement] = useState({});    // { studentId: classId }
  const [locks, setLocks] = useState({});            // { studentId: true }

  const [view, setView] = useState("cohort");        // cohort | constraints | build | review | import
  const [editStudent, setEditStudent] = useState(null);
  const [chipMenu, setChipMenu] = useState(null);    // studentId with open move-menu
  const [pairPick, setPairPick] = useState({ kind: null, first: null }); // building a keep/sep pair
  const [savedMsg, setSavedMsg] = useState("");

  const [impText, setImpText] = useState("");
  const [impBusy, setImpBusy] = useState(false);
  const [impPreview, setImpPreview] = useState(null);
  const [impErr, setImpErr] = useState("");
  const fileRef = useRef(null);
  const groupRef = useRef(null);
  const loadRef = useRef(null);

  /* ---------- persistence ---------- */
  const storeLoaded = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await store.get("class-creator-doc");
        if (raw) {
          const d = JSON.parse(raw);
          if (d.students) setStudents(d.students);
          if (d.socio) setSocio(d.socio);
          if (d.newClasses) setNewClasses(d.newClasses);
          if (d.keeps) setKeeps(d.keeps);
          if (d.seps) setSeps(d.seps);
          if (d.recs) setRecs(d.recs);
          if (d.placement) setPlacement(d.placement);
          if (d.locks) setLocks(d.locks);
        }
      } catch {}
      storeLoaded.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!storeLoaded.current) return;
    store.set("class-creator-doc", JSON.stringify({ students, socio, newClasses, keeps, seps, recs, placement, locks }));
    setSavedMsg("Saved");
    const t = setTimeout(() => setSavedMsg(""), 1200);
    return () => clearTimeout(t);
  }, [students, socio, newClasses, keeps, seps, recs, placement, locks]);

  /* ---------- lookups ---------- */
  const byId = (id) => students.find((s) => s.id === id);
  const classById = (id) => newClasses.find((c) => c.id === id);
  const classIdx = (id) => newClasses.findIndex((c) => c.id === id);
  const friendsOf = (id) => (socio[id]?.friends || []).filter((f) => byId(f));
  const inClass = (classId) => students.filter((s) => placement[s.id] === classId);

  /* ---------- roster ops ---------- */
  const addStudent = () => { const s = { id: uid(), name: "", cls: "", gender: "", levels: {}, needs: [], strengths: "", notes: "" }; setStudents((p) => [...p, s]); setEditStudent(s.id); };
  const patchStudent = (id, patch) => setStudents((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeStudent = (id) => {
    setStudents((p) => p.filter((s) => s.id !== id));
    setKeeps((p) => p.filter(([a, b]) => a !== id && b !== id));
    setSeps((p) => p.filter(([a, b]) => a !== id && b !== id));
    setRecs((p) => p.filter((r) => r.studentId !== id));
    setPlacement((p) => { const n = { ...p }; delete n[id]; return n; });
    setLocks((p) => { const n = { ...p }; delete n[id]; return n; });
    setSocio((p) => {
      const n = {};
      Object.entries(p).forEach(([k, v]) => {
        if (k === id) return;
        n[k] = { friends: (v.friends || []).filter((f) => f !== id), avoid: (v.avoid || []).filter((f) => f !== id) };
      });
      return n;
    });
  };

  /* ---------- class ops ---------- */
  const addClass = () => setNewClasses((p) => [...p, { id: uid(), name: `Class ${p.length + 1}`, teacher: "" }]);
  const patchClass = (id, patch) => setNewClasses((p) => p.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeClass = (id) => {
    setNewClasses((p) => p.filter((c) => c.id !== id));
    setRecs((p) => p.filter((r) => r.classId !== id));
    setPlacement((p) => { const n = {}; Object.entries(p).forEach(([k, v]) => { if (v !== id) n[k] = v; }); return n; });
  };

  /* ---------- pair constraint ops ---------- */
  const pairExists = (list, a, b) => list.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const tapPair = (kind, id) => {
    if (pairPick.kind !== kind || !pairPick.first) { setPairPick({ kind, first: id }); return; }
    if (pairPick.first === id) { setPairPick({ kind: null, first: null }); return; }
    const setter = kind === "keep" ? setKeeps : setSeps;
    const list = kind === "keep" ? keeps : seps;
    if (!pairExists(list, pairPick.first, id)) setter((p) => [...p, [pairPick.first, id]]);
    setPairPick({ kind: null, first: null });
  };

  /* ---------- suggestion engine ---------- */
  const cohortStats = useMemo(() => {
    const st = {};
    SUBJECTS.forEach(({ key }) => { st[key] = avg(students.map((s) => s.levels?.[key]).filter((x) => typeof x === "number")); });
    st.needs = avg(students.map((s) => (s.needs || []).length));
    st.f = students.filter((s) => s.gender === "F").length / Math.max(1, students.length);
    return st;
  }, [students]);

  const violatesSep = (studentId, classId, place) =>
    seps.some(([a, b]) => (a === studentId && place[b] === classId) || (b === studentId && place[a] === classId));

  const classCost = (classId, unit, place) => {
    const members = students.filter((s) => place[s.id] === classId);
    const after = [...members, ...unit];
    const target = students.length / Math.max(1, newClasses.length);
    let cost = Math.pow(Math.max(0, after.length - target), 2) * 3 + after.length * 0.4;
    SUBJECTS.forEach(({ key }) => {
      const vals = after.map((s) => s.levels?.[key]).filter((x) => typeof x === "number");
      if (vals.length && cohortStats[key]) cost += Math.abs(avg(vals) - cohortStats[key]) * 6;
    });
    cost += Math.abs(avg(after.map((s) => (s.needs || []).length)) - cohortStats.needs) * 3;
    const f = after.filter((s) => s.gender === "F").length / Math.max(1, after.length);
    cost += Math.abs(f - cohortStats.f) * 4;
    unit.forEach((s) => {
      if (recs.some((r) => r.studentId === s.id && r.classId === classId)) cost -= 10;
      if (recs.some((r) => r.studentId === s.id && r.classId !== classId)) cost += 4;
      if (friendsOf(s.id).some((f2) => place[f2] === classId || unit.some((u) => u.id === f2))) cost -= 2.5;
    });
    return cost;
  };

  const suggestClasses = () => {
    if (newClasses.length < 2) { window.alert("Add at least two classes (Constraints tab) first."); return; }
    const placed = Object.keys(placement).filter((id) => byId(id)).length;
    if (placed && !window.confirm("Re-suggest classes? Locked students stay put; everyone else may move.")) return;

    /* union-find over keep pairs → units that move together */
    const parent = {};
    students.forEach((s) => { parent[s.id] = s.id; });
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    keeps.forEach(([a, b]) => { if (parent[a] && parent[b]) parent[find(a)] = find(b); });
    const unitMap = {};
    students.forEach((s) => { const rt = find(s.id); (unitMap[rt] = unitMap[rt] || []).push(s); });

    const place = {};
    students.forEach((s) => { if (locks[s.id] && placement[s.id] && classById(placement[s.id])) place[s.id] = placement[s.id]; });

    /* a unit with any locked member goes with the lock */
    const units = Object.values(unitMap).filter((u) => u.some((s) => !place[s.id]));
    units.forEach((u) => {
      const lockedIn = u.map((s) => place[s.id]).find(Boolean);
      if (lockedIn) u.forEach((s) => { place[s.id] = lockedIn; });
    });

    const open = units.filter((u) => !place[u[0].id]);
    /* hardest units first: bigger, further from the cohort mean, more needs */
    open.sort((a, b) => {
      const spread = (u) => avg(u.map((s) => Math.abs((s.levels?.reading ?? cohortStats.reading) - cohortStats.reading) + Math.abs((s.levels?.maths ?? cohortStats.maths) - cohortStats.maths)));
      const load = (u) => u.length * 3 + spread(u) * 2 + avg(u.map((s) => (s.needs || []).length)) * 2 + (u.some((s) => recs.some((r) => r.studentId === s.id)) ? 5 : 0);
      return load(b) - load(a);
    });

    open.forEach((unit) => {
      let best = null, bestCost = Infinity;
      newClasses.forEach((c) => {
        if (unit.some((s) => violatesSep(s.id, c.id, place))) return;
        const cost = classCost(c.id, unit, place);
        if (cost < bestCost) { bestCost = cost; best = c.id; }
      });
      if (best === null) best = newClasses[0].id; // separations impossible to satisfy — Review will flag it
      unit.forEach((s) => { place[s.id] = best; });
    });

    /* repair pass — friendless students try to join a friend, if the move stays legal and balanced */
    const targetMax = Math.ceil(students.length / newClasses.length) + 1;
    students.forEach((s) => {
      if (locks[s.id]) return;
      if (keeps.some(([a, b]) => a === s.id || b === s.id)) return;
      const fs = friendsOf(s.id);
      if (!fs.length || fs.some((f2) => place[f2] === place[s.id])) return;
      for (const f2 of fs) {
        const dest = place[f2];
        if (!dest || dest === place[s.id]) continue;
        if (violatesSep(s.id, dest, place)) continue;
        if (students.filter((x) => place[x.id] === dest).length >= targetMax) continue;
        place[s.id] = dest;
        break;
      }
    });

    setPlacement(place);
    setView("build");
  };

  const clearPlacement = () => {
    if (!window.confirm("Clear all placements (locked students too)?")) return;
    setPlacement({}); setLocks({});
  };

  /* ---------- review data ---------- */
  const report = useMemo(() => {
    const placedAll = students.filter((s) => placement[s.id] && classById(placement[s.id]));
    const keepsR = keeps.map(([a, b]) => ({ a, b, ok: placement[a] && placement[a] === placement[b] }));
    const sepsR = seps.map(([a, b]) => ({ a, b, ok: !placement[a] || !placement[b] || placement[a] !== placement[b] }));
    const recsR = recs.map((r) => ({ ...r, ok: placement[r.studentId] === r.classId }));
    const friendless = placedAll.filter((s) => {
      const fs = friendsOf(s.id);
      return fs.length && !fs.some((f2) => placement[f2] === placement[s.id]);
    });
    const noData = placedAll.filter((s) => !friendsOf(s.id).length);
    const unplaced = students.filter((s) => !placement[s.id] || !classById(placement[s.id]));
    return { keepsR, sepsR, recsR, friendless, noData, unplaced, placedAll };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, placement, keeps, seps, recs, socio, newClasses]);

  /* ---------- backup / import ---------- */
  const download = (obj, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportBackup = () => download({ students, socio, newClasses, keeps, seps, recs, placement, locks }, "class-creator-backup.json");
  const exportGrouping = () => download({ kind: "cps-grouping-data", students: students.map(({ id, name, cls, gender, notes }) => ({ id, name, cls, gender, notes })), socio }, "grouping-data.json");
  const loadBackup = async (file) => {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!window.confirm("Replace everything with this backup?")) return;
      setStudents(d.students || []); setSocio(d.socio || {}); setNewClasses(d.newClasses || []);
      setKeeps(d.keeps || []); setSeps(d.seps || []); setRecs(d.recs || []);
      setPlacement(d.placement || {}); setLocks(d.locks || {});
    } catch { window.alert("That file isn't a valid backup."); }
  };
  /* grouping-data import — matches existing students by name, adds the rest */
  const importGrouping = async (file) => {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.students)) throw new Error();
      const idMap = {};
      const additions = [];
      d.students.forEach((imp) => {
        const match = students.find((s) => s.name.trim().toLowerCase() === (imp.name || "").trim().toLowerCase());
        if (match) idMap[imp.id] = match.id;
        else {
          const ns = { id: uid(), name: imp.name || "", cls: imp.cls || "", gender: imp.gender || "", levels: {}, needs: [], strengths: "", notes: imp.notes || "" };
          idMap[imp.id] = ns.id;
          additions.push(ns);
        }
      });
      const socioNew = {};
      Object.entries(d.socio || {}).forEach(([k, v]) => {
        if (!idMap[k]) return;
        socioNew[idMap[k]] = {
          friends: (v.friends || []).map((f) => idMap[f]).filter(Boolean),
          avoid: (v.avoid || []).map((f) => idMap[f]).filter(Boolean),
        };
      });
      if (!window.confirm(`Import grouping data: ${additions.length} new students, nominations for ${Object.keys(socioNew).length}. Existing students matched by name keep their levels and needs.`)) return;
      if (additions.length) setStudents((p) => [...p, ...additions]);
      setSocio((p) => ({ ...p, ...socioNew }));
    } catch { window.alert("That file isn't grouping data (expects { students:[...], socio:{...} })."); }
  };

  /* ---------- AI import ---------- */
  const runImport = async (sourceText) => {
    setImpBusy(true); setImpErr(""); setImpPreview(null);
    try {
      const out = await askClaude([{ role: "user", content: `${COHORT_PROMPT}\n\n--- SOURCE ---\n${sourceText}` }], 4000);
      const parsed = parseJSON(out);
      if (!Array.isArray(parsed.students) || !parsed.students.length) throw new Error("No students found");
      setImpPreview(parsed.students);
    } catch (e) { setImpErr(String(e.message || e)); }
    setImpBusy(false);
  };
  const handleFile = async (file) => {
    if (!file) return;
    setImpBusy(true); setImpErr("");
    try { await runImport(await extractSourceText(file)); }
    catch (e) { setImpErr(String(e.message || e)); setImpBusy(false); }
  };
  const applyImport = () => {
    const added = [];
    setStudents((prev) => {
      const next = [...prev];
      impPreview.forEach((imp) => {
        const levels = {};
        SUBJECTS.forEach(({ key }) => { if (typeof imp[key] === "number") levels[key] = imp[key]; });
        const match = next.find((s) => s.name.trim().toLowerCase() === (imp.name || "").trim().toLowerCase());
        if (match) Object.assign(match, {
          cls: imp.cls || match.cls, gender: imp.gender || match.gender,
          levels: { ...match.levels, ...levels },
          needs: [...new Set([...(match.needs || []), ...(imp.needs || [])])],
          strengths: imp.strengths || match.strengths,
        });
        else { next.push({ id: uid(), name: imp.name || "", cls: imp.cls || "", gender: imp.gender || "", levels, needs: imp.needs || [], strengths: imp.strengths || "", notes: imp.notes || "" }); added.push(imp.name); }
      });
      return next;
    });
    setImpPreview(null); setImpText("");
  };

  const needTone = (n) => (["Extension"].includes(n) ? "green" : ["ADHD", "Medical"].includes(n) ? "amber" : "red");
  const levelBand = (s) => {
    const vals = SUBJECTS.map(({ key }) => s.levels?.[key]).filter((x) => typeof x === "number");
    return vals.length ? r1(avg(vals)) : null;
  };

  /* ============================ UI ============================ */
  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: F.body, color: T.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        button:hover { filter: brightness(0.97); }
        button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${T.blue}; outline-offset: 2px; }
        input::placeholder, textarea::placeholder { color: ${T.faint}; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
        @media print { .no-print { display: none !important; } body { background: #FFF; } }
      `}</style>

      {/* ---------- header ---------- */}
      <div style={{ background: T.card, borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 22px", textAlign: "center" }}>
          <Pill tone="blue" style={{ fontSize: 11 }}>CPS · Groupings</Pill>
          <h1 style={{ fontFamily: F.display, fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", margin: "12px 0 6px" }}>
            Class <span style={{ color: T.blue }}>Creator</span>
          </h1>
          <div style={{ fontSize: 14, color: T.sub, maxWidth: 640, margin: "0 auto", lineHeight: 1.55 }}>
            Next year's classes from this year's cohort — balanced on curriculum levels, learning needs and
            friendships, with keeps, separations and teacher recommendations honoured and every trade-off shown.
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {[["cohort", "Cohort"], ["constraints", "Constraints"], ["build", "Build"], ["review", "Review"], ["import", "Import"]].map(([k, lab]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ ...S.btnGhost, ...(view === k ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                {lab}
              </button>
            ))}
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={exportBackup} title="Download everything as a JSON backup">Backup</button>
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={() => loadRef.current?.click()} title="Restore from a JSON backup">Restore</button>
            <input ref={loadRef} type="file" hidden accept=".json,application/json" onChange={(e) => { loadBackup(e.target.files?.[0]); e.target.value = ""; }} />
            {savedMsg && <Pill tone="green" style={{ fontSize: 10.5 }}>{savedMsg}</Pill>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 80px" }}>

        {/* ================= COHORT ================= */}
        {view === "cohort" && (
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={S.eyebrow}>Cohort</span>
              <Pill style={{ fontSize: 10.5 }}>{students.length} students</Pill>
              {students.length > 0 && SUBJECTS.map(({ key, label }) => (
                <Pill key={key} tone="blue" style={{ fontSize: 10.5 }}>{label} x̄ {r1(cohortStats[key]) || "—"}</Pill>
              ))}
              <span style={{ flex: 1 }} />
              <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addStudent}>+ Student</button>
            </div>
            {!students.length && (
              <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6 }}>
                No students yet. Add them by hand, use the <b>Import</b> tab (paste or upload cohort data — or a
                grouping-data JSON exported from the Sociogram), or{" "}
                <button onClick={() => { const s = SAMPLE(); setStudents(s.students); setSocio(s.socio); setNewClasses(s.newClasses); setKeeps(s.keeps); setSeps(s.seps); setRecs(s.recs); }}
                  style={{ border: "none", background: "none", cursor: "pointer", color: T.blueDeep, fontWeight: 700, fontSize: 13, padding: 0 }}>
                  load sample data
                </button>{" "}
                to see the tool working.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {students.map((s) => {
                const open = editStudent === s.id;
                const band = levelBand(s);
                return (
                  <div key={s.id} style={{ border: `1px solid ${open ? T.blueLine : T.lineSoft}`, borderRadius: 12, padding: "10px 12px", background: open ? T.blueSoft : "#FCFDFE" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ width: 26, height: 26, borderRadius: 999, background: T.blue, color: "#FFF", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(s.name)}</span>
                      <div style={{ minWidth: 130 }}>
                        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13.5 }}>{s.name || "Unnamed"}</div>
                        <div style={{ fontSize: 11, color: T.sub }}>{[s.cls, s.gender].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                      {band !== null && <Pill tone="blue" style={{ fontSize: 10.5 }}>x̄ {band}</Pill>}
                      {(s.needs || []).map((n) => <Pill key={n} tone={needTone(n)} style={{ fontSize: 10.5, padding: "3px 10px" }}>{n}</Pill>)}
                      {friendsOf(s.id).length > 0 && <span style={{ fontSize: 11, color: T.faint }}>{friendsOf(s.id).length} nominations</span>}
                      <span style={{ flex: 1 }} />
                      <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 11 }} onClick={() => setEditStudent(open ? null : s.id)}>{open ? "Done" : "Edit"}</button>
                      <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }} onClick={() => removeStudent(s.id)}>✕</button>
                    </div>
                    {open && (
                      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                        <div>
                          <label style={S.label}>Name</label>
                          <input style={S.input} value={s.name} onChange={(e) => patchStudent(s.id, { name: e.target.value })} placeholder="e.g. Ava R" />
                        </div>
                        <div>
                          <label style={S.label}>Current class</label>
                          <input style={S.input} value={s.cls} onChange={(e) => patchStudent(s.id, { cls: e.target.value })} placeholder="e.g. 5A" />
                        </div>
                        <div>
                          <label style={S.label}>Gender</label>
                          <div style={{ display: "flex", gap: 6 }}>
                            {["F", "M"].map((g) => (
                              <button key={g} onClick={() => patchStudent(s.id, { gender: s.gender === g ? "" : g })}
                                style={{ ...S.btnGhost, padding: "8px 16px", ...(s.gender === g ? { background: T.ink, color: "#FFF", borderColor: T.ink } : { color: T.faint }) }}>
                                {g}
                              </button>
                            ))}
                          </div>
                        </div>
                        {SUBJECTS.map(({ key, label }) => (
                          <div key={key}>
                            <label style={S.label}>{label} level <span style={{ fontWeight: 400, color: T.sub }}>(VC)</span></label>
                            <input style={S.input} type="number" step="0.5" min="0" max="10" value={s.levels?.[key] ?? ""}
                              onChange={(e) => patchStudent(s.id, { levels: { ...s.levels, [key]: e.target.value === "" ? undefined : Number(e.target.value) } })} placeholder="e.g. 4.5" />
                          </div>
                        ))}
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label style={S.label}>Learning needs</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {[...new Set([...NEED_PRESETS, ...(s.needs || [])])].map((n) => {
                              const on = (s.needs || []).includes(n);
                              return (
                                <button key={n} onClick={() => patchStudent(s.id, { needs: on ? s.needs.filter((x) => x !== n) : [...(s.needs || []), n] })}
                                  style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5, ...(on ? { background: T.amberSoft, borderColor: T.amberLine, color: T.amber } : { color: T.faint }) }}>
                                  {n}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <label style={S.label}>Strengths</label>
                          <input style={S.input} value={s.strengths || ""} onChange={(e) => patchStudent(s.id, { strengths: e.target.value })} placeholder="e.g. leadership, maths reasoning" />
                        </div>
                        <div>
                          <label style={S.label}>Notes</label>
                          <input style={S.input} value={s.notes || ""} onChange={(e) => patchStudent(s.id, { notes: e.target.value })} placeholder="anything the build should know" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= CONSTRAINTS ================= */}
        {view === "constraints" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={S.card}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={S.eyebrow}>New classes & teachers</span>
                  <span style={{ flex: 1 }} />
                  <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addClass}>+ Class</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {newClasses.map((c, i) => {
                    const col = colorFor(i);
                    return (
                      <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", border: `1px solid ${T.lineSoft}`, borderLeft: `4px solid ${col.main}`, borderRadius: 12, padding: "8px 10px", background: "#FCFDFE" }}>
                        <input style={{ ...S.input, padding: "6px 10px", fontSize: 13, width: 90, flex: "0 0 auto" }} value={c.name} onChange={(e) => patchClass(c.id, { name: e.target.value })} placeholder="6A" />
                        <input style={{ ...S.input, padding: "6px 10px", fontSize: 13 }} value={c.teacher} onChange={(e) => patchClass(c.id, { teacher: e.target.value })} placeholder="Teacher" />
                        <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine, flex: "0 0 auto" }} onClick={() => removeClass(c.id)}>✕</button>
                      </div>
                    );
                  })}
                  {!newClasses.length && <div style={{ fontSize: 13, color: T.sub }}>Add the classes you're building into — at least two.</div>}
                </div>
              </div>
              <div style={S.card}>
                <span style={S.eyebrow}>Student → teacher recommendations</span>
                <div style={{ fontSize: 12, color: T.sub, margin: "8px 0 12px", lineHeight: 1.5 }}>A student who'd benefit from a particular teacher's class. The build lands these where it can and reports any it couldn't.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {recs.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ ...S.pill, fontSize: 12 }}>{byId(r.studentId)?.name || "?"}</span>
                      <span style={{ color: T.faint }}>→</span>
                      <span style={{ ...S.pill, fontSize: 12 }}>{classById(r.classId)?.name} {classById(r.classId)?.teacher && `· ${classById(r.classId).teacher}`}</span>
                      <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }} onClick={() => setRecs((p) => p.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <select id="recStudent" style={{ ...S.input, width: "auto", flex: 1 }} defaultValue="">
                    <option value="" disabled>Student…</option>
                    {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <select id="recClass" style={{ ...S.input, width: "auto", flex: 1 }} defaultValue="">
                    <option value="" disabled>Class…</option>
                    {newClasses.map((c) => <option key={c.id} value={c.id}>{c.name} {c.teacher && `· ${c.teacher}`}</option>)}
                  </select>
                  <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => {
                    const sid = document.getElementById("recStudent").value;
                    const cid = document.getElementById("recClass").value;
                    if (sid && cid && !recs.some((r) => r.studentId === sid)) setRecs((p) => [...p, { studentId: sid, classId: cid }]);
                  }}>Add</button>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {[["keep", "Keep together", keeps, setKeeps, "green", "These pairs are placed in the same class — the build treats them as one unit."],
                ["sep", "Keep apart", seps, setSeps, "red", "These pairs are never placed together. Prefers-apart nominations from the Sociogram are a good source."]].map(([kind, title, list, setter, tone, blurb]) => (
                <div key={kind} style={S.card}>
                  <span style={S.eyebrow}>{title}</span>
                  <div style={{ fontSize: 12, color: T.sub, margin: "8px 0 12px", lineHeight: 1.5 }}>{blurb}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {list.map(([a, b], i) => (
                      <Pill key={i} tone={tone} style={{ fontSize: 11.5 }}>
                        {byId(a)?.name} {kind === "keep" ? "+" : "×"} {byId(b)?.name}
                        <button style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontWeight: 800, padding: 0 }} onClick={() => setter((p) => p.filter((_, j) => j !== i))}>✕</button>
                      </Pill>
                    ))}
                    {!list.length && <span style={{ fontSize: 12.5, color: T.faint }}>None yet.</span>}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: pairPick.kind === kind && pairPick.first ? (tone === "green" ? T.green : T.red) : T.faint, marginBottom: 8 }}>
                    {pairPick.kind === kind && pairPick.first ? `${byId(pairPick.first)?.name} — now tap the second student` : "Tap two students to make a pair:"}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {students.map((s) => (
                      <button key={s.id} onClick={() => tapPair(kind, s.id)}
                        style={{ ...S.btnGhost, padding: "4px 10px", fontSize: 11.5,
                          ...(pairPick.kind === kind && pairPick.first === s.id ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= BUILD ================= */}
        {view === "build" && (
          <div>
            <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <button style={S.btn} onClick={suggestClasses}>✦ Suggest classes</button>
              <span style={{ fontSize: 12, color: T.sub }}>Locked students (🔒 tap a chip) stay put on re-suggest — move anyone by hand any time.</span>
              <span style={{ flex: 1 }} />
              {report.unplaced.length > 0 && <Pill tone="amber" style={{ fontSize: 11 }}>{report.unplaced.length} unplaced</Pill>}
              <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => window.print()}>Print</button>
              <button style={{ ...S.btnGhost, fontSize: 12, color: T.red, borderColor: T.redLine }} onClick={clearPlacement}>Clear</button>
            </div>
            {newClasses.length < 2 ? (
              <div style={{ ...S.card, fontSize: 13.5, color: T.sub, textAlign: "center", padding: 30 }}>Add at least two classes in the Constraints tab first.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(4, newClasses.length)}, 1fr)`, gap: 16, alignItems: "start" }}>
                {newClasses.map((c, ci) => {
                  const col = colorFor(ci);
                  const members = inClass(c.id);
                  const f = members.filter((s) => s.gender === "F").length;
                  const m = members.filter((s) => s.gender === "M").length;
                  const needsN = members.reduce((n, s) => n + (s.needs || []).length, 0);
                  return (
                    <div key={c.id} style={{ ...S.card, padding: 14, borderTop: `4px solid ${col.main}` }}>
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16 }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: T.sub }}>{c.teacher || "—"} · {members.length} students{f + m > 0 && ` · ${f}F ${m}M`}</div>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                          {SUBJECTS.map(({ key, label }) => {
                            const vals = members.map((s) => s.levels?.[key]).filter((x) => typeof x === "number");
                            return <span key={key} style={{ fontSize: 10, fontWeight: 700, color: col.text, background: col.soft, border: `1px solid ${col.line}`, borderRadius: 999, padding: "2px 8px" }}>{label[0]} {vals.length ? r1(avg(vals)) : "—"}</span>;
                          })}
                          <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, background: T.amberSoft, border: `1px solid ${T.amberLine}`, borderRadius: 999, padding: "2px 8px" }}>{needsN} needs</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {members.sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((s) => {
                          const menuOpen = chipMenu === s.id;
                          const fs = friendsOf(s.id);
                          const hasFriend = fs.some((f2) => placement[f2] === c.id);
                          const friendless = fs.length > 0 && !hasFriend;
                          return (
                            <div key={s.id} style={{ position: "relative" }}>
                              <button onClick={() => setChipMenu(menuOpen ? null : s.id)}
                                style={{ ...S.btnGhost, width: "100%", display: "flex", alignItems: "center", gap: 6, borderRadius: 10, padding: "6px 10px", textAlign: "left",
                                  ...(locks[s.id] ? { borderColor: T.ink } : {}), ...(friendless ? { borderColor: T.amberLine, background: T.amberSoft } : {}) }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{s.name}</span>
                                {(s.needs || []).length > 0 && <span style={{ fontSize: 9.5, fontWeight: 800, color: T.amber }}>{(s.needs || []).length}▲</span>}
                                {friendless && <span title="No chosen friend in this class" style={{ fontSize: 10 }}>⚠</span>}
                                {locks[s.id] && <span style={{ fontSize: 10 }}>🔒</span>}
                              </button>
                              {menuOpen && (
                                <div className="no-print" style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, boxShadow: T.shadow, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                                  <div style={{ fontSize: 10.5, color: T.sub, padding: "2px 6px" }}>
                                    {s.cls && `from ${s.cls} · `}{fs.length ? `friends: ${fs.map((f2) => byId(f2)?.name.split(" ")[0]).join(", ")}` : "no nominations"}
                                  </div>
                                  <button style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px" }} onClick={() => { setLocks((p) => ({ ...p, [s.id]: !p[s.id] })); setChipMenu(null); }}>
                                    {locks[s.id] ? "Unlock" : "🔒 Lock here"}
                                  </button>
                                  {newClasses.filter((o) => o.id !== c.id).map((o) => (
                                    <button key={o.id} style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px" }}
                                      onClick={() => { setPlacement((p) => ({ ...p, [s.id]: o.id })); setChipMenu(null); }}>
                                      → {o.name}{seps.some(([a, b]) => (a === s.id && placement[b] === o.id) || (b === s.id && placement[a] === o.id)) ? " ⚠ separation" : ""}
                                    </button>
                                  ))}
                                  <button style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px", color: T.red, borderColor: T.redLine }}
                                    onClick={() => { setPlacement((p) => { const n = { ...p }; delete n[s.id]; return n; }); setChipMenu(null); }}>
                                    Unplace
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!members.length && <div style={{ fontSize: 12, color: T.faint, padding: 6 }}>Empty — hit ✦ Suggest classes.</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {report.unplaced.length > 0 && newClasses.length >= 2 && (
              <div style={{ ...S.card, marginTop: 16 }}>
                <span style={S.eyebrow}>Unplaced</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {report.unplaced.map((s) => (
                    <button key={s.id} style={{ ...S.pill, fontSize: 12, cursor: "pointer" }} onClick={() => setChipMenu(null) || setPlacement((p) => ({ ...p, [s.id]: newClasses[0].id }))} title={`Place in ${newClasses[0].name}`}>
                      {s.name} →
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= REVIEW ================= */}
        {view === "review" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "start" }}>
            <div style={S.card}>
              <span style={S.eyebrow}>Constraint transparency</span>
              <div style={{ fontSize: 12, color: T.sub, margin: "8px 0 14px" }}>Every constraint, and whether the current build satisfies it or traded it off.</div>
              {[["Keep together", report.keepsR.map((k) => ({ ok: k.ok, text: `${byId(k.a)?.name} + ${byId(k.b)?.name}` }))],
                ["Keep apart", report.sepsR.map((k) => ({ ok: k.ok, text: `${byId(k.a)?.name} × ${byId(k.b)?.name}` }))],
                ["Teacher recommendations", report.recsR.map((k) => ({ ok: k.ok, text: `${byId(k.studentId)?.name} → ${classById(k.classId)?.name || "?"}${classById(k.classId)?.teacher ? ` (${classById(k.classId).teacher})` : ""}` }))]].map(([title, items]) => (
                <div key={title} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{title}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {items.map((it, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                        <span style={{ fontWeight: 800, color: it.ok ? T.green : T.red }}>{it.ok ? "✓" : "✗"}</span>
                        <span style={{ color: it.ok ? T.ink : T.red }}>{it.text}{!it.ok && " — traded off"}</span>
                      </div>
                    ))}
                    {!items.length && <span style={{ fontSize: 12, color: T.faint }}>None set.</span>}
                  </div>
                </div>
              ))}
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Friend coverage</div>
                {report.placedAll.length ? (
                  <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>
                    <b style={{ color: T.green }}>{report.placedAll.length - report.friendless.length - report.noData.length}</b> placed with at least one chosen friend
                    {report.noData.length > 0 && <> · <b>{report.noData.length}</b> with no nomination data</>}.
                    {report.friendless.length > 0 && (
                      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {report.friendless.map((s) => <Pill key={s.id} tone="amber" style={{ fontSize: 11 }}>{s.name} — no friend in class</Pill>)}
                      </div>
                    )}
                  </div>
                ) : <span style={{ fontSize: 12, color: T.faint }}>Nothing placed yet.</span>}
              </div>
            </div>
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={S.eyebrow}>Balance</span>
                <span style={{ flex: 1 }} />
                <button className="no-print" style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => window.print()}>Print class lists</button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      {["Class", "n", "F / M", "Reading", "Writing", "Maths", "Needs"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: `2px solid ${T.line}`, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: T.faint }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {newClasses.map((c, ci) => {
                      const members = inClass(c.id);
                      const cell = (key) => {
                        const vals = members.map((s) => s.levels?.[key]).filter((x) => typeof x === "number");
                        return vals.length ? r1(avg(vals)) : "—";
                      };
                      return (
                        <tr key={c.id}>
                          <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.lineSoft}`, fontWeight: 700 }}>
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: colorFor(ci).main, marginRight: 6 }} />{c.name}
                          </td>
                          <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.lineSoft}` }}>{members.length}</td>
                          <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.lineSoft}` }}>{members.filter((s) => s.gender === "F").length} / {members.filter((s) => s.gender === "M").length}</td>
                          <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.lineSoft}` }}>{cell("reading")}</td>
                          <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.lineSoft}` }}>{cell("writing")}</td>
                          <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.lineSoft}` }}>{cell("maths")}</td>
                          <td style={{ padding: "7px 8px", borderBottom: `1px solid ${T.lineSoft}` }}>{members.reduce((n, s) => n + (s.needs || []).length, 0)}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ padding: "7px 8px", fontWeight: 700, color: T.sub }}>Cohort</td>
                      <td style={{ padding: "7px 8px", color: T.sub }}>{students.length}</td>
                      <td style={{ padding: "7px 8px", color: T.sub }}>{students.filter((s) => s.gender === "F").length} / {students.filter((s) => s.gender === "M").length}</td>
                      {SUBJECTS.map(({ key }) => <td key={key} style={{ padding: "7px 8px", color: T.sub }}>{r1(cohortStats[key]) || "—"}</td>)}
                      <td style={{ padding: "7px 8px", color: T.sub }}>{students.reduce((n, s) => n + (s.needs || []).length, 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* printable class lists */}
              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {newClasses.map((c, ci) => (
                  <div key={c.id} style={{ border: `1px solid ${T.lineSoft}`, borderTop: `3px solid ${colorFor(ci).main}`, borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{c.name} {c.teacher && <span style={{ fontWeight: 600, color: T.sub, fontSize: 12 }}>· {c.teacher}</span>}</div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                      {inClass(c.id).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((s) => (
                        <div key={s.id}>{s.name}{(s.needs || []).length > 0 && <span style={{ color: T.amber, fontSize: 11 }}> · {(s.needs || []).join(", ")}</span>}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= IMPORT ================= */}
        {view === "import" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "start" }}>
            <div style={S.card}>
              <span style={S.eyebrow}>Cohort data via Claude</span>
              <div style={{ fontSize: 12.5, color: T.sub, margin: "8px 0 12px", lineHeight: 1.6 }}>
                Paste anything — a levels spreadsheet, handover notes, a needs register — or upload
                <b> .docx / .xlsx / .pdf / images</b>. Claude pulls out students, levels, needs and current classes.
                Existing students are matched by name and enriched, not duplicated. Everything previews before it applies.
              </div>
              <textarea style={{ ...S.input, minHeight: 140, resize: "vertical" }} value={impText} onChange={(e) => setImpText(e.target.value)}
                placeholder={"e.g.\nAva R  5A  F  Reading 5.5  Writing 5.5  Maths 5.0  extension\nEli S  5A  M  Reading 3.5 ... dyslexia, needs support"} />
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button style={{ ...S.btn, fontSize: 12, opacity: impBusy || !impText.trim() ? 0.6 : 1 }} disabled={impBusy || !impText.trim()} onClick={() => runImport(impText)}>
                  {impBusy ? "Reading…" : "✦ Read pasted text"}
                </button>
                <button style={{ ...S.btnGhost, fontSize: 12 }} disabled={impBusy} onClick={() => fileRef.current?.click()}>Upload a file</button>
                <input ref={fileRef} type="file" hidden accept=".txt,.md,.csv,.tsv,.docx,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.gif" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
              {impErr && <div style={{ marginTop: 10, fontSize: 12.5, color: T.red }}>{impErr}</div>}
              {impPreview && (
                <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: T.greenSoft, border: `1px solid ${T.greenLine}` }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: T.green, marginBottom: 8 }}>Found {impPreview.length} students — review, then apply:</div>
                  <div style={{ maxHeight: 220, overflowY: "auto", fontSize: 12, lineHeight: 1.7 }}>
                    {impPreview.map((s, i) => (
                      <div key={i}>
                        <b>{s.name}</b>{s.cls && ` · ${s.cls}`}{s.gender && ` · ${s.gender}`}
                        {SUBJECTS.filter(({ key }) => typeof s[key] === "number").map(({ key, label }) => ` · ${label[0]} ${s[key]}`).join("")}
                        {(s.needs || []).length > 0 && <span style={{ color: T.amber }}> · {s.needs.join(", ")}</span>}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button style={{ ...S.btn, fontSize: 12 }} onClick={applyImport}>Apply</button>
                    <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => setImpPreview(null)}>Discard</button>
                  </div>
                </div>
              )}
            </div>
            <div style={S.card}>
              <span style={S.eyebrow}>Grouping data from the Sociogram</span>
              <div style={{ fontSize: 12.5, color: T.sub, margin: "8px 0 12px", lineHeight: 1.6 }}>
                The Sociogram tool exports a <b>grouping-data JSON</b> — the shared roster + friendship
                nominations used across the whole grouping family. Import it here and the build gains the
                friendship layer: friend-coverage scoring, prefers-apart awareness, and the ⚠ friendless flags.
                Students are matched by name; new ones are added.
              </div>
              <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => groupRef.current?.click()}>Import grouping data</button>
              <input ref={groupRef} type="file" hidden accept=".json,application/json" onChange={(e) => { importGrouping(e.target.files?.[0]); e.target.value = ""; }} />
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.lineSoft}` }}>
                <span style={S.eyebrow}>And back out again</span>
                <div style={{ fontSize: 12.5, color: T.sub, margin: "8px 0 12px", lineHeight: 1.6 }}>
                  Export this roster (+ nominations, if imported) as grouping data for the Camp Cabin Creator
                  or Activity Group Creator.
                </div>
                <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={exportGrouping}>Export grouping data</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* click-away for chip menus */}
      {chipMenu && <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setChipMenu(null)} />}
    </div>
  );
}
