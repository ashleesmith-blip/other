import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   ACTIVITY GROUP CREATOR — camp + classroom activity groups
   CPS · Groupings · standalone tool

   · Students carry class, gender and friendship nominations —
     typed here or imported from the Sociogram's grouping-data
     JSON (name-matched, so nominations are captured once)
   · Activities each carry their own number of groups (canoeing
     in 4, ropes in 6, trivia in 5 …) and their own grouping
   · Two build modes per suggest:
       Keep a friend close — everyone lands with at least one
       chosen friend where possible (camp comfort mode)
       Mix it up — spread classes, spread friendship clusters,
       and prefer fresh partners across the other activities
   · Separations are enforced in both modes
   · Manual override with re-balance: move or lock any student
     within an activity, then re-suggest around the locks
   · Review is the constraint-transparency layer per activity:
     separations, friend coverage, class spread and how many
     fresh faces each student meets across the program
   · Aesthetic + patterns lifted from Chunk & Check
   ============================================================ */

/* ---------- misc helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

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

/* ---------- group colours — same wheel as Chunk & Check levels ---------- */
const COLORS = [
  { main: "#3B82F6", text: "#1D4ED8", soft: "#EFF6FF", line: "#BFDBFE" },
  { main: "#22C55E", text: "#15803D", soft: "#F0FDF4", line: "#BBF7D0" },
  { main: "#EC4899", text: "#BE185D", soft: "#FDF2F8", line: "#FBCFE8" },
  { main: "#F97316", text: "#C2410C", soft: "#FFF7ED", line: "#FED7AA" },
  { main: "#6366F1", text: "#4338CA", soft: "#EEF2FF", line: "#C7D2FE" },
  { main: "#14B8A6", text: "#0F766E", soft: "#F0FDFA", line: "#99F6E4" },
  { main: "#EAB308", text: "#A16207", soft: "#FEFCE8", line: "#FDE68A" },
  { main: "#EF4444", text: "#B91C1C", soft: "#FEF2F2", line: "#FECACA" },
];
const colorFor = (i) => COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];

/* ---------- sample data ---------- */
const SAMPLE = () => {
  const rows = [
    ["Ava R", "5A", "F"], ["Ben T", "5A", "M"], ["Chloe M", "5A", "F"], ["Dev P", "5A", "M"],
    ["Eli S", "5A", "M"], ["Freya K", "5A", "F"], ["Gus W", "5A", "M"], ["Harper L", "5A", "F"],
    ["Ivy C", "5A", "F"], ["Jack D", "5A", "M"], ["Kai N", "5A", "M"], ["Lily B", "5A", "F"],
    ["Marcus O", "5B", "M"], ["Nora F", "5B", "F"], ["Oscar H", "5B", "M"], ["Priya S", "5B", "F"],
    ["Quinn A", "5B", "F"], ["Ruby J", "5B", "F"], ["Sam E", "5B", "M"], ["Tara V", "5B", "F"],
    ["Umar M", "5B", "M"], ["Violet G", "5B", "F"], ["Will P", "5B", "M"], ["Zoe T", "5B", "F"],
  ];
  const students = rows.map(([name, cls, gender]) => ({ id: uid(), name, cls, gender, notes: "" }));
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
  const activities = [
    { id: uid(), name: "Canoeing", groups: 4 },
    { id: uid(), name: "High ropes", groups: 4 },
    { id: uid(), name: "Bush cooking", groups: 6 },
  ];
  const seps = [[id("Ben"), id("Marcus")]];
  return { students, socio, activities, seps };
};

/* ============================================================ */
export default function App() {
  const [students, setStudents] = useState([]);
  const [socio, setSocio] = useState({});            // { studentId: { friends:[], avoid:[] } }
  const [activities, setActivities] = useState([]);  // [{ id, name, groups }]
  const [seps, setSeps] = useState([]);              // [[idA, idB]]
  const [placements, setPlacements] = useState({});  // { activityId: { studentId: groupIdx } }
  const [locks, setLocks] = useState({});            // { activityId: { studentId: true } }
  const [mode, setMode] = useState("friend");        // friend | mix

  const [view, setView] = useState("students");      // students | activities | build | review
  const [activeAct, setActiveAct] = useState(null);  // activity id shown in Build
  const [editStudent, setEditStudent] = useState(null);
  const [chipMenu, setChipMenu] = useState(null);
  const [sepFirst, setSepFirst] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const loadRef = useRef(null);
  const groupRef = useRef(null);

  /* ---------- persistence ---------- */
  const storeLoaded = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await store.get("activity-groups-doc");
        if (raw) {
          const d = JSON.parse(raw);
          if (d.students) setStudents(d.students);
          if (d.socio) setSocio(d.socio);
          if (d.activities) setActivities(d.activities);
          if (d.seps) setSeps(d.seps);
          if (d.placements) setPlacements(d.placements);
          if (d.locks) setLocks(d.locks);
          if (d.mode) setMode(d.mode);
        }
      } catch {}
      storeLoaded.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!storeLoaded.current) return;
    store.set("activity-groups-doc", JSON.stringify({ students, socio, activities, seps, placements, locks, mode }));
    setSavedMsg("Saved");
    const t = setTimeout(() => setSavedMsg(""), 1200);
    return () => clearTimeout(t);
  }, [students, socio, activities, seps, placements, locks, mode]);

  /* ---------- lookups ---------- */
  const byId = (id) => students.find((s) => s.id === id);
  const actById = (id) => activities.find((a) => a.id === id);
  const friendsOf = (id) => (socio[id]?.friends || []).filter((f) => byId(f));
  const placeOf = (actId) => placements[actId] || {};
  const inGroup = (actId, gi) => students.filter((s) => placeOf(actId)[s.id] === gi);
  const currentAct = actById(activeAct) || activities[0];

  /* ---------- roster ops (shared patterns with the family) ---------- */
  const addStudent = () => { const s = { id: uid(), name: "", cls: "", gender: "", notes: "" }; setStudents((p) => [...p, s]); setEditStudent(s.id); };
  const patchStudent = (id, patch) => setStudents((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeStudent = (id) => {
    setStudents((p) => p.filter((s) => s.id !== id));
    setSeps((p) => p.filter(([a, b]) => a !== id && b !== id));
    setPlacements((p) => {
      const n = {};
      Object.entries(p).forEach(([actId, m]) => { const c = { ...m }; delete c[id]; n[actId] = c; });
      return n;
    });
    setSocio((p) => {
      const n = {};
      Object.entries(p).forEach(([k, v]) => {
        if (k === id) return;
        n[k] = { friends: (v.friends || []).filter((f) => f !== id), avoid: (v.avoid || []).filter((f) => f !== id) };
      });
      return n;
    });
  };
  const applyPaste = () => {
    const added = pasteText.split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, cls, gender] = l.split(/[,\t]/).map((x) => (x || "").trim());
      return { id: uid(), name, cls: cls || "", gender: (gender || "").toUpperCase().slice(0, 1), notes: "" };
    }).filter((s) => s.name);
    if (added.length) setStudents((p) => [...p, ...added]);
    setPasteText(""); setPasteOpen(false);
  };
  const toggleFriend = (id, target) => setSocio((p) => {
    const cur = p[id] || { friends: [], avoid: [] };
    const has = cur.friends.includes(target);
    return { ...p, [id]: { ...cur, friends: has ? cur.friends.filter((f) => f !== target) : [...cur.friends, target] } };
  });
  const tapSep = (id) => {
    if (!sepFirst) { setSepFirst(id); return; }
    if (sepFirst === id) { setSepFirst(null); return; }
    if (!seps.some(([x, y]) => (x === sepFirst && y === id) || (x === id && y === sepFirst))) setSeps((p) => [...p, [sepFirst, id]]);
    setSepFirst(null);
  };

  /* ---------- activities ---------- */
  const addActivity = () => { const a = { id: uid(), name: `Activity ${activities.length + 1}`, groups: 4 }; setActivities((p) => [...p, a]); setActiveAct(a.id); };
  const patchActivity = (id, patch) => setActivities((p) => p.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const removeActivity = (id) => {
    setActivities((p) => p.filter((a) => a.id !== id));
    setPlacements((p) => { const n = { ...p }; delete n[id]; return n; });
    setLocks((p) => { const n = { ...p }; delete n[id]; return n; });
    if (activeAct === id) setActiveAct(null);
  };

  /* ---------- suggestion engine ---------- */
  const violatesSep = (studentId, actId, gi, place) =>
    seps.some(([a, b]) => (a === studentId && place[b] === gi) || (b === studentId && place[a] === gi));

  /* who has this student already been grouped with, across the other activities */
  const pastPartners = (studentId, exceptActId) => {
    const set = new Set();
    activities.forEach((a) => {
      if (a.id === exceptActId) return;
      const m = placeOf(a.id);
      if (m[studentId] === undefined) return;
      students.forEach((o) => { if (o.id !== studentId && m[o.id] === m[studentId]) set.add(o.id); });
    });
    return set;
  };

  const suggestActivity = (act, confirmFirst = true) => {
    if (!act) return;
    const n = Math.max(2, Number(act.groups) || 2);
    const existing = placeOf(act.id);
    if (confirmFirst && Object.keys(existing).length && !window.confirm(`Re-suggest ${act.name}? Locked students stay put; everyone else may move.`)) return;

    const place = {};
    const actLocks = locks[act.id] || {};
    students.forEach((s) => { if (actLocks[s.id] && existing[s.id] !== undefined && existing[s.id] < n) place[s.id] = existing[s.id]; });

    const chose = (a, b) => (socio[a]?.friends || []).includes(b);
    let ordered;
    if (mode === "friend") {
      /* mutual clusters first, so friends seed groups together */
      const parent = {};
      students.forEach((s) => { parent[s.id] = s.id; });
      const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
      students.forEach((s) => friendsOf(s.id).forEach((f) => { if (chose(f, s.id)) parent[find(s.id)] = find(f); }));
      const comp = {};
      students.forEach((s) => { const rt = find(s.id); (comp[rt] = comp[rt] || []).push(s); });
      ordered = Object.values(comp).sort((a, b) => b.length - a.length).flat();
    } else {
      /* class round-robin, so classes spread from the start */
      const byCls = {};
      students.forEach((s) => { (byCls[s.cls || "?"] = byCls[s.cls || "?"] || []).push(s); });
      ordered = [];
      const lists = Object.values(byCls);
      for (let i = 0; lists.some((l) => i < l.length); i++) lists.forEach((l) => { if (l[i]) ordered.push(l[i]); });
    }
    ordered = ordered.filter((s) => place[s.id] === undefined);

    const target = students.length / n;
    const past = {};
    if (mode === "mix") students.forEach((s) => { past[s.id] = pastPartners(s.id, act.id); });

    ordered.forEach((s) => {
      let best = 0, bestSc = -Infinity;
      for (let gi = 0; gi < n; gi++) {
        if (violatesSep(s.id, act.id, gi, place)) continue;
        const members = students.filter((x) => place[x.id] === gi);
        if (members.length >= Math.ceil(target) + 1) continue;
        let sc = -members.length * 0.8;
        if (mode === "friend") {
          sc += friendsOf(s.id).filter((f) => members.some((m) => m.id === f)).length * 4;
          sc += members.filter((m) => chose(m.id, s.id)).length * 1.5;
        } else {
          sc -= members.filter((m) => (m.cls || "?") === (s.cls || "?")).length * 1.6;
          sc -= members.filter((m) => friendsOf(s.id).includes(m.id)).length * 1.2;
          sc -= members.filter((m) => past[s.id]?.has(m.id)).length * 1.4;
        }
        if (sc > bestSc) { bestSc = sc; best = gi; }
      }
      if (bestSc === -Infinity) {
        /* every group blocked (seps/size) — take the emptiest without a sep clash, else emptiest */
        let fallback = 0, min = Infinity;
        for (let gi = 0; gi < n; gi++) {
          const len = students.filter((x) => place[x.id] === gi).length;
          if (!violatesSep(s.id, act.id, gi, place) && len < min) { min = len; fallback = gi; }
        }
        best = min === Infinity ? 0 : fallback;
      }
      place[s.id] = best;
    });

    /* friend-mode rescue: friendless students move to a friend's group when there's room */
    if (mode === "friend") {
      students.forEach((s) => {
        if (actLocks[s.id]) return;
        const fs = friendsOf(s.id);
        if (!fs.length || fs.some((f) => place[f] === place[s.id])) return;
        for (const f of fs) {
          const gi = place[f];
          if (gi === undefined || gi === place[s.id]) continue;
          if (violatesSep(s.id, act.id, gi, place)) continue;
          if (students.filter((x) => place[x.id] === gi).length >= Math.ceil(target) + 1) continue;
          place[s.id] = gi;
          break;
        }
      });
    }

    setPlacements((p) => ({ ...p, [act.id]: place }));
  };

  const suggestAll = () => {
    if (!activities.length) { window.alert("Add activities first (Activities tab)."); return; }
    const any = activities.some((a) => Object.keys(placeOf(a.id)).length);
    if (any && !window.confirm("Re-suggest every activity? Locked students stay put; everyone else may move.")) return;
    /* sequential so mix-mode sees earlier activities' partners */
    activities.forEach((a) => suggestActivity(a, false));
    setView("build");
  };

  /* ---------- review data ---------- */
  const reportFor = (act) => {
    const place = placeOf(act.id);
    const placedAll = students.filter((s) => place[s.id] !== undefined);
    const sepsR = seps.map(([a, b]) => ({ a, b, ok: place[a] === undefined || place[b] === undefined || place[a] !== place[b] }));
    const friendless = placedAll.filter((s) => {
      const fs = friendsOf(s.id);
      return fs.length && !fs.some((f) => place[f] === place[s.id]);
    });
    return { place, placedAll, sepsR, friendless };
  };
  const freshFaces = useMemo(() => {
    /* average share of distinct partners met across the program */
    const built = activities.filter((a) => Object.keys(placeOf(a.id)).length);
    if (built.length < 2 || students.length < 3) return null;
    const shares = students.map((s) => {
      const set = new Set();
      built.forEach((a) => {
        const m = placeOf(a.id);
        if (m[s.id] === undefined) return;
        students.forEach((o) => { if (o.id !== s.id && m[o.id] === m[s.id]) set.add(o.id); });
      });
      return set.size / (students.length - 1);
    });
    return Math.round((shares.reduce((x, y) => x + y, 0) / shares.length) * 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, activities, placements]);

  /* ---------- backup / grouping data ---------- */
  const download = (obj, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportBackup = () => download({ students, socio, activities, seps, placements, locks, mode }, "activity-groups-backup.json");
  const loadBackup = async (file) => {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!window.confirm("Replace everything with this backup?")) return;
      setStudents(d.students || []); setSocio(d.socio || {}); setActivities(d.activities || []);
      setSeps(d.seps || []); setPlacements(d.placements || {}); setLocks(d.locks || {});
      if (d.mode) setMode(d.mode);
    } catch { window.alert("That file isn't a valid backup."); }
  };
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
          const ns = { id: uid(), name: imp.name || "", cls: imp.cls || "", gender: imp.gender || "", notes: imp.notes || "" };
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
      if (!window.confirm(`Import grouping data: ${additions.length} new students, nominations for ${Object.keys(socioNew).length}.`)) return;
      if (additions.length) setStudents((p) => [...p, ...additions]);
      setSocio((p) => ({ ...p, ...socioNew }));
    } catch { window.alert("That file isn't grouping data (expects { students:[...], socio:{...} })."); }
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
          <Pill tone="blue" style={{ fontSize: 11 }}>CPS · Groupings · Camp & Classroom</Pill>
          <h1 style={{ fontFamily: F.display, fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", margin: "12px 0 6px" }}>
            Activity <span style={{ color: T.blue }}>Groups</span>
          </h1>
          <div style={{ fontSize: 14, color: T.sub, maxWidth: 640, margin: "0 auto", lineHeight: 1.55 }}>
            Every activity gets its own groups — keep a friend close for the nervous ones, or mix it up
            so everyone meets fresh faces across the program. Separations hold either way.
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {[["students", "Students"], ["activities", "Activities"], ["build", "Build"], ["review", "Review"]].map(([k, lab]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ ...S.btnGhost, ...(view === k ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                {lab}
              </button>
            ))}
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={() => groupRef.current?.click()} title="Import the Sociogram's grouping-data JSON">Import grouping data</button>
            <input ref={groupRef} type="file" hidden accept=".json,application/json" onChange={(e) => { importGrouping(e.target.files?.[0]); e.target.value = ""; }} />
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={exportBackup} title="Download everything as a JSON backup">Backup</button>
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={() => loadRef.current?.click()} title="Restore from a JSON backup">Restore</button>
            <input ref={loadRef} type="file" hidden accept=".json,application/json" onChange={(e) => { loadBackup(e.target.files?.[0]); e.target.value = ""; }} />
            {savedMsg && <Pill tone="green" style={{ fontSize: 10.5 }}>{savedMsg}</Pill>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 80px" }}>

        {/* ================= STUDENTS ================= */}
        {view === "students" && (
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={S.eyebrow}>Students</span>
              <Pill style={{ fontSize: 10.5 }}>{students.length} students</Pill>
              <span style={{ flex: 1 }} />
              <button style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12 }} onClick={() => setPasteOpen(!pasteOpen)}>Paste list</button>
              <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addStudent}>+ Student</button>
            </div>
            {pasteOpen && (
              <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: T.blueSoft, border: `1px solid ${T.blueLine}` }}>
                <label style={S.label}>One student per line — <span style={{ fontWeight: 400, color: T.sub }}>Name, class, gender</span></label>
                <textarea style={{ ...S.input, minHeight: 90, resize: "vertical" }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"Ava R, 5A, F\nBen T, 5A, M"} />
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={applyPaste}>Add students</button>
                  <button style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12 }} onClick={() => setPasteOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
            {!students.length && !pasteOpen && (
              <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6 }}>
                No students yet. Add them, paste a list, import grouping data from the Sociogram (header), or{" "}
                <button onClick={() => { const s = SAMPLE(); setStudents(s.students); setSocio(s.socio); setActivities(s.activities); setSeps(s.seps); }}
                  style={{ border: "none", background: "none", cursor: "pointer", color: T.blueDeep, fontWeight: 700, fontSize: 13, padding: 0 }}>
                  load sample data
                </button>{" "}
                to see the tool working.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {students.map((s) => {
                const open = editStudent === s.id;
                const fs = friendsOf(s.id);
                return (
                  <div key={s.id} style={{ border: `1px solid ${open ? T.blueLine : T.lineSoft}`, borderRadius: 12, padding: "10px 12px", background: open ? T.blueSoft : "#FCFDFE" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ width: 26, height: 26, borderRadius: 999, background: T.blue, color: "#FFF", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(s.name)}</span>
                      <div style={{ minWidth: 130 }}>
                        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13.5 }}>{s.name || "Unnamed"}</div>
                        <div style={{ fontSize: 11, color: T.sub }}>{[s.cls, s.gender].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                      {fs.length > 0 && <span style={{ fontSize: 11, color: T.faint }}>friends: {fs.map((f) => byId(f)?.name.split(" ")[0]).join(", ")}</span>}
                      <span style={{ flex: 1 }} />
                      <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 11 }} onClick={() => setEditStudent(open ? null : s.id)}>{open ? "Done" : "Edit"}</button>
                      <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }} onClick={() => removeStudent(s.id)}>✕</button>
                    </div>
                    {open && (
                      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                          <div>
                            <label style={S.label}>Name</label>
                            <input style={S.input} value={s.name} onChange={(e) => patchStudent(s.id, { name: e.target.value })} placeholder="e.g. Ava R" />
                          </div>
                          <div>
                            <label style={S.label}>Class</label>
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
                        </div>
                        <div>
                          <label style={S.label}>Friends — wants to be grouped with</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {students.filter((o) => o.id !== s.id).map((o) => {
                              const on = fs.includes(o.id);
                              return (
                                <button key={o.id} onClick={() => toggleFriend(s.id, o.id)}
                                  style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5, ...(on ? { background: T.blueSoft, borderColor: T.blue, color: T.blueDeep } : { color: T.faint }) }}>
                                  {o.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {students.length > 0 && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.lineSoft}` }}>
                <span style={S.eyebrow}>Separations — never the same group</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
                  {seps.map(([a, b], i) => (
                    <Pill key={i} tone="red" style={{ fontSize: 11.5 }}>
                      {byId(a)?.name} × {byId(b)?.name}
                      <button style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontWeight: 800, padding: 0 }} onClick={() => setSeps((p) => p.filter((_, j) => j !== i))}>✕</button>
                    </Pill>
                  ))}
                  {!seps.length && <span style={{ fontSize: 12.5, color: T.faint }}>None yet.</span>}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: sepFirst ? T.red : T.faint, marginBottom: 8 }}>
                  {sepFirst ? `${byId(sepFirst)?.name} — now tap the second student` : "Tap two students to add a separation:"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {students.map((s) => (
                    <button key={s.id} onClick={() => tapSep(s.id)}
                      style={{ ...S.btnGhost, padding: "4px 10px", fontSize: 11.5, ...(sepFirst === s.id ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= ACTIVITIES ================= */}
        {view === "activities" && (
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={S.eyebrow}>Activities</span>
              <span style={{ flex: 1 }} />
              <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addActivity}>+ Activity</button>
            </div>
            {!activities.length && <div style={{ fontSize: 13, color: T.sub }}>No activities yet — each gets its own number of groups and its own grouping.</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
              {activities.map((a, ai) => {
                const col = colorFor(ai);
                const built = Object.keys(placeOf(a.id)).length;
                return (
                  <div key={a.id} style={{ border: `1px solid ${T.lineSoft}`, borderTop: `4px solid ${col.main}`, borderRadius: 12, padding: 12, background: "#FCFDFE" }}>
                    <input style={{ ...S.input, padding: "6px 10px", fontSize: 13.5, fontWeight: 700, marginBottom: 8 }} value={a.name} onChange={(e) => patchActivity(a.id, { name: e.target.value })} placeholder="Activity name" />
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label style={{ ...S.label, marginBottom: 0 }}>Groups</label>
                      <input style={{ ...S.input, width: 70, padding: "6px 10px" }} type="number" min="2" max="12" value={a.groups} onChange={(e) => patchActivity(a.id, { groups: Math.max(2, Number(e.target.value) || 2) })} />
                      <span style={{ fontSize: 11, color: T.sub }}>≈ {students.length && a.groups ? Math.ceil(students.length / a.groups) : "—"} each</span>
                      <span style={{ flex: 1 }} />
                      <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }} onClick={() => removeActivity(a.id)}>✕</button>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {built ? <Pill tone="green" style={{ fontSize: 10.5 }}>{built} placed</Pill> : <Pill style={{ fontSize: 10.5 }}>not built yet</Pill>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= BUILD ================= */}
        {view === "build" && (
          <div>
            <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <button style={S.btn} onClick={suggestAll}>✦ Suggest all activities</button>
              {currentAct && <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => suggestActivity(currentAct)}>✦ Just {currentAct.name}</button>}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: T.sub, fontWeight: 700 }}>Mode:</span>
              {[["friend", "Keep a friend close"], ["mix", "Mix it up"]].map(([k, lab]) => (
                <button key={k} onClick={() => setMode(k)}
                  style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5, ...(mode === k ? { background: T.blueSoft, borderColor: T.blue, color: T.blueDeep } : { color: T.faint }) }}>
                  {lab}
                </button>
              ))}
              <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => window.print()}>Print</button>
            </div>
            {!activities.length ? (
              <div style={{ ...S.card, fontSize: 13.5, color: T.sub, textAlign: "center", padding: 30 }}>Add activities first (Activities tab).</div>
            ) : (
              <>
                <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {activities.map((a, ai) => (
                    <button key={a.id} onClick={() => setActiveAct(a.id)}
                      style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12,
                        ...((currentAct?.id === a.id) ? { background: colorFor(ai).soft, borderColor: colorFor(ai).main, color: colorFor(ai).text } : {}) }}>
                      {a.name}
                    </button>
                  ))}
                </div>
                {currentAct && (() => {
                  const act = currentAct;
                  const n = Math.max(2, Number(act.groups) || 2);
                  const place = placeOf(act.id);
                  const actLocks = locks[act.id] || {};
                  const unplaced = students.filter((s) => place[s.id] === undefined);
                  return (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(4, n)}, 1fr)`, gap: 14, alignItems: "start" }}>
                        {Array.from({ length: n }, (_, gi) => {
                          const col = colorFor(gi);
                          const members = inGroup(act.id, gi);
                          return (
                            <div key={gi} style={{ ...S.card, padding: 14, borderTop: `4px solid ${col.main}` }}>
                              <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
                                Group {gi + 1} <span style={{ fontWeight: 600, color: T.sub, fontSize: 11.5 }}>· {members.length}</span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {members.sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((s) => {
                                  const menuOpen = chipMenu === `${act.id}|${s.id}`;
                                  const fs = friendsOf(s.id);
                                  const friendless = mode === "friend" && fs.length > 0 && !fs.some((f) => place[f] === gi);
                                  const locked = actLocks[s.id];
                                  return (
                                    <div key={s.id} style={{ position: "relative" }}>
                                      <button onClick={() => setChipMenu(menuOpen ? null : `${act.id}|${s.id}`)}
                                        style={{ ...S.btnGhost, width: "100%", display: "flex", alignItems: "center", gap: 6, borderRadius: 10, padding: "6px 10px", textAlign: "left",
                                          ...(locked ? { borderColor: T.ink } : {}), ...(friendless ? { borderColor: T.amberLine, background: T.amberSoft } : {}) }}>
                                        <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{s.name}</span>
                                        <span style={{ fontSize: 10, color: T.faint }}>{s.cls}</span>
                                        {friendless && <span title="No chosen friend in this group" style={{ fontSize: 10 }}>⚠</span>}
                                        {locked && <span style={{ fontSize: 10 }}>🔒</span>}
                                      </button>
                                      {menuOpen && (
                                        <div className="no-print" style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, boxShadow: T.shadow, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                                          <button style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px" }}
                                            onClick={() => { setLocks((p) => ({ ...p, [act.id]: { ...(p[act.id] || {}), [s.id]: !actLocks[s.id] } })); setChipMenu(null); }}>
                                            {locked ? "Unlock" : "🔒 Lock here"}
                                          </button>
                                          {Array.from({ length: n }, (_, oi) => oi).filter((oi) => oi !== gi).map((oi) => (
                                            <button key={oi} style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px" }}
                                              onClick={() => { setPlacements((p) => ({ ...p, [act.id]: { ...place, [s.id]: oi } })); setChipMenu(null); }}>
                                              → Group {oi + 1}{seps.some(([a, b]) => (a === s.id && place[b] === oi) || (b === s.id && place[a] === oi)) ? " ⚠ separation" : ""}
                                            </button>
                                          ))}
                                          <button style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px", color: T.red, borderColor: T.redLine }}
                                            onClick={() => { setPlacements((p) => { const c = { ...place }; delete c[s.id]; return { ...p, [act.id]: c }; }); setChipMenu(null); }}>
                                            Unplace
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {!members.length && <div style={{ fontSize: 12, color: T.faint, padding: 6 }}>Empty.</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {unplaced.length > 0 && (
                        <div style={{ ...S.card, marginTop: 14 }}>
                          <span style={S.eyebrow}>Unplaced for {act.name}</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                            {unplaced.map((s) => <Pill key={s.id} style={{ fontSize: 12 }}>{s.name}</Pill>)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ================= REVIEW ================= */}
        {view === "review" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {freshFaces !== null && (
              <div style={{ ...S.card, display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 28, color: T.blueDeep }}>{freshFaces}%</span>
                <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5 }}>
                  <b style={{ color: T.ink }}>Fresh faces across the program</b> — on average, each student is grouped with this share
                  of the cohort at least once across the built activities. Mix-it-up mode pushes this higher.
                </div>
              </div>
            )}
            {!activities.length && <div style={{ ...S.card, fontSize: 13.5, color: T.sub, textAlign: "center", padding: 30 }}>Nothing to review yet.</div>}
            {activities.map((act, ai) => {
              const rep = reportFor(act);
              const col = colorFor(ai);
              const n = Math.max(2, Number(act.groups) || 2);
              if (!rep.placedAll.length) return (
                <div key={act.id} style={{ ...S.card, borderTop: `4px solid ${col.main}` }}>
                  <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16 }}>{act.name}</div>
                  <div style={{ fontSize: 12.5, color: T.sub, marginTop: 6 }}>Not built yet.</div>
                </div>
              );
              return (
                <div key={act.id} style={{ ...S.card, borderTop: `4px solid ${col.main}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16 }}>{act.name}</div>
                    <Pill style={{ fontSize: 10.5 }}>{n} groups</Pill>
                    {rep.sepsR.every((x) => x.ok) ? <Pill tone="green" style={{ fontSize: 10.5 }}>✓ separations hold</Pill> : <Pill tone="red" style={{ fontSize: 10.5 }}>✗ separation broken</Pill>}
                    {rep.friendless.length > 0 && <Pill tone="amber" style={{ fontSize: 10.5 }}>{rep.friendless.length} without a friend</Pill>}
                  </div>
                  {rep.sepsR.filter((x) => !x.ok).map((x, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: T.red, marginBottom: 6 }}>✗ {byId(x.a)?.name} × {byId(x.b)?.name} — in the same group</div>
                  ))}
                  {rep.friendless.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                      {rep.friendless.map((s) => <Pill key={s.id} tone="amber" style={{ fontSize: 11 }}>{s.name}</Pill>)}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                    {Array.from({ length: n }, (_, gi) => {
                      const members = inGroup(act.id, gi);
                      const clsCounts = {};
                      members.forEach((s) => { clsCounts[s.cls || "?"] = (clsCounts[s.cls || "?"] || 0) + 1; });
                      return (
                        <div key={gi} style={{ border: `1px solid ${T.lineSoft}`, borderTop: `3px solid ${colorFor(gi).main}`, borderRadius: 12, padding: "8px 10px" }}>
                          <div style={{ fontSize: 11.5, fontWeight: 800, marginBottom: 4 }}>Group {gi + 1} <span style={{ fontWeight: 600, color: T.faint, fontSize: 10.5 }}>{Object.entries(clsCounts).map(([c, x]) => `${c}:${x}`).join(" ")}</span></div>
                          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                            {members.sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((s) => <div key={s.id}>{s.name}</div>)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {chipMenu && <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setChipMenu(null)} />}
    </div>
  );
}
